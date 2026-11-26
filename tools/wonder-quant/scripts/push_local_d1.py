"""Push computed local Parquet & metrics directly into local Wrangler D1 SQLite (for local preview)."""
from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path

import yaml

from wonder_quant import __version__
from wonder_quant.catalog import load_catalog
from wonder_quant.config import load_settings, now_hkt
from wonder_quant.d1_client import (
    _end_date_from_delta,
    pack_benchmark_series,
    pack_fund_series,
    pack_fx_series,
)
from wonder_quant.fetchers.yahoo import sanitize_yahoo_series_df
from wonder_quant.models import FundMetrics, PipelineRunSummary
from wonder_quant.pipeline import BM_COLS, FX_COLS, NAV_COLS, _stitch_aia_official_onto_proxy
from wonder_quant.storage import read_parquet_or_empty


def find_local_d1_sqlite(wrangler_state: Path) -> Path:
    candidates = sorted(
        (wrangler_state / "v3" / "d1").rglob("*.sqlite"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"No local D1 sqlite found under {wrangler_state}")
    return candidates[0]


def _parse_vault_extra(funds_dir: Path) -> dict[str, dict]:
    """从 Vault 基金 md frontmatter 提取 top_holdings / duration / yield_pct / avg_rating / credit_quality / morningstar_url / strategy_note。"""
    extra: dict[str, dict] = {}
    if not funds_dir.exists():
        return extra
    for md in funds_dir.glob("*.md"):
        try:
            text = md.read_text(encoding="utf-8")
        except Exception:
            continue
        if not text.startswith("---"):
            continue
        end = text.find("\n---", 3)
        if end < 0:
            continue
        try:
            fm = yaml.safe_load(text[3:end]) or {}
        except Exception:
            continue
        if not isinstance(fm, dict):
            continue

        # 解析 top_holdings 文本 -> JSON
        th_raw = fm.get("top_holdings")
        th_json = None
        if isinstance(th_raw, str) and "/" in th_raw:
            cleaned = re.sub(r"[（(]前十大[^）)]*[）)]", "", th_raw)
            items = []
            for part in [p.strip() for p in cleaned.split("/") if p.strip()][:10]:
                m = re.match(r"^(.+?)\s+(\d+(?:\.\d+)?)%?$", part)
                if m:
                    items.append({"name": m.group(1).strip(), "weight_pct": float(m.group(2))})
                else:
                    items.append({"name": part, "weight_pct": None})
            if len(items) >= 2:
                weights = [x["weight_pct"] for x in items if x["weight_pct"] is not None]
                total = round(sum(weights), 2) if weights else None
                th_json = json.dumps(
                    {"source": "Vault 基金档案", "holdings": items, "top10_total_pct": total},
                    ensure_ascii=False,
                )

        def _num(v):
            if v is None or isinstance(v, bool):
                return None
            try:
                return float(str(v).replace("%", "").strip())
            except Exception:
                return None

        def _str(v):
            if v is None:
                return None
            s = str(v).strip()
            return None if not s or s in ("null", "—", "-", "不适用") else s

        slug = md.stem.replace("_F", "").lower()
        code_raw = _str(fm.get("fund_codes")) or ""
        first_code = re.split(r"[（(\s|/]+", code_raw)[0].strip().upper()
        dur_val = _num(fm.get("duration"))
        yld_val = _num(fm.get("yield_pct"))
        payload = {
            "top_holdings_json": th_json,
            "duration": dur_val if (dur_val is not None and -5.0 <= dur_val <= 40.0) else None,
            "yield_pct": yld_val if (yld_val is not None and 0.0 < yld_val <= 25.0) else None,
            "avg_rating": _str(fm.get("avg_rating")),
            "credit_quality": _str(fm.get("credit_quality")),
            "morningstar_url": _str(fm.get("morningstar_url")),
            "strategy_note": _str(fm.get("strategy_note")),
        }
        extra[slug] = payload
        if first_code:
            extra[first_code] = payload
    return extra


def _ensure_wq_funds_columns(cur: sqlite3.Cursor) -> None:
    cols = {row[1] for row in cur.execute("PRAGMA table_info(wq_funds)").fetchall()}
    needed = {
        "top_holdings_json": "TEXT",
        "duration": "REAL",
        "yield_pct": "REAL",
        "avg_rating": "TEXT",
        "credit_quality": "TEXT",
        "morningstar_url": "TEXT",
    }
    for col, col_type in needed.items():
        if col not in cols:
            cur.execute(f"ALTER TABLE wq_funds ADD COLUMN {col} {col_type}")


def main() -> int:
    settings = load_settings()
    if len(sys.argv) > 1 and sys.argv[1].endswith(".sqlite"):
        sqlite_path = Path(sys.argv[1])
    else:
        sqlite_path = find_local_d1_sqlite(settings.home_dir / "wrangler-state")
    print(f"Target local D1 SQLite: {sqlite_path}")

    funds = load_catalog(settings.vault_fund_dir)
    vault_extra = _parse_vault_extra(settings.vault_fund_dir / "funds")
    metrics_file = settings.state_dir / "latest_metrics.json"
    metrics = [FundMetrics(**x) for x in json.loads(metrics_file.read_text(encoding="utf-8"))] if metrics_file.exists() else []
    metrics_by_slug = {m.slug: m for m in metrics}

    nav_df = read_parquet_or_empty(settings.cache_dir / "nav.parquet", NAV_COLS)
    fx_df = read_parquet_or_empty(settings.cache_dir / "fx.parquet", FX_COLS)
    bm_df = read_parquet_or_empty(settings.cache_dir / "benchmarks.parquet", BM_COLS)

    now_iso = now_hkt().isoformat(timespec="seconds")
    conn = sqlite3.connect(sqlite_path)
    cur = conn.cursor()
    _ensure_wq_funds_columns(cur)

    # 1. wq_funds
    for f in funds:
        tier = metrics_by_slug[f.slug].data_tier if f.slug in metrics_by_slug else f.data_tier
        ex = vault_extra.get(f.slug.lower()) or vault_extra.get((f.code or "").upper()) or {}
        commentary = f.commentary or ex.get("strategy_note")
        cur.execute(
            """
            INSERT INTO wq_funds (
              slug, code, aia_code, isin, yahoo_ticker, cn_code, name, name_en, manager,
              asset_class, ilas_platform, currency, risk_class, morningstar_stars, fee_pct,
              role, fit_plans_json, tags_json, commentary, twin_code, is_distributing,
              benchmark_code, primary_source, data_tier, is_trackable, status, vault_last_updated, synced_at,
              top_holdings_json, duration, yield_pct, avg_rating, credit_quality, morningstar_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
              synced_at = excluded.synced_at,
              top_holdings_json = COALESCE(excluded.top_holdings_json, wq_funds.top_holdings_json),
              duration = COALESCE(excluded.duration, wq_funds.duration),
              yield_pct = COALESCE(excluded.yield_pct, wq_funds.yield_pct),
              avg_rating = COALESCE(excluded.avg_rating, wq_funds.avg_rating),
              credit_quality = COALESCE(excluded.credit_quality, wq_funds.credit_quality),
              morningstar_url = COALESCE(excluded.morningstar_url, wq_funds.morningstar_url)
            """,
            (
                f.slug, f.code, f.aia_code, f.isin, f.yahoo_ticker, f.cn_code, f.name, f.name_en, f.manager,
                f.asset_class, f.ilas_platform, f.currency, f.risk_class, f.morningstar_stars, f.fee_pct,
                f.role, json.dumps(f.fit_plans, ensure_ascii=False), json.dumps(f.tags, ensure_ascii=False),
                commentary, f.twin_code, 1 if f.is_distributing else 0, f.benchmark_code, f.primary_source,
                tier, 1 if f.is_trackable else 0, f.status, f.vault_last_updated, now_iso,
                ex.get("top_holdings_json"), ex.get("duration"), ex.get("yield_pct"),
                ex.get("avg_rating"), ex.get("credit_quality"), ex.get("morningstar_url"),
            ),
        )

    # 2. wq_fund_series
    fund_map = {f.slug: f for f in funds}
    series_count = 0
    if not nav_df.empty:
        for slug, grp in nav_df.groupby("slug"):
            slug_str = str(slug)
            if slug_str not in fund_map:
                continue
            f = fund_map[slug_str]
            stitched = _stitch_aia_official_onto_proxy(grp)
            cleaned = sanitize_yahoo_series_df(stitched, ticker=f.yahoo_ticker or f.code or slug_str)
            payload, digest = pack_fund_series(cleaned, "market_etf", f.primary_source)
            end_dt = _end_date_from_delta(payload.get("d0"), payload.get("dd", []))
            cur.execute(
                """
                INSERT OR REPLACE INTO wq_fund_series (
                  slug, currency, series_type, source, start_date, end_date, obs_days,
                  series_json, content_sha256, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    slug_str, f.currency, payload["t"], payload["s"],
                    payload.get("d0"),
                    end_dt,
                    len(payload["n"]),
                    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    digest, now_iso,
                ),
            )
            series_count += 1

    # 3. wq_fx_series
    fx_count = 0
    if not fx_df.empty:
        for pair, grp in fx_df.groupby("pair"):
            payload, digest, latest = pack_fx_series(grp.reset_index(drop=True))
            end_dt = _end_date_from_delta(payload.get("d0"), payload.get("dd", []))
            cur.execute(
                """
                INSERT OR REPLACE INTO wq_fx_series (
                  pair, start_date, end_date, latest_rate, series_json, content_sha256, source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(pair),
                    payload.get("d0"),
                    end_dt,
                    latest,
                    json.dumps(payload, separators=(",", ":")),
                    digest, "yfinance", now_iso,
                ),
            )
            fx_count += 1

    # 4. wq_benchmark_series
    bm_count = 0
    if not bm_df.empty:
        for code, grp in bm_df.groupby("code"):
            ccy = str(grp["currency"].iloc[-1])
            payload, digest = pack_benchmark_series(grp.reset_index(drop=True))
            end_dt = _end_date_from_delta(payload.get("d0"), payload.get("dd", []))
            cur.execute(
                """
                INSERT OR REPLACE INTO wq_benchmark_series (
                  code, currency, start_date, end_date, series_json, content_sha256, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(code), ccy,
                    payload.get("d0"),
                    end_dt,
                    json.dumps(payload, separators=(",", ":")),
                    digest, now_iso,
                ),
            )
            bm_count += 1

    # 5. wq_fund_metrics
    for m in metrics:
        cur.execute(
            """
            INSERT OR REPLACE INTO wq_fund_metrics (
              slug, as_of_date, valuation_date, latest_nav, latest_nav_currency,
              ret_1m, ret_3m, ret_6m, ret_ytd, ret_1y, ret_3y_ann, ret_5y_ann,
              vol_1y, vol_3y, max_dd_1y, max_dd_3y, max_dd_5y, dd_recovery_days,
              sharpe_3y, sortino_3y, calmar_3y, beta_3y, alpha_3y, r2_3y, ir_3y,
              div_yield_ttm, peer_rank_pct, quant_score, quant_grade, obs_days,
              data_tier, anomalies_json, computed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                m.slug, m.as_of_date, m.valuation_date, m.latest_nav, m.latest_nav_currency,
                m.ret_1m, m.ret_3m, m.ret_6m, m.ret_ytd, m.ret_1y, m.ret_3y_ann, m.ret_5y_ann,
                m.vol_1y, m.vol_3y, m.max_dd_1y, m.max_dd_3y, m.max_dd_5y, m.dd_recovery_days,
                m.sharpe_3y, m.sortino_3y, m.calmar_3y, m.beta_3y, m.alpha_3y, m.r2_3y, m.ir_3y,
                m.div_yield_ttm, m.peer_rank_pct, m.quant_score, m.quant_grade, m.obs_days,
                m.data_tier, json.dumps(m.anomalies, ensure_ascii=False), m.computed_at or now_iso,
            ),
        )

    # 6. wq_pipeline_runs & wq_heartbeat
    run_file = settings.state_dir / "last_fetch_run.json"
    aia_val = None
    if run_file.exists():
        run = PipelineRunSummary(**json.loads(run_file.read_text(encoding="utf-8")))
        aia_val = run.aia_valuation_date
        cur.execute(
            """
            INSERT OR REPLACE INTO wq_pipeline_runs (
              run_id, job_type, started_at, finished_at, status,
              total_funds, succeeded_funds, failed_funds, failure_rate,
              max_valuation_date, aia_valuation_date, alerts_json, host_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run.run_id, run.job_type, run.started_at, run.finished_at, run.status,
                run.total_funds, run.succeeded_funds, run.failed_funds, run.failure_rate,
                run.max_valuation_date, run.aia_valuation_date, json.dumps(run.alerts, ensure_ascii=False),
                run.host_name,
            ),
        )

    tiers: dict[str, int] = {}
    for m in metrics:
        tiers[m.data_tier] = tiers.get(m.data_tier, 0) + 1
    cur.execute(
        """
        INSERT OR REPLACE INTO wq_heartbeat (
          host_id, last_seen_at, wq_version, last_fetch_ok_at, last_aia_val_date, metrics_summary_json
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (settings.host_id, now_iso, __version__, now_iso, aia_val, json.dumps({"tiers": tiers, "total": len(metrics)})),
    )

    conn.commit()
    conn.close()
    print(f"Loaded local D1: funds={len(funds)}, series={series_count}, metrics={len(metrics)}, fx={fx_count}, benchmarks={bm_count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
