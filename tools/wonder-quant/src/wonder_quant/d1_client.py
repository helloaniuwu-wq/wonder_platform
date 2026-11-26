from __future__ import annotations

import json
import math
import time
from datetime import date
from typing import Any

import httpx
import pandas as pd

from wonder_quant.config import Settings, now_hkt
from wonder_quant.fetchers.yahoo import sanitize_yahoo_series_df
from wonder_quant.models import (
    FundMetrics,
    FundRecord,
    MacroSnapshot,
    PipelineRunSummary,
)
from wonder_quant.storage import FetchLedger, sha256_json


def _round_sig(val: float, sig: int = 5) -> float:
    v = float(val)
    if v == 0.0 or not math.isfinite(v):
        return 0.0
    digits = sig - 1 - int(math.floor(math.log10(abs(v))))
    return round(v, max(0, min(6, digits)))


def _encode_delta_dates(dates: list[str]) -> tuple[str | None, list[int]]:
    if not dates:
        return None, []
    d0 = str(dates[0])[:10]
    prev = date.fromisoformat(d0)
    dd: list[int] = []
    for ds in dates[1:]:
        cur = date.fromisoformat(str(ds)[:10])
        dd.append((cur - prev).days)
        prev = cur
    return d0, dd


def _end_date_from_delta(d0: str | None, dd: list[int]) -> str | None:
    if not d0:
        return None
    from datetime import timedelta

    return (date.fromisoformat(d0) + timedelta(days=sum(dd))).isoformat()


def pack_fund_series(df: pd.DataFrame, default_series_type: str, default_source: str) -> tuple[dict[str, Any], str]:
    """Pack a fund's daily DataFrame into delta-date columnar JSON (<100 KB SQL limit even at 15Y)."""
    work = df.sort_values("nav_date").drop_duplicates(subset=["nav_date"], keep="last").reset_index(drop=True)
    if len(work) >= 3:
        work = sanitize_yahoo_series_df(work)
    dates = [str(x)[:10] for x in work["nav_date"].tolist()]
    d0, dd = _encode_delta_dates(dates)
    navs = [_round_sig(x, 5) for x in work["nav"].tolist()]
    adjs = [_round_sig(x, 5) for x in work["adj_nav"].tolist()]
    sparse_divs: list[list[float]] = []
    if "dividend" in work.columns:
        for i, dv in enumerate(work["dividend"].tolist()):
            if dv is not None and float(dv) > 0:
                sparse_divs.append([i, _round_sig(dv, 5)])

    s_type = default_series_type
    if "series_type" in work.columns and not work["series_type"].dropna().empty:
        types = set(work["series_type"].dropna().astype(str))
        if "official_aia" in types and "proxy_underlying" in types:
            s_type = "proxy_underlying"
        else:
            s_type = str(work["series_type"].dropna().iloc[-1])

    payload: dict[str, Any] = {
        "d0": d0,
        "dd": dd,
        "n": navs,
        "t": s_type,
        "s": default_source,
    }
    if any(abs(a - n) > max(1e-6, 1e-5 * abs(n)) for a, n in zip(adjs, navs, strict=False)):
        payload["a"] = adjs
    if sparse_divs:
        payload["v"] = sparse_divs
    return payload, sha256_json(payload)


def pack_fx_series(df: pd.DataFrame) -> tuple[dict[str, Any], str, float]:
    work = df.sort_values("rate_date").drop_duplicates(subset=["rate_date"], keep="last").reset_index(drop=True)
    dates = [str(x)[:10] for x in work["rate_date"].tolist()]
    d0, dd = _encode_delta_dates(dates)
    rates = [_round_sig(x, 5) for x in work["rate"].tolist()]
    payload = {"d0": d0, "dd": dd, "r": rates}
    latest = float(work["rate"].iloc[-1]) if not work.empty else 1.0
    return payload, sha256_json(payload), round(latest, 6)


def pack_benchmark_series(df: pd.DataFrame) -> tuple[dict[str, Any], str]:
    work = df.sort_values("nav_date").drop_duplicates(subset=["nav_date"], keep="last").reset_index(drop=True)
    dates = [str(x)[:10] for x in work["nav_date"].tolist()]
    d0, dd = _encode_delta_dates(dates)
    closes = [_round_sig(x, 5) for x in work["close_price"].tolist()]
    adjs = [_round_sig(x, 5) for x in work["adj_close"].tolist()]
    payload: dict[str, Any] = {"d0": d0, "dd": dd, "c": closes}
    if any(abs(a - c) > max(1e-6, 1e-5 * abs(c)) for a, c in zip(adjs, closes, strict=False)):
        payload["a"] = adjs
    return payload, sha256_json(payload)


class D1Client:
    """
    Cloudflare D1 REST API client optimized for D1 Free Tier (100k rows written/day):
    - Uses packed 1-row-per-instrument tables (wq_fund_series / wq_fx_series / wq_benchmark_series)
    - Uses local SHA256 dirty tracking to skip unchanged rows (0 write cost on holidays/unchanged records)
    """

    def __init__(self, settings: Settings, http_client: httpx.Client | None = None) -> None:
        self.settings = settings
        self.base_url = (
            f"https://api.cloudflare.com/client/v4/accounts/{settings.cf_account_id}"
            f"/d1/database/{settings.cf_d1_database_id}/query"
        )
        self._external_client = http_client

    def _client(self) -> httpx.Client:
        if self._external_client is not None:
            return self._external_client
        kwargs: dict[str, Any] = {
            "timeout": 45.0,
            "headers": {
                "Authorization": f"Bearer {self.settings.cf_api_token}",
                "Content-Type": "application/json",
            },
        }
        if self.settings.https_proxy:
            kwargs["proxy"] = self.settings.https_proxy
        return httpx.Client(**kwargs)

    def execute_statement(
        self,
        sql: str,
        params: list[Any] | None = None,
        client_override: httpx.Client | None = None,
    ) -> dict[str, Any]:
        if not self.settings.cf_account_id or not self.settings.cf_api_token:
            raise RuntimeError("Missing CF_ACCOUNT_ID or CF_API_TOKEN in D:\\WonderQuant\\.env")
        client = client_override or self._client()
        close_after = client_override is None and self._external_client is None
        try:
            body: dict[str, Any] = {"sql": sql}
            if params is not None:
                body["params"] = params
            for attempt in range(3):
                resp = client.post(self.base_url, json=body)
                if resp.status_code in (429, 502, 503, 504) and attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                if not data.get("success", False):
                    raise RuntimeError(f"Cloudflare D1 error: {data.get('errors')}")
                return data
            raise RuntimeError("Cloudflare D1 retry budget exhausted")
        finally:
            if close_after:
                client.close()

    def push_all(
        self,
        funds: list[FundRecord],
        metrics: list[FundMetrics],
        nav_by_slug: dict[str, pd.DataFrame],
        fx_by_pair: dict[str, pd.DataFrame],
        benchmarks: dict[str, tuple[str, pd.DataFrame]],
        ledger: FetchLedger,
        full: bool = False,
        run_summary: PipelineRunSummary | None = None,
        macro_snapshot: MacroSnapshot | None = None,
    ) -> dict[str, int]:
        stats = {"rows_written": 0, "rows_skipped": 0}
        now_iso = now_hkt().isoformat(timespec="seconds")
        metrics_by_slug = {m.slug: m for m in metrics}
        shared_client = self._external_client or self._client()
        close_shared = self._external_client is None

        try:
            # 1. Upsert wq_funds preserving bond/holdings enrichment columns via ON CONFLICT DO UPDATE
            fund_sql = """
                INSERT INTO wq_funds (
                  slug, code, aia_code, isin, yahoo_ticker, cn_code, name, name_en, manager,
                  asset_class, ilas_platform, currency, risk_class, morningstar_stars, fee_pct,
                  role, fit_plans_json, tags_json, commentary, twin_code, is_distributing,
                  benchmark_code, primary_source, data_tier, is_trackable, status, vault_last_updated, synced_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slug) DO UPDATE SET
                  code = excluded.code,
                  aia_code = excluded.aia_code,
                  isin = COALESCE(excluded.isin, wq_funds.isin),
                  yahoo_ticker = COALESCE(excluded.yahoo_ticker, wq_funds.yahoo_ticker),
                  cn_code = COALESCE(excluded.cn_code, wq_funds.cn_code),
                  name = excluded.name,
                  name_en = COALESCE(excluded.name_en, wq_funds.name_en),
                  manager = COALESCE(excluded.manager, wq_funds.manager),
                  asset_class = excluded.asset_class,
                  ilas_platform = excluded.ilas_platform,
                  currency = excluded.currency,
                  risk_class = COALESCE(excluded.risk_class, wq_funds.risk_class),
                  morningstar_stars = COALESCE(excluded.morningstar_stars, wq_funds.morningstar_stars),
                  fee_pct = excluded.fee_pct,
                  role = COALESCE(excluded.role, wq_funds.role),
                  fit_plans_json = excluded.fit_plans_json,
                  tags_json = excluded.tags_json,
                  commentary = COALESCE(excluded.commentary, wq_funds.commentary),
                  twin_code = COALESCE(excluded.twin_code, wq_funds.twin_code),
                  is_distributing = excluded.is_distributing,
                  benchmark_code = excluded.benchmark_code,
                  primary_source = excluded.primary_source,
                  data_tier = excluded.data_tier,
                  is_trackable = excluded.is_trackable,
                  status = excluded.status,
                  vault_last_updated = COALESCE(excluded.vault_last_updated, wq_funds.vault_last_updated),
                  synced_at = excluded.synced_at
            """
            for f in funds:
                tier = metrics_by_slug[f.slug].data_tier if f.slug in metrics_by_slug else f.data_tier
                row_obj = {**f.model_dump(), "data_tier": tier}
                digest = sha256_json(row_obj)
                h_key = f"fund:{f.slug}"
                if not full and ledger.get_d1_hash(h_key) == digest:
                    stats["rows_skipped"] += 1
                    continue
                self.execute_statement(
                    fund_sql,
                    [
                        f.slug,
                        f.code,
                        f.aia_code,
                        f.isin,
                        f.yahoo_ticker,
                        f.cn_code,
                        f.name,
                        f.name_en,
                        f.manager,
                        f.asset_class,
                        f.ilas_platform,
                        f.currency,
                        f.risk_class,
                        f.morningstar_stars,
                        f.fee_pct,
                        f.role,
                        json.dumps(f.fit_plans, ensure_ascii=False),
                        json.dumps(f.tags, ensure_ascii=False),
                        f.commentary,
                        f.twin_code,
                        1 if f.is_distributing else 0,
                        f.benchmark_code,
                        f.primary_source,
                        tier,
                        1 if f.is_trackable else 0,
                        f.status,
                        f.vault_last_updated,
                        now_iso,
                    ],
                    client_override=shared_client,
                )
                ledger.set_d1_hash(h_key, digest)
                stats["rows_written"] += 1

            # 2. Upsert wq_fund_series (1 packed row per fund!)
            series_sql = """
                INSERT OR REPLACE INTO wq_fund_series (
                  slug, currency, series_type, source, start_date, end_date, obs_days,
                  series_json, content_sha256, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            fund_map = {f.slug: f for f in funds}
            for slug, df in nav_by_slug.items():
                if df is None or df.empty or slug not in fund_map:
                    continue
                f = fund_map[slug]
                payload, digest = pack_fund_series(df, "market_etf", f.primary_source)
                h_key = f"series:{slug}"
                if not full and ledger.get_d1_hash(h_key) == digest:
                    stats["rows_skipped"] += 1
                    continue
                compact_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                end_dt = _end_date_from_delta(payload.get("d0"), payload.get("dd", []))
                self.execute_statement(
                    series_sql,
                    [
                        slug,
                        f.currency,
                        payload["t"],
                        payload["s"],
                        payload.get("d0"),
                        end_dt,
                        len(payload["n"]),
                        compact_json,
                        digest,
                        now_iso,
                    ],
                    client_override=shared_client,
                )
                ledger.set_d1_hash(h_key, digest)
                stats["rows_written"] += 1

            # 3. Upsert wq_fx_series (1 row per FX pair)
            fx_sql = """
                INSERT OR REPLACE INTO wq_fx_series (
                  pair, start_date, end_date, latest_rate, series_json, content_sha256, source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """
            for pair, df in fx_by_pair.items():
                if df is None or df.empty:
                    continue
                payload, digest, latest = pack_fx_series(df)
                h_key = f"fx:{pair}"
                if not full and ledger.get_d1_hash(h_key) == digest:
                    stats["rows_skipped"] += 1
                    continue
                end_dt = _end_date_from_delta(payload.get("d0"), payload.get("dd", []))
                self.execute_statement(
                    fx_sql,
                    [
                        pair,
                        payload.get("d0"),
                        end_dt,
                        latest,
                        json.dumps(payload, separators=(",", ":")),
                        digest,
                        "yfinance",
                        now_iso,
                    ],
                    client_override=shared_client,
                )
                ledger.set_d1_hash(h_key, digest)
                stats["rows_written"] += 1

            # 4. Upsert wq_benchmark_series (1 row per benchmark)
            bm_sql = """
                INSERT OR REPLACE INTO wq_benchmark_series (
                  code, currency, start_date, end_date, series_json, content_sha256, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """
            for code, (ccy, df) in benchmarks.items():
                if df is None or df.empty:
                    continue
                payload, digest = pack_benchmark_series(df)
                h_key = f"bm:{code}"
                if not full and ledger.get_d1_hash(h_key) == digest:
                    stats["rows_skipped"] += 1
                    continue
                end_dt = _end_date_from_delta(payload.get("d0"), payload.get("dd", []))
                self.execute_statement(
                    bm_sql,
                    [
                        code,
                        ccy,
                        payload.get("d0"),
                        end_dt,
                        json.dumps(payload, separators=(",", ":")),
                        digest,
                        now_iso,
                    ],
                    client_override=shared_client,
                )
                ledger.set_d1_hash(h_key, digest)
                stats["rows_written"] += 1

            # 5. Upsert wq_fund_metrics (1 row per trackable fund)
            metrics_sql = """
                INSERT OR REPLACE INTO wq_fund_metrics (
                  slug, as_of_date, valuation_date, latest_nav, latest_nav_currency,
                  ret_1m, ret_3m, ret_6m, ret_ytd, ret_1y, ret_3y_ann, ret_5y_ann,
                  vol_1y, vol_3y, max_dd_1y, max_dd_3y, max_dd_5y, dd_recovery_days,
                  sharpe_3y, sortino_3y, calmar_3y, beta_3y, alpha_3y, r2_3y, ir_3y,
                  div_yield_ttm, peer_rank_pct, quant_score, quant_grade, obs_days,
                  data_tier, anomalies_json, computed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            for m in metrics:
                m_hash_obj = m.model_dump(exclude={"computed_at"})
                digest = sha256_json(m_hash_obj)
                h_key = f"metrics:{m.slug}"
                if not full and ledger.get_d1_hash(h_key) == digest:
                    stats["rows_skipped"] += 1
                    continue
                self.execute_statement(
                    metrics_sql,
                    [
                        m.slug,
                        m.as_of_date,
                        m.valuation_date,
                        m.latest_nav,
                        m.latest_nav_currency,
                        m.ret_1m,
                        m.ret_3m,
                        m.ret_6m,
                        m.ret_ytd,
                        m.ret_1y,
                        m.ret_3y_ann,
                        m.ret_5y_ann,
                        m.vol_1y,
                        m.vol_3y,
                        m.max_dd_1y,
                        m.max_dd_3y,
                        m.max_dd_5y,
                        m.dd_recovery_days,
                        m.sharpe_3y,
                        m.sortino_3y,
                        m.calmar_3y,
                        m.beta_3y,
                        m.alpha_3y,
                        m.r2_3y,
                        m.ir_3y,
                        m.div_yield_ttm,
                        m.peer_rank_pct,
                        m.quant_score,
                        m.quant_grade,
                        m.obs_days,
                        m.data_tier,
                        json.dumps(m.anomalies, ensure_ascii=False),
                        m.computed_at or now_iso,
                    ],
                    client_override=shared_client,
                )
                ledger.set_d1_hash(h_key, digest)
                stats["rows_written"] += 1

            # 6. Record pipeline run if provided
            if run_summary is not None:
                self.record_pipeline_run(run_summary)
                stats["rows_written"] += 1

            # 7. Upsert daily macro & commodity snapshot if provided
            if macro_snapshot is not None:
                written = self.push_macro_snapshot(macro_snapshot, ledger=ledger, full=full)
                if written > 0:
                    stats["rows_written"] += written
                else:
                    stats["rows_skipped"] += 1

            ledger.save()
            return stats
        finally:
            if close_shared:
                shared_client.close()

    def push_macro_snapshot(
        self,
        snapshot: MacroSnapshot,
        ledger: FetchLedger,
        full: bool = False,
    ) -> int:
        payload_dict = snapshot.model_dump()
        digest = sha256_json(payload_dict)
        h_key = f"macro:{snapshot.as_of_date}"
        if not full and ledger.get_d1_hash(h_key) == digest:
            return 0
        now_iso = now_hkt().isoformat(timespec="seconds")
        sql = """
            INSERT OR REPLACE INTO wq_macro_snapshot (
              as_of_date, us10y_yield, us3m_yield, us5y_yield, yield_curve_10y_3m,
              spy_pe_est, spy_pe_pctile, spy_erp, hsi_pe_pctile,
              gold_price, gold_ma200_pct, wti_oil_price, brent_oil_price, oil_ret_20d,
              copper_price, copper_gold_ratio, copper_gold_trend, dbc_price, dxy_index, hyg_ief_ratio,
              regime_flags_json, payload_json, content_sha256, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        self.execute_statement(
            sql,
            [
                snapshot.as_of_date,
                snapshot.us10y_yield,
                snapshot.us3m_yield,
                snapshot.us5y_yield,
                snapshot.yield_curve_10y_3m,
                snapshot.spy_pe_est,
                snapshot.spy_pe_pctile,
                snapshot.spy_erp,
                snapshot.hsi_pe_pctile,
                snapshot.gold_price,
                snapshot.gold_ma200_pct,
                snapshot.wti_oil_price,
                snapshot.brent_oil_price,
                snapshot.oil_ret_20d,
                snapshot.copper_price,
                snapshot.copper_gold_ratio,
                snapshot.copper_gold_trend,
                snapshot.dbc_price,
                snapshot.dxy_index,
                snapshot.hyg_ief_ratio,
                json.dumps(snapshot.regime_flags, ensure_ascii=False),
                json.dumps(snapshot.indicators, ensure_ascii=False),
                digest,
                now_iso,
            ],
        )
        ledger.set_d1_hash(h_key, digest)
        ledger.save()
        return 1

    def record_pipeline_run(self, run: PipelineRunSummary) -> None:
        self.execute_statement(
            """
            INSERT OR REPLACE INTO wq_pipeline_runs (
              run_id, job_type, started_at, finished_at, status,
              total_funds, succeeded_funds, failed_funds, failure_rate,
              max_valuation_date, aia_valuation_date, alerts_json, host_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                run.run_id,
                run.job_type,
                run.started_at,
                run.finished_at,
                run.status,
                run.total_funds,
                run.succeeded_funds,
                run.failed_funds,
                run.failure_rate,
                run.max_valuation_date,
                run.aia_valuation_date,
                json.dumps(run.alerts, ensure_ascii=False),
                run.host_name,
            ],
        )

    def send_heartbeat(
        self,
        wq_version: str,
        last_fetch_ok_at: str | None = None,
        last_writeback_ok_at: str | None = None,
        last_aia_val_date: str | None = None,
        metrics_summary: dict[str, Any] | None = None,
    ) -> None:
        now_iso = now_hkt().isoformat(timespec="seconds")
        # Preserve existing timestamps when heartbeat fires standalone
        self.execute_statement(
            """
            INSERT INTO wq_heartbeat (
              host_id, last_seen_at, wq_version, last_fetch_ok_at,
              last_writeback_ok_at, last_aia_val_date, metrics_summary_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(host_id) DO UPDATE SET
              last_seen_at = excluded.last_seen_at,
              wq_version = excluded.wq_version,
              last_fetch_ok_at = COALESCE(excluded.last_fetch_ok_at, wq_heartbeat.last_fetch_ok_at),
              last_writeback_ok_at = COALESCE(excluded.last_writeback_ok_at, wq_heartbeat.last_writeback_ok_at),
              last_aia_val_date = COALESCE(excluded.last_aia_val_date, wq_heartbeat.last_aia_val_date),
              metrics_summary_json = CASE
                WHEN excluded.metrics_summary_json = '{}' THEN wq_heartbeat.metrics_summary_json
                ELSE excluded.metrics_summary_json
              END
            """,
            [
                self.settings.host_id,
                now_iso,
                wq_version,
                last_fetch_ok_at,
                last_writeback_ok_at,
                last_aia_val_date,
                json.dumps(metrics_summary or {}, ensure_ascii=False),
            ],
        )
