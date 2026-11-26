"""Safely sync local SQLite Wonder Quant tables to remote Cloudflare D1 via Wrangler CLI.

Safeguards:
- Checks per-statement UTF-8 byte length (< 90 KB) to obey Cloudflare D1's 100 KB SQL statement limit.
- Chunks statements into <= 380 KB SQL files and paces calls (>= 1.2s sleep) to avoid D1 rate limits.
- Tracks per-row SHA256 digests in D:\\WonderQuant\\state\\wrangler_remote_hashes.json so subsequent syncs skip unchanged rows.
- Uses INSERT INTO wq_funds ... ON CONFLICT(slug) DO UPDATE preserving existing bond/holdings columns.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from wonder_quant.config import load_settings
from wonder_quant.storage import atomic_write_json

API_WORKER_DIR = Path(__file__).resolve().parents[3] / "apps" / "api-worker"
MAX_STMT_BYTES = 92_000
MAX_CHUNK_BYTES = 380_000


def find_local_d1_sqlite(wrangler_state: Path) -> Path:
    candidates = sorted(
        (wrangler_state / "v3" / "d1").rglob("*.sqlite"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"No local D1 sqlite found under {wrangler_state}")
    return candidates[0]


def _sql_lit(val: Any) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "1" if val else "0"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val).replace("'", "''")
    return f"'{s}'"


def _row_digest(row: tuple[Any, ...]) -> str:
    canonical = json.dumps(list(row), ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _exec_wrangler_sql(sql_file: Path) -> None:
    cmd = [
        "npx",
        "wrangler",
        "d1",
        "execute",
        "wonder-db",
        "--remote",
        "--file",
        str(sql_file),
    ]
    proc = subprocess.run(
        cmd,
        cwd=str(API_WORKER_DIR),
        shell=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"Wrangler D1 execute failed ({proc.returncode}) on {sql_file.name}:\n{proc.stdout}\n{proc.stderr}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Chunked sync from local Wrangler D1 SQLite to remote Cloudflare D1.")
    parser.add_argument("--full", action="store_true", help="Ignore remote hash cache and push all rows.")
    parser.add_argument("--dry-run", action="store_true", help="Validate statement sizes & print plan without executing.")
    parser.add_argument("--pause", type=float, default=1.2, help="Seconds to pause between Wrangler D1 chunks.")
    args = parser.parse_args()

    settings = load_settings()
    sqlite_path = find_local_d1_sqlite(settings.home_dir / "wrangler-state")
    hash_path = settings.state_dir / "wrangler_remote_hashes.json"
    remote_hashes: dict[str, str] = {}
    if hash_path.exists() and not args.full:
        try:
            remote_hashes = json.loads(hash_path.read_text(encoding="utf-8"))
        except Exception:
            remote_hashes = {}

    conn = sqlite3.connect(sqlite_path)
    cur = conn.cursor()

    staged: list[tuple[str, str, str]] = []  # (hash_key, digest, sql_stmt)
    skipped = 0

    # 1. wq_funds (preserve existing enrichment columns via COALESCE)
    fund_cols = [
        "slug", "code", "aia_code", "isin", "yahoo_ticker", "cn_code", "name", "name_en", "manager",
        "asset_class", "ilas_platform", "currency", "risk_class", "morningstar_stars", "fee_pct",
        "role", "fit_plans_json", "tags_json", "commentary", "twin_code", "is_distributing",
        "benchmark_code", "primary_source", "data_tier", "is_trackable", "status", "vault_last_updated", "synced_at",
        "top_holdings_json", "duration", "yield_pct", "avg_rating", "credit_quality", "morningstar_url",
        "xray_profile_json",
    ]
    for row in cur.execute(f"SELECT {', '.join(fund_cols)} FROM wq_funds").fetchall():
        digest = _row_digest(row[:27] + row[28:])
        hk = f"fund:{row[0]}"
        if not args.full and remote_hashes.get(hk) == digest:
            skipped += 1
            continue
        vals = ", ".join(_sql_lit(v) for v in row)
        sql = (
            f"INSERT INTO wq_funds ({', '.join(fund_cols)}) VALUES ({vals}) ON CONFLICT(slug) DO UPDATE SET "
            "code=excluded.code, aia_code=excluded.aia_code, isin=COALESCE(excluded.isin, wq_funds.isin), "
            "yahoo_ticker=COALESCE(excluded.yahoo_ticker, wq_funds.yahoo_ticker), cn_code=COALESCE(excluded.cn_code, wq_funds.cn_code), "
            "name=excluded.name, name_en=COALESCE(excluded.name_en, wq_funds.name_en), manager=COALESCE(excluded.manager, wq_funds.manager), "
            "asset_class=excluded.asset_class, ilas_platform=excluded.ilas_platform, currency=excluded.currency, "
            "risk_class=COALESCE(excluded.risk_class, wq_funds.risk_class), "
            "morningstar_stars=COALESCE(excluded.morningstar_stars, wq_funds.morningstar_stars), "
            "fee_pct=excluded.fee_pct, role=COALESCE(excluded.role, wq_funds.role), "
            "fit_plans_json=excluded.fit_plans_json, tags_json=excluded.tags_json, "
            "commentary=COALESCE(excluded.commentary, wq_funds.commentary), "
            "twin_code=COALESCE(excluded.twin_code, wq_funds.twin_code), is_distributing=excluded.is_distributing, "
            "benchmark_code=excluded.benchmark_code, primary_source=excluded.primary_source, "
            "data_tier=excluded.data_tier, is_trackable=excluded.is_trackable, status=excluded.status, "
            "vault_last_updated=COALESCE(excluded.vault_last_updated, wq_funds.vault_last_updated), synced_at=excluded.synced_at, "
            "top_holdings_json=COALESCE(excluded.top_holdings_json, wq_funds.top_holdings_json), "
            "duration=COALESCE(excluded.duration, wq_funds.duration), yield_pct=COALESCE(excluded.yield_pct, wq_funds.yield_pct), "
            "avg_rating=COALESCE(excluded.avg_rating, wq_funds.avg_rating), "
            "credit_quality=COALESCE(excluded.credit_quality, wq_funds.credit_quality), "
            "morningstar_url=COALESCE(excluded.morningstar_url, wq_funds.morningstar_url), "
            "xray_profile_json=COALESCE(excluded.xray_profile_json, wq_funds.xray_profile_json);"
        )
        staged.append((hk, digest, sql))

    # 2. wq_fund_series
    s_cols = ["slug", "currency", "series_type", "source", "start_date", "end_date", "obs_days", "series_json", "content_sha256", "updated_at"]
    for row in cur.execute(f"SELECT {', '.join(s_cols)} FROM wq_fund_series").fetchall():
        digest = str(row[8] or _row_digest(row))
        hk = f"series:{row[0]}"
        if not args.full and remote_hashes.get(hk) == digest:
            skipped += 1
            continue
        vals = ", ".join(_sql_lit(v) for v in row)
        sql = f"INSERT OR REPLACE INTO wq_fund_series ({', '.join(s_cols)}) VALUES ({vals});"
        staged.append((hk, digest, sql))

    # 3. wq_fx_series
    fx_cols = ["pair", "start_date", "end_date", "latest_rate", "series_json", "content_sha256", "source", "updated_at"]
    for row in cur.execute(f"SELECT {', '.join(fx_cols)} FROM wq_fx_series").fetchall():
        digest = str(row[5] or _row_digest(row))
        hk = f"fx:{row[0]}"
        if not args.full and remote_hashes.get(hk) == digest:
            skipped += 1
            continue
        vals = ", ".join(_sql_lit(v) for v in row)
        sql = f"INSERT OR REPLACE INTO wq_fx_series ({', '.join(fx_cols)}) VALUES ({vals});"
        staged.append((hk, digest, sql))

    # 4. wq_benchmark_series
    bm_cols = ["code", "currency", "start_date", "end_date", "series_json", "content_sha256", "updated_at"]
    for row in cur.execute(f"SELECT {', '.join(bm_cols)} FROM wq_benchmark_series").fetchall():
        digest = str(row[5] or _row_digest(row))
        hk = f"bm:{row[0]}"
        if not args.full and remote_hashes.get(hk) == digest:
            skipped += 1
            continue
        vals = ", ".join(_sql_lit(v) for v in row)
        sql = f"INSERT OR REPLACE INTO wq_benchmark_series ({', '.join(bm_cols)}) VALUES ({vals});"
        staged.append((hk, digest, sql))

    # 5. wq_fund_metrics
    m_cols = [
        "slug", "as_of_date", "valuation_date", "latest_nav", "latest_nav_currency",
        "ret_1m", "ret_3m", "ret_6m", "ret_ytd", "ret_1y", "ret_3y_ann", "ret_5y_ann",
        "vol_1y", "vol_3y", "max_dd_1y", "max_dd_3y", "max_dd_5y", "dd_recovery_days",
        "sharpe_3y", "sortino_3y", "calmar_3y", "beta_3y", "alpha_3y", "r2_3y", "ir_3y",
        "div_yield_ttm", "peer_rank_pct", "quant_score", "quant_grade", "obs_days",
        "data_tier", "anomalies_json", "computed_at",
    ]
    for row in cur.execute(f"SELECT {', '.join(m_cols)} FROM wq_fund_metrics").fetchall():
        digest = _row_digest(row[:-1])
        hk = f"metrics:{row[0]}"
        if not args.full and remote_hashes.get(hk) == digest:
            skipped += 1
            continue
        vals = ", ".join(_sql_lit(v) for v in row)
        sql = f"INSERT OR REPLACE INTO wq_fund_metrics ({', '.join(m_cols)}) VALUES ({vals});"
        staged.append((hk, digest, sql))

    # 6. wq_pipeline_runs & wq_heartbeat
    run_cols = [
        "run_id", "job_type", "started_at", "finished_at", "status",
        "total_funds", "succeeded_funds", "failed_funds", "failure_rate",
        "max_valuation_date", "aia_valuation_date", "alerts_json", "host_name",
    ]
    for row in cur.execute(f"SELECT {', '.join(run_cols)} FROM wq_pipeline_runs ORDER BY started_at DESC LIMIT 1").fetchall():
        hk = f"run:{row[0]}"
        digest = _row_digest(row)
        if remote_hashes.get(hk) != digest:
            vals = ", ".join(_sql_lit(v) for v in row)
            staged.append((hk, digest, f"INSERT OR REPLACE INTO wq_pipeline_runs ({', '.join(run_cols)}) VALUES ({vals});"))

    hb_cols = ["host_id", "last_seen_at", "wq_version", "last_fetch_ok_at", "last_aia_val_date", "metrics_summary_json"]
    for row in cur.execute(f"SELECT {', '.join(hb_cols)} FROM wq_heartbeat").fetchall():
        hk = f"hb:{row[0]}"
        digest = _row_digest(row)
        vals = ", ".join(_sql_lit(v) for v in row)
        staged.append((
            hk,
            digest,
            f"INSERT INTO wq_heartbeat ({', '.join(hb_cols)}) VALUES ({vals}) ON CONFLICT(host_id) DO UPDATE SET "
            "last_seen_at=excluded.last_seen_at, wq_version=excluded.wq_version, "
            "last_fetch_ok_at=COALESCE(excluded.last_fetch_ok_at, wq_heartbeat.last_fetch_ok_at), "
            "last_aia_val_date=COALESCE(excluded.last_aia_val_date, wq_heartbeat.last_aia_val_date), "
            "metrics_summary_json=excluded.metrics_summary_json;",
        ))

    conn.close()

    # Validate individual statement sizes (< 92 KB under D1 100 KB SQL statement limit)
    oversized = [(hk, len(sql.encode("utf-8"))) for hk, _, sql in staged if len(sql.encode("utf-8")) > MAX_STMT_BYTES]
    if oversized:
        raise RuntimeError(f"Oversized SQL statements detected (> {MAX_STMT_BYTES}B): {oversized[:5]}")

    # Build chunk files
    chunks: list[list[tuple[str, str, str]]] = []
    cur_chunk: list[tuple[str, str, str]] = []
    cur_bytes = 0
    for item in staged:
        b = len(item[2].encode("utf-8")) + 1
        if cur_chunk and (cur_bytes + b > MAX_CHUNK_BYTES or len(cur_chunk) >= 120):
            chunks.append(cur_chunk)
            cur_chunk = []
            cur_bytes = 0
        cur_chunk.append(item)
        cur_bytes += b
    if cur_chunk:
        chunks.append(cur_chunk)

    max_stmt = max((len(s.encode("utf-8")) for _, _, s in staged), default=0)
    print(f"Remote D1 sync plan: staged={len(staged)}, skipped={skipped}, chunks={len(chunks)}, max_stmt_bytes={max_stmt}")
    if args.dry_run or not chunks:
        return 0

    tmp_dir = settings.tmp_dir / "d1_chunks"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    for idx, ch in enumerate(chunks, 1):
        sql_path = tmp_dir / f"chunk_{idx:03d}.sql"
        sql_path.write_text("\n".join(item[2] for item in ch) + "\n", encoding="utf-8", newline="\n")
        _exec_wrangler_sql(sql_path)
        for hk, digest, _ in ch:
            remote_hashes[hk] = digest
        atomic_write_json(hash_path, remote_hashes)
        sql_path.unlink(missing_ok=True)
        print(f"  Executed chunk {idx}/{len(chunks)} ({len(ch)} statements)")
        if idx < len(chunks) and args.pause > 0:
            time.sleep(args.pause)

    return 0


if __name__ == "__main__":
    sys.exit(main())
