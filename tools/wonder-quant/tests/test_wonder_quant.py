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
from wonder_quant.pipeline import _stitch_aia_official_onto_proxy, _stitch_incremental_series
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
    assert payload["d0"] == "2026-11-19"
    assert payload["dd"] == [1]
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


def test_real_vault_309_catalog_audit(tmp_path: Path) -> None:
    vault_dir = Path(r"D:\Claude_Agent_Workspace\derek-obsidian-sync\05_Investment_Research\03_Funds\00_基金产品库")
    if not vault_dir.exists():
        pytest.skip("Local Vault not available")
    records = load_catalog(vault_dir)
    summary = summarize_catalog(records)
    assert summary["total_in_vault"] == 309
    assert summary["extra_catalog_count"] == 24
    assert summary["total_catalog"] == 333
    assert summary["non_trackable"] == 3
    assert summary["trackable"] == 330
    by_slug = {r.slug: r for r in records}
    assert by_slug["BD_Ticker"].is_trackable is False
    assert by_slug["F"].aia_code == "R03"
    assert by_slug["Z01_F"].twin_code == "V02"
    assert by_slug["V02_F"].twin_code == "Z01"
    assert by_slug["BD_IB01"].yahoo_ticker == "IB01.L"
    assert by_slug["BD_IB01"].fee_pct == 0.07
    assert by_slug["BD_IWDA"].fee_pct == 0.20
    assert by_slug["BD_VHYD"].is_distributing is True
    assert by_slug["CN_016701"].primary_source == "eastmoney_open"
    assert by_slug["HK_513690"].cn_code == "sh513690"
    assert by_slug["MM_9096"].yahoo_ticker == "9096.HK"
    assert by_slug["MM_9096"].currency == "USD"
    assert by_slug["BD_UYLX"].currency == "GBP"
    assert by_slug["BD_UYLX"].is_distributing is True
    for jp_slug in ("JP_1489", "JP_1592", "JP_DFJ", "JP_SCJ"):
        assert by_slug[jp_slug].fee_pct is None

    # All 24 supplemental EU_* ETFs must carry IE ISIN, USD currency, and is_vault_native=False
    extra_eu = [r for r in records if r.slug.startswith("EU_")]
    assert len(extra_eu) == 24
    for ex in extra_eu:
        assert ex.is_vault_native is False
        assert ex.currency == "USD"
        assert (ex.isin or "").startswith("IE")
        assert ex.fee_pct is not None and 0.01 <= ex.fee_pct <= 1.0
    assert by_slug["EU_CSPX"].twin_code == "IUSA"
    assert by_slug["EU_SPYL"].fee_pct == 0.03
    assert by_slug["EU_IUSA"].yahoo_ticker == "IDUS.L"
    assert by_slug["EU_IB0D"].yahoo_ticker == "IBTU.L"
    assert by_slug["EU_VDTY"].is_distributing is True

    # Ensure writeback_to_vault skips non-vault EU_* funds so Vault stays strictly R3-isolated
    from wonder_quant.models import FundMetrics
    from wonder_quant.writeback import writeback_to_vault

    mock_vault = tmp_path / "vault"
    mock_vault.mkdir()
    sample_funds = [by_slug["BD_IB01"], by_slug["EU_CSPX"]]
    sample_metrics = [
        FundMetrics(slug="BD_IB01", as_of_date="2026-11-25", latest_nav=122.78, latest_nav_currency="USD", data_tier="A"),
        FundMetrics(slug="EU_CSPX", as_of_date="2026-11-25", latest_nav=763.71, latest_nav_currency="USD", data_tier="A"),
    ]
    wb_res = writeback_to_vault(mock_vault, sample_funds, sample_metrics, allow_blackout_override=True)
    assert wb_res["written_md"] == 1
    assert (mock_vault / "funds" / "_quant" / "BD_IB01.md").exists()
    assert not (mock_vault / "funds" / "_quant" / "EU_CSPX.md").exists()

    # Institutional Core vs. Satellite enforcement across all 330 trackable funds
    trackable = [r for r in records if r.is_trackable]
    assert all(r.role in ("核心", "卫星") for r in trackable)
    # High-Yield, EM/Asia/China & Covered-Call assets MUST stay Satellite
    for sat_slug in (
        "I28_F", "G16_F", "P08_F", "X15_F", "F16_F", "Z12_F", "J07_F",
        "NB1_F", "I27_F", "Y02_F", "N01_F", "PC4_F", "EU_IHYU", "BD_HYG", "C03_F", "C09_F",
        "CN_515080", "Z01_F", "V02_F", "US_DIVO",
    ):
        assert by_slug[sat_slug].role == "卫星", f"{sat_slug} must be Satellite"
    # Broad high-quality Core assets (including Global/US Dividend & Equity Income) MUST be Core
    for core_slug in (
        "EU_CSPX", "EU_VWRA", "BD_IWDA", "INTL_VT", "BD_AGG", "EU_AGGU",
        "BD_IB01", "CG9_F", "M11_F", "B01_F", "W06_F", "Z36_F", "A22_F", "CG1_F", "A05_F", "R03_F", "Z33_F",
        "BD_VHYA", "BD_VHYD", "US_SCHD", "US_VYM", "US_VIG", "I17_F", "Z17_F", "J16_F", "R51_F", "Z51_F",
    ):
        assert by_slug[core_slug].role == "核心", f"{core_slug} must be Core"


def test_sanitize_yahoo_series_fixes_uylx_and_glitches() -> None:
    from wonder_quant.catalog import _parse_fee_pct
    from wonder_quant.fetchers.yahoo import sanitize_yahoo_series_df

    # Fee parser guards against withholding tax percentages
    assert _parse_fee_pct("1.25%") == 1.25
    assert _parse_fee_pct("20.00%") is None
    assert _parse_fee_pct("税率20%") is None

    # Simulate BD_UYLX: GBP ~3.72 with GBp ~372 regime blocks, a pence dividend on GBP NAV, and a pence dividend on GBp NAV
    dates = pd.date_range("2026-06-01", periods=20, freq="B").strftime("%Y-%m-%d").tolist()
    navs = [3.70] * 20
    adjs = [3.65] * 20
    divs = [0.0] * 20

    # Pence dividend reported on pound NAV
    navs[5], adjs[5], divs[5] = 3.767, 3.766, 4.8625
    # 4-bar 100x pence block with pence dividend inside block
    for j in range(10, 14):
        navs[j], adjs[j] = 361.6, 361.6
    divs[12] = 4.598
    navs[-1], adjs[-1] = 3.72225, 3.72225

    df = pd.DataFrame({"nav_date": dates, "nav": navs, "adj_nav": adjs, "dividend": divs})
    cleaned = sanitize_yahoo_series_df(df, ticker="UYLX.L")
    assert cleaned["nav"].max() < 10.0
    assert abs(float(cleaned.loc[5, "dividend"]) - 0.048625) < 1e-6
    assert abs(float(cleaned.loc[12, "dividend"]) - 0.04598) < 1e-6

    uylx_fund = FundRecord(slug="BD_UYLX", code="UYLX", yahoo_ticker="UYLX.L", name="UYLX", asset_class="固定收益", currency="GBP", is_distributing=True)
    m_list = compute_all_metrics([uylx_fund], {"BD_UYLX": cleaned}, {}, as_of_date=dates[-1])
    uylx_m = m_list[0]
    assert uylx_m.div_yield_ttm is not None
    assert 0.02 < uylx_m.div_yield_ttm < 0.04

    # 2-bar asymmetric transient glitch (like JP_1489: 1/30x then 3.33x) repaired while normal vol stays realistic
    g_dates = pd.date_range("2026-01-01", periods=15, freq="B").strftime("%Y-%m-%d").tolist()
    g_nav = [2080.0] * 15
    g_nav[6], g_nav[7] = 70.6, 6926.67
    g_df = sanitize_yahoo_series_df(pd.DataFrame({"nav_date": g_dates, "nav": g_nav, "adj_nav": g_nav, "dividend": [0.0] * 15}))
    assert 1900.0 < float(g_df.loc[6, "nav"]) < 2200.0
    assert 1900.0 < float(g_df.loc[7, "nav"]) < 2200.0

    # Tencent hfq implied dividend inference from adj_nav / nav divergence (~4% realized distribution yield)
    cn_dates = pd.date_range("2025-01-01", periods=260, freq="B").strftime("%Y-%m-%d").tolist()
    cn_nav = [1.00] * 260
    cn_adj = [1.00 * (1.04 ** (i / 259.0)) for i in range(260)]
    cn_df = pd.DataFrame({"nav_date": cn_dates, "nav": cn_nav, "adj_nav": cn_adj, "dividend": [0.0] * 260})
    cn_fund = FundRecord(slug="CN_515080", code="515080", cn_code="sh515080", name="中证红利ETF", asset_class="股票", currency="CNY", primary_source="tencent_hfq", is_distributing=True)
    cn_m = compute_all_metrics([cn_fund], {"CN_515080": cn_df}, {}, as_of_date=cn_dates[-1])[0]
    assert cn_m.div_yield_ttm is not None
    assert 0.03 < cn_m.div_yield_ttm < 0.05


def test_incremental_stitch_rescales_adj_history() -> None:
    existing = pd.DataFrame(
        [
            {"slug": "SPY_T", "nav_date": "2026-11-16", "nav": 100.0, "adj_nav": 90.0, "dividend": 0.0, "series_type": "market_etf", "source": "yfinance"},
            {"slug": "SPY_T", "nav_date": "2026-11-17", "nav": 101.0, "adj_nav": 90.9, "dividend": 0.0, "series_type": "market_etf", "source": "yfinance"},
            {"slug": "SPY_T", "nav_date": "2026-11-18", "nav": 102.0, "adj_nav": 91.8, "dividend": 0.0, "series_type": "market_etf", "source": "yfinance"},
        ]
    )
    # New ex-div shifted Yahoo Adj Close by 1.05x on overlap day 2026-11-18
    incoming = pd.DataFrame(
        [
            {"slug": "SPY_T", "nav_date": "2026-11-18", "nav": 102.0, "adj_nav": 96.39, "dividend": 0.0, "series_type": "market_etf", "source": "yfinance"},
            {"slug": "SPY_T", "nav_date": "2026-11-19", "nav": 103.0, "adj_nav": 97.335, "dividend": 0.0, "series_type": "market_etf", "source": "yfinance"},
        ]
    )
    out = _stitch_incremental_series(existing, incoming, "nav_date", "adj_nav", "slug", "SPY_T")
    r_17 = float(out.loc[out["nav_date"] == "2026-11-17", "adj_nav"].iloc[0])
    assert abs(r_17 - 95.445) < 1e-3
