from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from wonder_quant import __version__
from wonder_quant.alerting import send_local_alert
from wonder_quant.catalog import load_catalog
from wonder_quant.compute import compute_all_metrics
from wonder_quant.config import CONFIG_DIR, Settings, now_hkt
from wonder_quant.d1_client import D1Client
from wonder_quant.fetchers import CircuitOpenError
from wonder_quant.fetchers.aia import fetch_aia_tmp2_snapshot
from wonder_quant.fetchers.csv_import import load_manual_csv
from wonder_quant.fetchers.eastmoney import fetch_eastmoney_batch
from wonder_quant.fetchers.tencent import fetch_tencent_batch
from wonder_quant.fetchers.yahoo import fetch_yahoo_batch
from wonder_quant.macro import fetch_macro_snapshot
from wonder_quant.models import FundMetrics, FundRecord, MacroSnapshot, PipelineRunSummary
from wonder_quant.storage import (
    FetchLedger,
    atomic_write_json,
    atomic_write_parquet,
    read_parquet_or_empty,
)
from wonder_quant.writeback import writeback_to_vault

NAV_COLS = ["slug", "nav_date", "nav", "adj_nav", "dividend", "series_type", "source"]
FX_COLS = ["pair", "rate_date", "rate", "source"]
BM_COLS = ["code", "currency", "nav_date", "close_price", "adj_close"]


def _load_benchmarks_cfg() -> dict[str, Any]:
    return yaml.safe_load((CONFIG_DIR / "benchmarks.yaml").read_text(encoding="utf-8")) or {}


def _merge_nav_frames(existing: pd.DataFrame, incoming: pd.DataFrame) -> pd.DataFrame:
    if existing.empty:
        combined = incoming.copy()
    elif incoming.empty:
        combined = existing.copy()
    else:
        combined = pd.concat([existing, incoming], ignore_index=True)
    if combined.empty:
        return pd.DataFrame(columns=NAV_COLS)
    # Priority: manual_csv > official_aia > market_etf/cn_open_fund > proxy_underlying
    prio = {"proxy_underlying": 1, "market_etf": 2, "cn_open_fund": 2, "official_aia": 3, "manual_csv": 4}
    combined["_prio"] = combined["series_type"].map(prio).fillna(1)
    combined = (
        combined.sort_values(["slug", "nav_date", "_prio"])
        .drop_duplicates(subset=["slug", "nav_date"], keep="last")
        .drop(columns=["_prio"])
        .reset_index(drop=True)
    )
    return combined[NAV_COLS]


def _stitch_aia_official_onto_proxy(df_slug: pd.DataFrame) -> pd.DataFrame:
    """
    When an AIA fund has historical proxy_underlying series AND newer official_aia snapshots,
    chain official_aia adj_nav seamlessly onto the last proxy adj_nav so returns remain smooth.
    """
    work = df_slug.sort_values("nav_date").reset_index(drop=True)
    if "official_aia" not in set(work["series_type"]) or "proxy_underlying" not in set(work["series_type"]):
        return work
    # Find latest date with proxy_underlying before official_aia tail
    proxy_rows = work[work["series_type"] == "proxy_underlying"]
    aia_rows = work[work["series_type"] == "official_aia"]
    if proxy_rows.empty or aia_rows.empty:
        return work
    first_aia_dt = aia_rows["nav_date"].iloc[0]
    anchor_candidates = proxy_rows[proxy_rows["nav_date"] <= first_aia_dt]
    if anchor_candidates.empty:
        return work
    anchor_adj = float(anchor_candidates["adj_nav"].iloc[-1])
    base_aia_nav = float(aia_rows["nav"].iloc[0])
    if base_aia_nav <= 0 or anchor_adj <= 0:
        return work
    scale = anchor_adj / base_aia_nav
    mask = work["series_type"] == "official_aia"
    work.loc[mask, "adj_nav"] = (work.loc[mask, "nav"].astype(float) * scale).round(6)
    return work


def run_fetch(
    settings: Settings,
    force: bool = False,
    dry_run: bool = False,
    limit_yahoo: int | None = None,
) -> PipelineRunSummary:
    settings.ensure_runtime_dirs()
    today_str = now_hkt().strftime("%Y-%m-%d")
    started_at = now_hkt().isoformat(timespec="seconds")
    run_id = f"daily-{now_hkt().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    ledger = FetchLedger(settings.state_dir)

    funds = load_catalog(settings.vault_fund_dir)
    trackable = [f for f in funds if f.is_trackable]
    bm_cfg = _load_benchmarks_cfg()

    summary = PipelineRunSummary(
        run_id=run_id,
        job_type="daily_data",
        started_at=started_at,
        total_funds=len(trackable),
        host_name=settings.host_id,
    )

    if dry_run:
        summary.status = "ok"
        summary.finished_at = now_hkt().isoformat(timespec="seconds")
        return summary

    nav_path = settings.cache_dir / "nav.parquet"
    fx_path = settings.cache_dir / "fx.parquet"
    bm_path = settings.cache_dir / "benchmarks.parquet"

    existing_nav = read_parquet_or_empty(nav_path, NAV_COLS)
    existing_fx = read_parquet_or_empty(fx_path, FX_COLS)
    existing_bm = read_parquet_or_empty(bm_path, BM_COLS)

    new_nav_rows: list[pd.DataFrame] = []
    alerts: list[str] = []
    circuit_tripped = False

    # ── 1. AIA HK FundInfo2 (single request) ───────────────────────────────
    aia_funds = [f for f in trackable if f.primary_source == "aia_fundinfo2" and f.aia_code]
    aia_by_code = {f.aia_code.upper(): f for f in aia_funds if f.aia_code}
    if force or not ledger.fetched_today("aia_fundinfo2", today_str):
        try:
            aia_snap = fetch_aia_tmp2_snapshot(proxy=settings.https_proxy or None)
            rows = []
            aia_dates: list[str] = []
            for item in aia_snap:
                f = aia_by_code.get(item["aia_code"])
                if not f:
                    continue
                aia_dates.append(item["nav_date"])
                rows.append(
                    {
                        "slug": f.slug,
                        "nav_date": item["nav_date"],
                        "nav": item["nav"],
                        "adj_nav": item["nav"],
                        "dividend": 0.0,
                        "series_type": "official_aia",
                        "source": "aia_fundinfo2",
                    }
                )
            if rows:
                new_nav_rows.append(pd.DataFrame(rows))
                summary.aia_valuation_date = max(aia_dates)
                ledger.mark_source("aia_fundinfo2", today_str, "ok", f"{len(rows)} funds @ {summary.aia_valuation_date}")
            else:
                alerts.append("AIA FundInfo2 returned 0 matched funds")
        except CircuitOpenError as exc:
            circuit_tripped = True
            alerts.append(str(exc))
            ledger.mark_source("aia_fundinfo2", today_str, "circuit_open", str(exc))
        except Exception as exc:
            alerts.append(f"AIA fetch error: {exc}")

    # ── 2. Tencent hfq (A-share / HK-Connect ETFs + sh510300 benchmark) ────
    tx_funds = [f for f in trackable if f.primary_source == "tencent_hfq" and f.cn_code]
    if force or not ledger.fetched_today("tencent_hfq", today_str):
        tx_codes = list({f.cn_code for f in tx_funds if f.cn_code} | {"sh510300"})
        try:
            tx_map, tx_errs = fetch_tencent_batch(tx_codes, years=settings.history_years)
            for f in tx_funds:
                if f.cn_code and f.cn_code in tx_map:
                    df = tx_map[f.cn_code].copy()
                    df["slug"] = f.slug
                    df["series_type"] = "market_etf"
                    df["source"] = "tencent_hfq"
                    new_nav_rows.append(df[NAV_COLS])
            if "sh510300" in tx_map:
                b_df = tx_map["sh510300"].copy()
                b_df["code"] = "sh510300"
                b_df["currency"] = "CNY"
                b_df = b_df.rename(columns={"nav": "close_price", "adj_nav": "adj_close"})
                existing_bm = (
                    pd.concat([existing_bm, b_df[BM_COLS]], ignore_index=True)
                    .drop_duplicates(subset=["code", "nav_date"], keep="last")
                    .sort_values(["code", "nav_date"])
                )
            ledger.mark_source("tencent_hfq", today_str, "ok", f"ok={len(tx_map)} err={len(tx_errs)}")
        except CircuitOpenError as exc:
            circuit_tripped = True
            alerts.append(str(exc))
            ledger.mark_source("tencent_hfq", today_str, "circuit_open", str(exc))
        except Exception as exc:
            alerts.append(f"Tencent fetch error: {exc}")

    # ── 3. EastMoney / AkShare (CN open-end mutual funds) ──────────────────
    em_funds = [f for f in trackable if f.primary_source == "eastmoney_open" and f.cn_code]
    if em_funds and (force or not ledger.fetched_today("eastmoney_open", today_str)):
        try:
            em_map, em_errs = fetch_eastmoney_batch([f.cn_code for f in em_funds if f.cn_code], years=settings.history_years)
            for f in em_funds:
                if f.cn_code and f.cn_code in em_map:
                    df = em_map[f.cn_code].copy()
                    df["slug"] = f.slug
                    df["series_type"] = "cn_open_fund"
                    df["source"] = "eastmoney_open"
                    new_nav_rows.append(df[NAV_COLS])
            ledger.mark_source("eastmoney_open", today_str, "ok", f"ok={len(em_map)} err={len(em_errs)}")
        except CircuitOpenError as exc:
            circuit_tripped = True
            alerts.append(str(exc))
            ledger.mark_source("eastmoney_open", today_str, "circuit_open", str(exc))
        except Exception as exc:
            alerts.append(f"EastMoney fetch error: {exc}")

    # ── 4. Yahoo Finance (yfinance curl_cffi): ETFs + AIA 0P/ISIN backfill + Benchmarks + FX
    if force or not ledger.fetched_today("yfinance", today_str):
        yf_fund_targets: list[tuple[FundRecord, str, str]] = []
        for f in trackable:
            if f.primary_source == "yfinance" and f.yahoo_ticker:
                yf_fund_targets.append((f, f.yahoo_ticker, "market_etf"))
            elif f.primary_source == "aia_fundinfo2" and f.yahoo_ticker:
                yf_fund_targets.append((f, f.yahoo_ticker, "proxy_underlying"))

        bm_tickers = {
            code: cfg["ticker"]
            for code, cfg in (bm_cfg.get("benchmarks") or {}).items()
            if cfg.get("source") == "yfinance"
        }
        fx_tickers = {pair: cfg["yahoo_ticker"] for pair, cfg in (bm_cfg.get("fx_pairs") or {}).items()}

        fund_tickers = list(dict.fromkeys(t for _, t, _ in yf_fund_targets))
        if limit_yahoo is not None:
            fund_tickers = fund_tickers[:limit_yahoo]
        all_yf = list(dict.fromkeys(list(bm_tickers.values()) + list(fx_tickers.values()) + fund_tickers))

        try:
            yf_map, yf_errs = fetch_yahoo_batch(all_yf, years=settings.history_years)
            for f, ticker, s_type in yf_fund_targets:
                if ticker in yf_map:
                    df = yf_map[ticker].copy()
                    df["slug"] = f.slug
                    df["series_type"] = s_type
                    df["source"] = "yfinance"
                    new_nav_rows.append(df[NAV_COLS])

            # Benchmarks
            bm_frames = [existing_bm]
            for code, cfg in (bm_cfg.get("benchmarks") or {}).items():
                if cfg.get("source") == "yfinance" and cfg["ticker"] in yf_map:
                    b_df = yf_map[cfg["ticker"]].copy()
                    b_df["code"] = code
                    b_df["currency"] = cfg.get("currency", "USD")
                    b_df = b_df.rename(columns={"nav": "close_price", "adj_nav": "adj_close"})
                    bm_frames.append(b_df[BM_COLS])
            existing_bm = (
                pd.concat([x for x in bm_frames if not x.empty], ignore_index=True)
                .drop_duplicates(subset=["code", "nav_date"], keep="last")
                .sort_values(["code", "nav_date"])
                if any(not x.empty for x in bm_frames)
                else existing_bm
            )

            # FX pairs
            fx_frames = [existing_fx]
            for pair, y_tick in fx_tickers.items():
                if y_tick in yf_map:
                    f_df = yf_map[y_tick][["nav_date", "nav"]].rename(columns={"nav_date": "rate_date", "nav": "rate"})
                    f_df["pair"] = pair
                    f_df["source"] = "yfinance"
                    fx_frames.append(f_df[FX_COLS])
            existing_fx = (
                pd.concat([x for x in fx_frames if not x.empty], ignore_index=True)
                .drop_duplicates(subset=["pair", "rate_date"], keep="last")
                .sort_values(["pair", "rate_date"])
                if any(not x.empty for x in fx_frames)
                else existing_fx
            )
            ledger.mark_source("yfinance", today_str, "ok", f"ok={len(yf_map)} err={len(yf_errs)}")
        except CircuitOpenError as exc:
            circuit_tripped = True
            alerts.append(str(exc))
            ledger.mark_source("yfinance", today_str, "circuit_open", str(exc))
        except Exception as exc:
            alerts.append(f"Yahoo batch error: {exc}")

    # Persist updated caches atomically
    incoming_df = pd.concat(new_nav_rows, ignore_index=True) if new_nav_rows else pd.DataFrame(columns=NAV_COLS)
    merged_nav = _merge_nav_frames(existing_nav, incoming_df)
    if not merged_nav.empty:
        atomic_write_parquet(nav_path, merged_nav)
    if not existing_fx.empty:
        atomic_write_parquet(fx_path, existing_fx)
    if not existing_bm.empty:
        atomic_write_parquet(bm_path, existing_bm)

    # Summarize coverage
    covered_slugs = set(merged_nav["slug"].unique()) if not merged_nav.empty else set()
    summary.succeeded_funds = sum(1 for f in trackable if f.slug in covered_slugs)
    summary.failed_funds = summary.total_funds - summary.succeeded_funds
    summary.failure_rate = round(summary.failed_funds / max(1, summary.total_funds), 4)
    if not merged_nav.empty:
        summary.max_valuation_date = str(merged_nav["nav_date"].max())
        aia_only = merged_nav[merged_nav["series_type"] == "official_aia"]
        if not aia_only.empty and not summary.aia_valuation_date:
            summary.aia_valuation_date = str(aia_only["nav_date"].max())

    if summary.failure_rate > settings.failure_rate_alert_threshold:
        alerts.append(f"Fetch failure rate {summary.failure_rate:.1%} exceeded threshold {settings.failure_rate_alert_threshold:.0%}")

    summary.alerts = alerts
    summary.finished_at = now_hkt().isoformat(timespec="seconds")
    if circuit_tripped:
        summary.status = "circuit_open"
    elif alerts:
        summary.status = "partial"
    else:
        summary.status = "ok"

    atomic_write_json(settings.state_dir / "last_fetch_run.json", summary.model_dump())
    if alerts:
        send_local_alert(settings, f"Wonder Quant Fetch ({summary.status})", alerts, level="ERROR" if circuit_tripped else "WARN")

    # Non-fatal macro & commodity snapshot refresh
    try:
        if force or not ledger.fetched_today("macro_snapshot", today_str):
            run_macro(settings)
            ledger.mark_source("macro_snapshot", today_str, "ok", "macro synced")
    except Exception as exc:
        summary.alerts.append(f"Macro snapshot skipped: {exc}")

    return summary


def run_macro(settings: Settings) -> MacroSnapshot:
    settings.ensure_runtime_dirs()
    snapshot, _errors = fetch_macro_snapshot(years=2)
    atomic_write_json(settings.cache_dir / "macro_snapshot.json", snapshot.model_dump())
    return snapshot


def run_compute(settings: Settings) -> list[FundMetrics]:
    settings.ensure_runtime_dirs()
    funds = load_catalog(settings.vault_fund_dir)
    nav_df = read_parquet_or_empty(settings.cache_dir / "nav.parquet", NAV_COLS)
    bm_df = read_parquet_or_empty(settings.cache_dir / "benchmarks.parquet", BM_COLS)

    nav_by_slug: dict[str, pd.DataFrame] = {}
    if not nav_df.empty:
        for slug, grp in nav_df.groupby("slug"):
            nav_by_slug[str(slug)] = _stitch_aia_official_onto_proxy(grp)

    bm_by_code: dict[str, pd.DataFrame] = {}
    if not bm_df.empty:
        for code, grp in bm_df.groupby("code"):
            bm_by_code[str(code)] = grp.reset_index(drop=True)

    metrics = compute_all_metrics(
        funds=funds,
        nav_by_slug=nav_by_slug,
        benchmarks=bm_by_code,
        risk_free_rate=settings.risk_free_rate,
        anomaly_threshold=settings.anomaly_daily_move_threshold,
    )
    atomic_write_json(settings.state_dir / "latest_metrics.json", [m.model_dump() for m in metrics])

    anomalies = [f"{m.slug}: {','.join(m.anomalies)}" for m in metrics if m.anomalies and "no_nav_series" not in m.anomalies]
    if anomalies:
        send_local_alert(settings, f"Wonder Quant 检测到 {len(anomalies)} 只基金异常波动", anomalies[:15], level="WARN")
    return metrics


def run_push_d1(settings: Settings, full: bool = False) -> dict[str, int]:
    settings.ensure_runtime_dirs()
    funds = load_catalog(settings.vault_fund_dir)
    metrics_file = settings.state_dir / "latest_metrics.json"
    if not metrics_file.exists():
        metrics = run_compute(settings)
    else:
        import json

        metrics = [FundMetrics(**x) for x in json.loads(metrics_file.read_text(encoding="utf-8"))]

    nav_df = read_parquet_or_empty(settings.cache_dir / "nav.parquet", NAV_COLS)
    fx_df = read_parquet_or_empty(settings.cache_dir / "fx.parquet", FX_COLS)
    bm_df = read_parquet_or_empty(settings.cache_dir / "benchmarks.parquet", BM_COLS)

    nav_by_slug = {
        str(slug): _stitch_aia_official_onto_proxy(grp)
        for slug, grp in (nav_df.groupby("slug") if not nav_df.empty else [])
    }
    fx_by_pair = {str(pair): grp.reset_index(drop=True) for pair, grp in (fx_df.groupby("pair") if not fx_df.empty else [])}
    bm_by_code = {
        str(code): (str(grp["currency"].iloc[-1]), grp.reset_index(drop=True))
        for code, grp in (bm_df.groupby("code") if not bm_df.empty else [])
    }

    run_summary: PipelineRunSummary | None = None
    run_file = settings.state_dir / "last_fetch_run.json"
    if run_file.exists():
        import json

        run_summary = PipelineRunSummary(**json.loads(run_file.read_text(encoding="utf-8")))

    macro_snapshot: MacroSnapshot | None = None
    macro_file = settings.cache_dir / "macro_snapshot.json"
    if macro_file.exists():
        import json

        macro_snapshot = MacroSnapshot(**json.loads(macro_file.read_text(encoding="utf-8")))

    ledger = FetchLedger(settings.state_dir)
    client = D1Client(settings)
    stats = client.push_all(
        funds=funds,
        metrics=metrics,
        nav_by_slug=nav_by_slug,
        fx_by_pair=fx_by_pair,
        benchmarks=bm_by_code,
        ledger=ledger,
        full=full,
        run_summary=run_summary,
        macro_snapshot=macro_snapshot,
    )
    tier_counts: dict[str, int] = {}
    for m in metrics:
        tier_counts[m.data_tier] = tier_counts.get(m.data_tier, 0) + 1
    client.send_heartbeat(
        wq_version=__version__,
        last_fetch_ok_at=now_hkt().isoformat(timespec="seconds"),
        last_aia_val_date=run_summary.aia_valuation_date if run_summary else None,
        metrics_summary={"tiers": tier_counts, "total": len(metrics), "last_push": stats},
    )
    return stats


def run_writeback(settings: Settings, allow_blackout_override: bool = False) -> dict[str, int]:
    settings.ensure_runtime_dirs()
    funds = load_catalog(settings.vault_fund_dir)
    metrics_file = settings.state_dir / "latest_metrics.json"
    if not metrics_file.exists():
        metrics = run_compute(settings)
    else:
        import json

        metrics = [FundMetrics(**x) for x in json.loads(metrics_file.read_text(encoding="utf-8"))]

    res = writeback_to_vault(
        vault_fund_dir=settings.vault_fund_dir,
        funds=funds,
        metrics=metrics,
        allow_blackout_override=allow_blackout_override,
    )
    atomic_write_json(
        settings.state_dir / "last_writeback.json",
        {"completed_at": now_hkt().isoformat(timespec="seconds"), **res},
    )
    if settings.cf_account_id and settings.cf_api_token:
        try:
            D1Client(settings).send_heartbeat(
                wq_version=__version__,
                last_writeback_ok_at=now_hkt().isoformat(timespec="seconds"),
            )
        except Exception:
            pass
    return res


def run_import_csv(settings: Settings, csv_path: Path, slug: str) -> int:
    settings.ensure_runtime_dirs()
    df = load_manual_csv(csv_path)
    df["slug"] = slug
    df["series_type"] = "manual_csv"
    df["source"] = f"csv:{csv_path.name}"
    nav_path = settings.cache_dir / "nav.parquet"
    existing = read_parquet_or_empty(nav_path, NAV_COLS)
    merged = _merge_nav_frames(existing, df[NAV_COLS])
    atomic_write_parquet(nav_path, merged)
    return len(df)
