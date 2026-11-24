from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import pytest
import respx

from wonder_quant.catalog import load_catalog, summarize_catalog
from wonder_quant.compute import compute_all_metrics
from wonder_quant.config import HKT, Settings, is_in_vault_blackout
from wonder_quant.d1_client import D1Client, pack_fund_series
from wonder_quant.fetchers import CircuitOpenError
from wonder_quant.fetchers.aia import fetch_aia_tmp2_snapshot, parse_aia_price, parse_aia_valuation_date
from wonder_quant.fetchers.csv_import import load_manual_csv
from wonder_quant.models import FundRecord
from wonder_quant.pipeline import _stitch_aia_official_onto_proxy
from wonder_quant.storage import FetchLedger
from wonder_quant.writeback import _assert_allowed_vault_path, writeback_to_vault


def test_aia_date_and_price_parsing() -> None:
    # Crucial regression test: [09/01/2026] MUST be 2026-09-01 (MM/DD/YYYY), NEVER 2026-01-09!
    assert parse_aia_valuation_date("[09/01/2026]", today=date(2026, 11, 23)) == "2026-09-01"
    assert parse_aia_valuation_date("[11/20/2026]", today=date(2026, 11, 23)) == "2026-11-20"
    with pytest.raises(ValueError, match="future"):
        parse_aia_valuation_date("[12/25/2026]", today=date(2026, 11, 23))

    assert parse_aia_price("<font color='#D31145'>美元[20.1400]</font>") == 20.14
    assert parse_aia_price("<font>HKD[1,234.56]</font>") == 1234.56


@respx.mock
def test_aia_circuit_breaker_on_429() -> None:
    respx.get("https://www1.aia.com.hk/CorpWS/Investment/Get/FundInfo2/").mock(
        return_value=httpx.Response(429, text="Too Many Requests")
    )
    with pytest.raises(CircuitOpenError) as exc_info:
        fetch_aia_tmp2_snapshot()
    assert exc_info.value.status_code == 429


def test_vault_blackout_windows_r2() -> None:
    assert is_in_vault_blackout(datetime(2026, 11, 23, 23, 30, tzinfo=HKT)) is True
    assert is_in_vault_blackout(datetime(2026, 11, 23, 2, 15, tzinfo=HKT)) is True
    assert is_in_vault_blackout(datetime(2026, 11, 23, 21, 0, tzinfo=HKT)) is False
    assert is_in_vault_blackout(datetime(2026, 11, 23, 1, 30, tzinfo=HKT)) is False


def test_r3_allowlist_and_r4_utf8_lf_writeback(tmp_path: Path) -> None:
    vault_dir = tmp_path / "00_基金产品库"
    (vault_dir / "funds").mkdir(parents=True)
    orig_md = vault_dir / "funds" / "B01_F.md"
    orig_md.write_text("# Original manual file\n", encoding="utf-8")

    # R3: direct write to funds/B01_F.md or _funds.json MUST raise PermissionError
    with pytest.raises(PermissionError, match="R3 VIOLATION"):
        _assert_allowed_vault_path(vault_dir, orig_md)
    with pytest.raises(PermissionError, match="R3 VIOLATION"):
        _assert_allowed_vault_path(vault_dir, vault_dir / "_funds.json")

    fund = FundRecord(slug="B01_F", code="B01", aia_code="B01", name="AB Short Bond", asset_class="固定收益", currency="USD")
    dates = pd.bdate_range("2021-11-23", "2026-11-20")
    rng = np.random.default_rng(42)
    rets = rng.normal(0.0002, 0.003, size=len(dates))
    adj = 20.0 * np.cumprod(1.0 + rets)
    nav_df = pd.DataFrame(
        {
            "nav_date": [d.strftime("%Y-%m-%d") for d in dates],
            "nav": adj,
            "adj_nav": adj,
            "dividend": 0.0,
            "series_type": "market_etf",
            "source": "yfinance",
        }
    )
    bm_df = pd.DataFrame(
        {
            "nav_date": [d.strftime("%Y-%m-%d") for d in dates],
            "close_price": 100.0 * np.cumprod(1.0 + rets * 0.8),
            "adj_close": 100.0 * np.cumprod(1.0 + rets * 0.8),
        }
    )
    metrics = compute_all_metrics([fund], {"B01_F": nav_df}, {"SPY": bm_df}, as_of_date="2026-11-23")
    assert len(metrics) == 1
    m = metrics[0]
    assert m.data_tier == "A"
    assert m.ret_3y_ann is not None and m.sharpe_3y is not None and m.max_dd_3y is not None
    assert m.quant_grade in {"A", "B", "C", "D"}

    # R2: blackout time raises
    with pytest.raises(RuntimeError, match="R2 BLACKOUT"):
        writeback_to_vault(vault_dir, [fund], metrics, current_time=datetime(2026, 11, 23, 23, 15, tzinfo=HKT))

    # Allowed time writes UTF-8 no BOM + pure LF and never touches original funds/B01_F.md
    res = writeback_to_vault(vault_dir, [fund], metrics, current_time=datetime(2026, 11, 23, 21, 0, tzinfo=HKT))
    assert res["written_md"] == 1
    assert orig_md.read_text(encoding="utf-8") == "# Original manual file\n"

    sidecar = vault_dir / "funds" / "_quant" / "B01_F.md"
    raw = sidecar.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf")
    assert b"\r\n" not in raw
    assert b"source_fund: '[[B01_F]]'" in raw or b'source_fund: "[[B01_F]]"' in raw or b"source_fund: [[B01_F]]" in raw

    summary_json = vault_dir / "_quant_metrics.json"
    sraw = summary_json.read_bytes()
    assert not sraw.startswith(b"\xef\xbb\xbf")
    assert b"\r\n" not in sraw
    parsed = json.loads(sraw.decode("utf-8"))
    assert parsed["count"] == 1


def test_aia_stitching_and_anomaly_detection() -> None:
    df = pd.DataFrame(
        [
            {"slug": "Z01_F", "nav_date": "2026-11-18", "nav": 10.0, "adj_nav": 100.0, "dividend": 0.0, "series_type": "proxy_underlying", "source": "yfinance"},
            {"slug": "Z01_F", "nav_date": "2026-11-19", "nav": 10.1, "adj_nav": 101.0, "dividend": 0.0, "series_type": "proxy_underlying", "source": "yfinance"},
            {"slug": "Z01_F", "nav_date": "2026-11-20", "nav": 20.2, "adj_nav": 20.2, "dividend": 0.0, "series_type": "official_aia", "source": "aia_fundinfo2"},
            {"slug": "Z01_F", "nav_date": "2026-11-21", "nav": 20.402, "adj_nav": 20.402, "dividend": 0.0, "series_type": "official_aia", "source": "aia_fundinfo2"},
        ]
    )
    stitched = _stitch_aia_official_onto_proxy(df)
    # 2026-11-20 adj_nav chains seamlessly to 101.0, and 11-21 grows +1% to 102.01
    assert abs(stitched.loc[stitched["nav_date"] == "2026-11-20", "adj_nav"].iloc[0] - 101.0) < 1e-4
    assert abs(stitched.loc[stitched["nav_date"] == "2026-11-21", "adj_nav"].iloc[0] - 102.01) < 1e-3

    # Anomaly > 15% single-day move
    fund = FundRecord(slug="TEST", code="TEST", name="Jump Fund", asset_class="股票", currency="USD")
    jump_df = pd.DataFrame(
        [
            {"nav_date": "2026-11-18", "nav": 10.0, "adj_nav": 10.0, "dividend": 0.0, "series_type": "market_etf"},
            {"nav_date": "2026-11-19", "nav": 10.1, "adj_nav": 10.1, "dividend": 0.0, "series_type": "market_etf"},
            {"nav_date": "2026-11-20", "nav": 12.5, "adj_nav": 12.5, "dividend": 0.0, "series_type": "market_etf"},
        ]
    )
    metrics = compute_all_metrics([fund], {"TEST": jump_df}, {}, as_of_date="2026-11-20")
    assert any(a.startswith("daily_jump:") for a in metrics[0].anomalies)


@respx.mock
def test_d1_packed_series_and_dirty_skip(tmp_path: Path) -> None:
    settings = Settings(
        home_dir=tmp_path,
        cf_account_id="acc123",
        cf_d1_database_id="db456",
        cf_api_token="tok789",
    )
    settings.ensure_runtime_dirs()

    route = respx.post("https://api.cloudflare.com/client/v4/accounts/acc123/d1/database/db456/query").mock(
        return_value=httpx.Response(200, json={"success": True, "result": [{"results": []}]})
    )

    fund = FundRecord(slug="US_SCHD", code="SCHD", yahoo_ticker="SCHD", name="Schwab Dividend", asset_class="股票")
    df = pd.DataFrame(
        [
            {"nav_date": "2026-11-19", "nav": 28.0, "adj_nav": 28.0, "dividend": 0.0, "series_type": "market_etf"},
            {"nav_date": "2026-11-20", "nav": 28.5, "adj_nav": 28.75, "dividend": 0.25, "series_type": "market_etf"},
        ]
    )
    payload, digest = pack_fund_series(df, "market_etf", "yfinance")
    assert payload["d"] == ["2026-11-19", "2026-11-20"]
    assert payload["v"] == [[1, 0.25]]
    assert len(digest) == 64

    metrics = compute_all_metrics([fund], {"US_SCHD": df}, {}, as_of_date="2026-11-20")
    ledger = FetchLedger(settings.state_dir)
    client = D1Client(settings)

    # First push writes 3 rows: wq_funds + wq_fund_series + wq_fund_metrics
    s1 = client.push_all([fund], metrics, {"US_SCHD": df}, {}, {}, ledger, full=False)
    assert s1["rows_written"] == 3
    assert s1["rows_skipped"] == 0

    # Second push with identical data skips ALL 3 rows (0 D1 free-tier write quota consumed!)
    s2 = client.push_all([fund], metrics, {"US_SCHD": df}, {}, {}, ledger, full=False)
    assert s2["rows_written"] == 0
    assert s2["rows_skipped"] == 3
    assert route.call_count == 3


def test_manual_csv_import(tmp_path: Path) -> None:
    p = tmp_path / "manual.csv"
    p.write_text("date,nav,adj_nav,dividend\n2026-11-19,10.0,10.0,0\n2026-11-20,10.2,10.3,0.1\n", encoding="utf-8")
    df = load_manual_csv(p)
    assert len(df) == 2
    assert df.iloc[-1]["adj_nav"] == 10.3


def test_real_vault_309_catalog_audit() -> None:
    vault_dir = Path(r"D:\Claude_Agent_Workspace\derek-obsidian-sync\05_Investment_Research\03_Funds\00_基金产品库")
    if not vault_dir.exists():
        pytest.skip("Local Vault not available")
    records = load_catalog(vault_dir)
    summary = summarize_catalog(records)
    assert summary["total_in_vault"] == 309
    assert summary["non_trackable"] == 3
    assert summary["trackable"] == 306
    by_slug = {r.slug: r for r in records}
    assert by_slug["BD_Ticker"].is_trackable is False
    assert by_slug["F"].aia_code == "R03"
    assert by_slug["Z01_F"].twin_code == "V02"
    assert by_slug["BD_IB01"].yahoo_ticker == "IB01.L"
    assert by_slug["CN_016701"].primary_source == "eastmoney_open"
    assert by_slug["HK_513690"].cn_code == "sh513690"
    assert by_slug["MM_9096"].yahoo_ticker == "9096.HK"
    assert by_slug["MM_9096"].currency == "USD"
