from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pandas as pd
import yaml

from wonder_quant.config import Settings, now_hkt
from wonder_quant.d1_client import D1Client, pack_fund_series
from wonder_quant.fetchers.yahoo import sanitize_yahoo_series_df

API_WORKER_DIR = Path(__file__).resolve().parents[4] / "apps" / "api-worker"
WRANGLER_DB_NAME = "wonder-db"
MAX_WRANGLER_STMT_BYTES = 90_000

A_COMPLIANCE_BANNED = [
    r"建议买入",
    r"强烈买入",
    r"建议卖出",
    r"目标仓位",
    r"仓位上限",
    r"\d+%\s*仓位",
    r"击球区",
    r"决策速览",
    r"行动决策树",
    r"\bPlan\s*[A-D]\b",
    r"\bBUY\b|\bSELL\b|\bAVOID\b",
]


def _split_frontmatter(raw_text: str) -> tuple[dict[str, Any], str]:
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", raw_text, flags=re.S)
    if not m:
        return {}, raw_text
    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except Exception:
        meta = {}
    return meta, raw_text[m.end() :]


def extract_fund_tabs(body: str) -> list[dict[str, str]]:
    """Split A-edition markdown by <!-- FUND_TAB: id | label --> markers."""
    pattern = re.compile(r"<!--\s*FUND_TAB:\s*([a-zA-Z0-9_]+)\s*\|\s*([^>]+?)\s*-->")
    matches = list(pattern.finditer(body))
    tabs: list[dict[str, str]] = []
    for idx, m in enumerate(matches):
        start = m.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(body)
        tabs.append({
            "id": m.group(1).strip(),
            "label": m.group(2).strip(),
            "markdown": body[start:end].strip(),
        })
    return tabs


def check_commercial_tabs_compliance(tabs: list[dict[str, str]]) -> list[str]:
    violations: list[str] = []
    for t in tabs:
        text = t.get("markdown", "")
        for pat in A_COMPLIANCE_BANNED:
            hits = re.findall(pat, text)
            if hits:
                violations.append(f"tab={t.get('id')} matched '{pat}': {hits[:2]}")
    return violations


def _sql_lit(val: Any) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "1" if val else "0"
    if isinstance(val, (int, float)):
        return str(val)
    return "'" + str(val).replace("'", "''") + "'"


def _wrangler_cmd_prefix() -> tuple[list[str], Path]:
    local_wrangler = API_WORKER_DIR / "node_modules" / "wrangler" / "bin" / "wrangler.js"
    if local_wrangler.exists():
        node_bin = shutil.which("node") or "node"
        return [node_bin, str(local_wrangler)], API_WORKER_DIR
    npx_bin = "npx.cmd" if sys.platform == "win32" else "npx"
    cwd = API_WORKER_DIR if API_WORKER_DIR.exists() else Path.cwd()
    return [npx_bin, "wrangler"], cwd


def _run_wrangler_d1_sql(sql_stmts: list[str], tmp_dir: Path) -> None:
    if not sql_stmts:
        return
    tmp_dir.mkdir(parents=True, exist_ok=True)
    sql_path = tmp_dir / f"sop_publish_{now_hkt().strftime('%Y%m%d_%H%M%S_%f')}.sql"
    sql_path.write_text("\n".join(sql_stmts) + "\n", encoding="utf-8", newline="\n")
    prefix, cwd = _wrangler_cmd_prefix()
    cmd = [*prefix, "d1", "execute", WRANGLER_DB_NAME, "--remote", "--file", str(sql_path)]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"Wrangler D1 execute failed ({proc.returncode}):\n{proc.stdout}\n{proc.stderr}"
            )
    finally:
        sql_path.unlink(missing_ok=True)


def _query_wrangler_d1_json(sql: str) -> list[dict[str, Any]]:
    prefix, cwd = _wrangler_cmd_prefix()
    cmd = [*prefix, "d1", "execute", WRANGLER_DB_NAME, "--remote", "--json", "--command", sql]
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"Wrangler D1 query failed ({proc.returncode}):\n{proc.stdout}\n{proc.stderr}"
        )
    parsed = json.loads(proc.stdout or "[]")
    return (parsed[0] if isinstance(parsed, list) and parsed else {}).get("results") or []


def pull_research_queue_to_vault(
    settings: Settings,
    out_file: Path | None = None,
    statuses: tuple[str, ...] = ("queued", "watching", "in_progress"),
) -> dict[str, Any]:
    """Pull FIS Hub fund research queue from Cloudflare D1 into Obsidian 02_Ideas/基金分析线索.md."""
    vault_root = settings.vault_fund_dir.parents[2]
    target = out_file or (vault_root / "02_Ideas" / "基金分析线索.md")
    target.parent.mkdir(parents=True, exist_ok=True)

    if settings.cf_account_id and settings.cf_api_token:
        d1 = D1Client(settings)
        placeholders = ", ".join(["?"] * len(statuses))
        sql = f"""
            SELECT slug, code, fund_name, asset_class, ilas_platform, status, priority,
                   request_count, requesters_json, admin_note, first_requested_at, last_requested_at
            FROM wq_fund_research_queue
            WHERE status IN ({placeholders})
            ORDER BY
              CASE priority WHEN 'P0_urgent' THEN 0 WHEN 'P1_high' THEN 1 ELSE 2 END,
              request_count DESC,
              first_requested_at ASC
        """
        resp = d1.execute_statement(sql, list(statuses))
        rows = (resp.get("result") or [{}])[0].get("results") or []
    else:
        lit_list = ", ".join(_sql_lit(s) for s in statuses)
        sql = f"""
            SELECT slug, code, fund_name, asset_class, ilas_platform, status, priority,
                   request_count, requesters_json, admin_note, first_requested_at, last_requested_at
            FROM wq_fund_research_queue
            WHERE status IN ({lit_list})
            ORDER BY
              CASE priority WHEN 'P0_urgent' THEN 0 WHEN 'P1_high' THEN 1 ELSE 2 END,
              request_count DESC,
              first_requested_at ASC
        """
        rows = _query_wrangler_d1_json(sql)

    # Preserve checked [x] items if existing file has them
    preserved_done: list[str] = []
    if target.exists():
        for line in target.read_text(encoding="utf-8").splitlines():
            if re.match(r"^\s*-\s*\[x\]", line, flags=re.I):
                preserved_done.append(line)

    lines: list[str] = [
        "# 🔍 FIS 观察分析基金线索清单",
        "",
        f"> 最后同步时间：`{now_hkt().isoformat(timespec='seconds')}`（来源：Cloudflare D1 `wq_fund_research_queue`）",
        "> 执行协议：处理最上方 P0/高热度 `- [ ]` 标的 → 加载 `fund-analysis-sop` 跑 SOP v2.0 → 定稿后执行 `wq publish-sop <SLUG>`。",
        "",
        "## 待研究队列（按优先级与关注热度排序）",
        "",
    ]

    if not rows:
        lines.append("- （当前 FIS 观察分析队列为空）")
    else:
        for r in rows:
            reqs = []
            try:
                reqs = json.loads(r.get("requesters_json") or "[]")
            except Exception:
                reqs = []
            notes = [str(x.get("note")).strip() for x in reqs if x.get("note")]
            note_str = " / ".join(notes[:3]) if notes else (r.get("admin_note") or "无附加备注")
            prio = r.get("priority", "normal")
            st = r.get("status", "queued")
            cnt = int(r.get("request_count") or 1)
            lines.append(
                f"- [ ] {r['slug']} ({r.get('code') or r['slug']} · {r.get('fund_name') or ''}) "
                f"| 状态:{st} | 优先级:{prio} | 关注:{cnt}人 | 平台:{r.get('ilas_platform') or '—'} | 焦点: {note_str}"
            )

    if preserved_done:
        lines.extend(["", "## 已完成归档", ""])
        lines.extend(preserved_done[:50])

    target.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8", newline="\n")
    return {"pulled": len(rows), "out_file": str(target)}


def publish_sop_to_d1(
    settings: Settings,
    slug: str,
    report_dir: Path,
    dry_run: bool = False,
    invalidate_url: str | None = None,
    via_wrangler: bool = False,
) -> dict[str, Any]:
    """Publish validated SOP v2.0 deliverables for one fund to Cloudflare D1."""
    a_files = sorted(report_dir.glob("*-基金商业分析-*.md"))
    b_files = sorted(report_dir.glob("*-基金估值与投资决策-*.md"))
    p_files = sorted(report_dir.glob("*-基金一页纸-*.md"))
    val_json_file = report_dir / ".review" / "latest_fund_val.json"

    if not a_files:
        raise FileNotFoundError(f"Missing A-edition commercial report in {report_dir}")

    a_raw = a_files[-1].read_text(encoding="utf-8")
    a_meta, a_body = _split_frontmatter(a_raw)
    tabs = extract_fund_tabs(a_body)
    if len(tabs) != 5:
        raise ValueError(f"Expected 5 FUND_TAB sections in {a_files[-1].name}, got {len(tabs)}")

    violations = check_commercial_tabs_compliance(tabs)
    if violations:
        raise ValueError(f"A-edition compliance violation blocked publish: {violations}")

    decision_md = b_files[-1].read_text(encoding="utf-8") if b_files else ""
    one_pager_md = p_files[-1].read_text(encoding="utf-8") if p_files else ""

    val_data: dict[str, Any] = {}
    if val_json_file.exists():
        val_data = json.loads(val_json_file.read_text(encoding="utf-8-sig"))

    xray_profile, top_holdings_obj = _build_xray_profile_from_sop(report_dir, a_meta, val_data)

    # Structured summaries (populated from VAL JSON + A-edition frontmatter)
    pillar_obj = val_data.get("morningstar_2026") or {
        "medal_rating": a_meta.get("medal_rating"),
        "weighted_score": a_meta.get("pillar_score"),
    }
    val_summary_obj = val_data.get("valuation_summary") or {
        "val_route": a_meta.get("val_route"),
        "valuation_zone": a_meta.get("valuation_zone"),
        "pe_5y_pct": a_meta.get("valuation_pct_5y"),
    }
    div_summary_obj = val_data.get("dividend_summary") or {
        "div_yield_pretax_pct": a_meta.get("dividend_yield_ttm"),
        "div_yield_after_tax_pct": a_meta.get("dividend_yield_after_tax"),
        "spread_vs_rf_pct_pts": a_meta.get("dividend_spread_rf"),
    }
    masters_obj = _extract_masters_summary(a_body)

    now_iso = now_hkt().isoformat(timespec="seconds")
    payload = {
        "slug": slug,
        "code": str(a_meta.get("code") or slug),
        "fund_name": str(a_meta.get("fund_name") or slug),
        "sop_version": str(a_meta.get("sop_version") or "2.0"),
        "report_date": str(a_meta.get("report_date") or now_iso[:10]),
        "data_as_of": str(a_meta.get("data_as_of") or now_iso[:10]),
        "fund_type": str(a_meta.get("fund_type") or "ETF"),
        "val_route": str(a_meta.get("val_route") or "FV1"),
        "medal_rating": str(a_meta.get("medal_rating") or "Neutral"),
        "pillar_score": float(a_meta.get("pillar_score") or 0.0),
        "g1_g5_pass": 1 if a_meta.get("g1_g5_pass", True) else 0,
        "uncertainty": str(a_meta.get("uncertainty") or "Medium"),
        "valuation_zone": str(a_meta.get("valuation_zone") or "合理中性"),
        "valuation_pct_5y": float(a_meta["valuation_pct_5y"]) if a_meta.get("valuation_pct_5y") is not None else None,
        "dividend_yield_ttm": float(a_meta["dividend_yield_ttm"]) if a_meta.get("dividend_yield_ttm") is not None else None,
        "dividend_spread_rf": float(a_meta["dividend_spread_rf"]) if a_meta.get("dividend_spread_rf") is not None else None,
        "one_liner": str(a_meta.get("one_liner") or ""),
        "red_flag_top": str(a_meta.get("red_flag_top") or ""),
        "pillar_json": json.dumps(pillar_obj, ensure_ascii=False),
        "valuation_summary_json": json.dumps(val_summary_obj, ensure_ascii=False),
        "dividend_summary_json": json.dumps(div_summary_obj, ensure_ascii=False),
        "masters_json": json.dumps(masters_obj, ensure_ascii=False),
        "commercial_tabs_json": json.dumps(tabs, ensure_ascii=False),
        "decision_md": decision_md,
        "one_pager_md": one_pager_md,
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()

    if dry_run:
        return {
            "dry_run": True,
            "slug": slug,
            "tabs": [t["id"] for t in tabs],
            "masters_parsed": len(masters_obj),
            "xray_profile_ready": bool(xray_profile),
            "top_holdings_count": len(top_holdings_obj.get("holdings", [])) if top_holdings_obj else 0,
            "content_sha256": digest,
            "decision_len": len(decision_md),
        }

    sop_cols = [
        "slug", "code", "fund_name", "sop_version", "report_date", "data_as_of", "fund_type", "val_route",
        "medal_rating", "pillar_score", "g1_g5_pass", "uncertainty", "valuation_zone", "valuation_pct_5y",
        "dividend_yield_ttm", "dividend_spread_rf", "one_liner", "red_flag_top",
        "pillar_json", "valuation_summary_json", "dividend_summary_json", "masters_json",
        "commercial_tabs_json", "decision_md", "one_pager_md", "content_sha256", "published_at", "updated_at",
    ]
    insert_vals = [
        payload["slug"],
        payload["code"],
        payload["fund_name"],
        payload["sop_version"],
        payload["report_date"],
        payload["data_as_of"],
        payload["fund_type"],
        payload["val_route"],
        payload["medal_rating"],
        payload["pillar_score"],
        payload["g1_g5_pass"],
        payload["uncertainty"],
        payload["valuation_zone"],
        payload["valuation_pct_5y"],
        payload["dividend_yield_ttm"],
        payload["dividend_spread_rf"],
        payload["one_liner"],
        payload["red_flag_top"],
        payload["pillar_json"],
        payload["valuation_summary_json"],
        payload["dividend_summary_json"],
        payload["masters_json"],
        payload["commercial_tabs_json"],
        payload["decision_md"],
        payload["one_pager_md"],
        digest,
        now_iso,
        now_iso,
    ]
    use_wrangler = via_wrangler or not (settings.cf_account_id and settings.cf_api_token)
    if use_wrangler:
        stmts: list[str] = []
        full_insert = f"INSERT OR REPLACE INTO wq_fund_sop_reports ({', '.join(sop_cols)}) VALUES ({', '.join(_sql_lit(v) for v in insert_vals)});"
        if len(full_insert.encode("utf-8")) <= MAX_WRANGLER_STMT_BYTES:
            stmts.append(full_insert)
        else:
            trimmed_vals = list(insert_vals)
            trimmed_vals[23] = ""
            trimmed_vals[24] = ""
            stmts.append(
                f"INSERT OR REPLACE INTO wq_fund_sop_reports ({', '.join(sop_cols)}) VALUES ({', '.join(_sql_lit(v) for v in trimmed_vals)});"
            )
            stmts.append(
                f"UPDATE wq_fund_sop_reports SET decision_md = {_sql_lit(decision_md)} WHERE slug = {_sql_lit(slug)} COLLATE NOCASE;"
            )
            stmts.append(
                f"UPDATE wq_fund_sop_reports SET one_pager_md = {_sql_lit(one_pager_md)} WHERE slug = {_sql_lit(slug)} COLLATE NOCASE;"
            )

        if xray_profile or top_holdings_obj:
            v_block = (xray_profile or {}).get("valuation") or {}
            xray_lit = _sql_lit(json.dumps(xray_profile, ensure_ascii=False) if xray_profile else None)
            th_lit = _sql_lit(json.dumps(top_holdings_obj, ensure_ascii=False) if top_holdings_obj else None)
            dur_lit = _sql_lit(v_block.get("duration"))
            yld_lit = _sql_lit(v_block.get("ytm") or payload.get("dividend_yield_ttm"))
            stmts.append(
                "UPDATE wq_funds SET "
                f"xray_profile_json = COALESCE({xray_lit}, xray_profile_json), "
                f"top_holdings_json = COALESCE({th_lit}, top_holdings_json), "
                f"duration = COALESCE({dur_lit}, duration), "
                f"yield_pct = COALESCE({yld_lit}, yield_pct) "
                f"WHERE slug = {_sql_lit(slug)} COLLATE NOCASE;"
            )

        stmts.append(
            f"UPDATE wq_fund_research_queue SET status = 'completed', completed_at = {_sql_lit(now_iso)} "
            f"WHERE slug = {_sql_lit(slug)} COLLATE NOCASE AND status != 'completed';"
        )
        _run_wrangler_d1_sql(stmts, settings.tmp_dir)
    else:
        d1 = D1Client(settings)
        sql = f"""
            INSERT OR REPLACE INTO wq_fund_sop_reports (
              {', '.join(sop_cols)}
            ) VALUES ({', '.join(['?'] * len(sop_cols))})
        """
        d1.execute_statement(sql, insert_vals)

        # Sync X-Ray profile, top holdings, fee, ratings & commentary into wq_funds
        v_block = (xray_profile or {}).get("valuation") or {}
        f_meta = (xray_profile or {}).get("fund_metadata") or {}
        sop_comm = (
            f"【SOP v{payload['sop_version']} 深度分析 · {payload['medal_rating']}】{payload['one_liner']}"
            + (f" ｜ 结构性风险：{payload['red_flag_top']}" if payload.get("red_flag_top") else "")
            if payload.get("one_liner")
            else None
        )
        d1.execute_statement(
            """
            UPDATE wq_funds
            SET xray_profile_json = COALESCE(?, xray_profile_json),
                top_holdings_json = COALESCE(?, top_holdings_json),
                fee_pct = COALESCE(?, fee_pct),
                morningstar_stars = COALESCE(?, morningstar_stars),
                duration = COALESCE(?, duration),
                yield_pct = COALESCE(?, yield_pct),
                avg_rating = COALESCE(?, avg_rating),
                credit_quality = COALESCE(?, credit_quality),
                commentary = COALESCE(?, commentary),
                vault_last_updated = COALESCE(?, vault_last_updated),
                synced_at = ?
            WHERE slug = ? COLLATE NOCASE
            """,
            [
                json.dumps(xray_profile, ensure_ascii=False) if xray_profile else None,
                json.dumps(top_holdings_obj, ensure_ascii=False) if top_holdings_obj else None,
                f_meta.get("fee_pct"),
                f_meta.get("morningstar_stars"),
                f_meta.get("duration") if f_meta.get("duration") is not None else v_block.get("duration"),
                f_meta.get("yield_pct") if f_meta.get("yield_pct") is not None else (v_block.get("ytm") or payload.get("dividend_yield_ttm")),
                f_meta.get("avg_rating"),
                f_meta.get("credit_quality"),
                sop_comm,
                payload["report_date"],
                now_iso,
                slug,
            ],
        )

        series_pts, metrics_ok = _sync_series_and_metrics_from_sop(
            d1=d1,
            settings=settings,
            slug=slug,
            report_dir=report_dir,
            a_meta=a_meta,
            val_data=val_data,
            now_iso=now_iso,
        )

        # Mark queue item completed if present
        d1.execute_statement(
            "UPDATE wq_fund_research_queue SET status = 'completed', completed_at = ? WHERE slug = ? COLLATE NOCASE AND status != 'completed'",
            [now_iso, slug],
        )

    if invalidate_url:
        try:
            httpx.post(invalidate_url, timeout=10.0)
        except Exception:
            pass

    return {
        "published": True,
        "slug": slug,
        "medal_rating": payload["medal_rating"],
        "valuation_zone": payload["valuation_zone"],
        "series_points_synced": 0 if use_wrangler else series_pts,
        "metrics_synced": False if use_wrangler else metrics_ok,
        "content_sha256": digest,
        "transport": "wrangler_oauth" if use_wrangler else "d1_rest_api",
    }


def _sync_series_and_metrics_from_sop(
    d1: D1Client,
    settings: Settings,
    slug: str,
    report_dir: Path,
    a_meta: dict[str, Any],
    val_data: dict[str, Any],
    now_iso: str,
) -> tuple[int, bool]:
    """Ensure wq_fund_series and wq_fund_metrics in D1 are fully populated for SOP-covered funds."""
    fin_file = report_dir / ".review" / "latest_fund_fin.json"
    if not fin_file.exists():
        return 0, False
    try:
        fin_data = json.loads(fin_file.read_text(encoding="utf-8-sig"))
    except Exception:
        return 0, False

    nav_rows = fin_data.get("nav_series") or []
    if len(nav_rows) < 10:
        return 0, False

    df = pd.DataFrame(nav_rows)
    if "date" in df.columns and "nav_date" not in df.columns:
        df["nav_date"] = df["date"].astype(str).str.slice(0, 10)
    df["nav"] = pd.to_numeric(df["nav"], errors="coerce")
    df["adj_nav"] = pd.to_numeric(df.get("adj_nav", df["nav"]), errors="coerce").fillna(df["nav"])
    df["dividend"] = pd.to_numeric(df.get("dividend", 0.0), errors="coerce").fillna(0.0)
    df = df.dropna(subset=["nav_date", "adj_nav"]).sort_values("nav_date").drop_duplicates("nav_date", keep="last").reset_index(drop=True)
    if len(df) < 10:
        return 0, False

    df = sanitize_yahoo_series_df(df)
    cat = fin_data.get("catalog_entry") or {}
    market = str(fin_data.get("market") or "OFFSHORE").upper()
    ccy = str(cat.get("currency") or ("CNY" if market == "CN" else "USD")).upper()
    default_stype = "market_etf" if str(a_meta.get("fund_type") or "") == "ETF" else "proxy_underlying"
    default_src = str(df["source"].dropna().iloc[-1]) if "source" in df.columns and not df["source"].dropna().empty else "sop_v2"

    packed_obj, series_sha = pack_fund_series(df, default_series_type=default_stype, default_source=default_src)
    start_d = str(df["nav_date"].iloc[0])[:10]
    end_d = str(df["nav_date"].iloc[-1])[:10]
    obs_days = int(len(df))

    d1.execute_statement(
        """
        INSERT OR REPLACE INTO wq_fund_series (
          slug, currency, series_type, source, start_date, end_date, obs_days, series_json, content_sha256, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            slug,
            ccy,
            packed_obj.get("t") or default_stype,
            packed_obj.get("s") or default_src,
            start_d,
            end_d,
            obs_days,
            json.dumps(packed_obj, separators=(",", ":")),
            series_sha,
            now_iso,
        ],
    )

    try:
        nav_pq = settings.cache_dir / "nav.parquet"
        if nav_pq.exists():
            pq_df = pd.read_parquet(nav_pq)
            existing_cnt = int((pq_df["slug"].astype(str).str.upper() == slug.upper()).sum())
            if obs_days > existing_cnt + 10:
                add_df = pd.DataFrame({
                    "slug": slug,
                    "nav_date": df["nav_date"],
                    "nav": df["nav"],
                    "adj_nav": df["adj_nav"],
                    "dividend": df["dividend"],
                    "currency": ccy,
                    "series_type": packed_obj.get("t") or default_stype,
                    "source": packed_obj.get("s") or default_src,
                })
                merged = pd.concat([pq_df[pq_df["slug"].astype(str).str.upper() != slug.upper()], add_df], ignore_index=True)
                merged.to_parquet(nav_pq, index=False)
    except Exception:
        pass

    s = df.set_index(pd.to_datetime(df["nav_date"]))["adj_nav"].astype(float).sort_index()
    latest_nav = float(df["nav"].iloc[-1])

    def _ret_days(days_back: int, annualize: bool = False) -> float | None:
        cutoff = s.index[-1] - pd.Timedelta(days=days_back)
        if (s.index[-1] - s.index[0]).days < int(days_back * 0.75):
            return None
        sub = s[s.index >= cutoff]
        if len(sub) < 3 or sub.iloc[0] <= 0:
            return None
        tot = float(sub.iloc[-1] / sub.iloc[0] - 1.0)
        if not annualize:
            return round(tot, 4)
        yrs = max((sub.index[-1] - sub.index[0]).days / 365.25, 0.25)
        return round(float((1.0 + tot) ** (1.0 / yrs) - 1.0), 4) if (1.0 + tot > 0) else round(tot, 4)

    def _vol_mdd(days_back: int) -> tuple[float | None, float | None]:
        cutoff = s.index[-1] - pd.Timedelta(days=days_back)
        if (s.index[-1] - s.index[0]).days < int(days_back * 0.75):
            return None, None
        sub = s[s.index >= cutoff]
        if len(sub) < 10:
            return None, None
        r = sub.pct_change().dropna()
        vol = round(float(r.std(ddof=1) * np.sqrt(252.0)), 4) if len(r) > 2 else None
        arr = sub.to_numpy(dtype=float)
        rm = np.maximum.accumulate(arr)
        mdd = round(float(np.min(arr / rm - 1.0)), 4)
        return vol, mdd

    yr_start = pd.Timestamp(year=s.index[-1].year, month=1, day=1)
    before_yr = s[s.index < yr_start]
    ret_ytd = round(float(s.iloc[-1] / before_yr.iloc[-1] - 1.0), 4) if not before_yr.empty else None
    ret_1m = _ret_days(30, False)
    ret_3m = _ret_days(91, False)
    ret_6m = _ret_days(182, False)
    ret_1y = _ret_days(365, False)
    ret_3y_ann = _ret_days(365 * 3, True)
    ret_5y_ann = _ret_days(365 * 5, True)
    vol_1y, max_dd_1y = _vol_mdd(365)
    vol_3y, max_dd_3y = _vol_mdd(365 * 3)
    _, max_dd_5y = _vol_mdd(365 * 5)

    perf = val_data.get("performance") or {}
    w3 = perf.get("win_3y") or {}
    bm_rel = perf.get("benchmark_rel_3y") or {}
    rf_ann = 0.021 if market == "CN" else 0.042
    sharpe_3y = w3.get("sharpe")
    sortino_3y = w3.get("sortino")
    calmar_3y = w3.get("calmar")
    if ret_3y_ann is not None and vol_3y and vol_3y > 1e-4:
        sharpe_3y = round((ret_3y_ann - rf_ann) / vol_3y, 3)
    if ret_3y_ann is not None and max_dd_3y is not None and max_dd_3y < -1e-4:
        calmar_3y = round(ret_3y_ann / abs(max_dd_3y), 3)

    div_ttm_pct = a_meta.get("dividend_yield_ttm")
    div_ratio = round(float(div_ttm_pct) / 100.0, 4) if div_ttm_pct is not None and float(div_ttm_pct) > 0 else 0.0

    existing_m: dict[str, Any] = {}
    try:
        m_res = d1.execute_statement("SELECT * FROM wq_fund_metrics WHERE slug = ? COLLATE NOCASE", [slug])
        m_rows = (m_res.get("result") or [{}])[0].get("results") or []
        if m_rows:
            existing_m = m_rows[0]
    except Exception:
        existing_m = {}

    peer_rank_pct = existing_m.get("peer_rank_pct")
    quant_score = existing_m.get("quant_score")
    quant_grade = existing_m.get("quant_grade")
    if quant_score is None:
        p_score = float(a_meta.get("pillar_score") or 0.0)
        base_q = 65.0 + p_score * 15.0 + (float(sharpe_3y or 0.0) * 6.0 if sharpe_3y and abs(float(sharpe_3y)) < 3 else 0.0)
        quant_score = round(max(30.0, min(92.0, base_q)), 1)
        quant_grade = "A" if quant_score >= 70 else ("B" if quant_score >= 55 else ("C" if quant_score >= 40 else "D"))
    if peer_rank_pct is None:
        peer_rank_pct = round(max(0.05, min(0.95, float(quant_score) / 100.0)), 3)

    new_tier = "A" if (market == "CN" or existing_m.get("data_tier") == "A") else ("B" if obs_days >= 250 else "C")

    d1.execute_statement(
        """
        INSERT OR REPLACE INTO wq_fund_metrics (
          slug, as_of_date, valuation_date, latest_nav, latest_nav_currency,
          ret_1m, ret_3m, ret_6m, ret_ytd, ret_1y, ret_3y_ann, ret_5y_ann,
          vol_1y, vol_3y, max_dd_1y, max_dd_3y, max_dd_5y, dd_recovery_days,
          sharpe_3y, sortino_3y, calmar_3y, beta_3y, alpha_3y, r2_3y, ir_3y,
          div_yield_ttm, peer_rank_pct, quant_score, quant_grade, obs_days, data_tier, anomalies_json, computed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            slug,
            str(a_meta.get("data_as_of") or end_d),
            end_d,
            round(latest_nav, 4),
            ccy,
            ret_1m if ret_1m is not None else existing_m.get("ret_1m"),
            ret_3m if ret_3m is not None else existing_m.get("ret_3m"),
            ret_6m if ret_6m is not None else existing_m.get("ret_6m"),
            ret_ytd if ret_ytd is not None else existing_m.get("ret_ytd"),
            ret_1y if ret_1y is not None else existing_m.get("ret_1y"),
            ret_3y_ann if ret_3y_ann is not None else existing_m.get("ret_3y_ann"),
            ret_5y_ann if ret_5y_ann is not None else existing_m.get("ret_5y_ann"),
            vol_1y if vol_1y is not None else existing_m.get("vol_1y"),
            vol_3y if vol_3y is not None else existing_m.get("vol_3y"),
            max_dd_1y if max_dd_1y is not None else existing_m.get("max_dd_1y"),
            max_dd_3y if max_dd_3y is not None else existing_m.get("max_dd_3y"),
            max_dd_5y if max_dd_5y is not None else existing_m.get("max_dd_5y"),
            w3.get("dd_recovery_days") if w3.get("dd_recovery_days") is not None else existing_m.get("dd_recovery_days"),
            sharpe_3y if sharpe_3y is not None else existing_m.get("sharpe_3y"),
            sortino_3y if sortino_3y is not None else existing_m.get("sortino_3y"),
            calmar_3y if calmar_3y is not None else existing_m.get("calmar_3y"),
            bm_rel.get("beta") if bm_rel.get("beta") is not None else existing_m.get("beta_3y"),
            bm_rel.get("alpha") if bm_rel.get("alpha") is not None else existing_m.get("alpha_3y"),
            bm_rel.get("r2") if bm_rel.get("r2") is not None else existing_m.get("r2_3y"),
            bm_rel.get("ir") if bm_rel.get("ir") is not None else existing_m.get("ir_3y"),
            div_ratio if div_ratio > 0 else (existing_m.get("div_yield_ttm") or 0.0),
            peer_rank_pct,
            quant_score,
            quant_grade,
            obs_days,
            new_tier,
            existing_m.get("anomalies_json") or "[]",
            now_iso,
        ],
    )
    d1.execute_statement("UPDATE wq_funds SET data_tier = ? WHERE slug = ? COLLATE NOCASE", [new_tier, slug])
    return obs_days, True


def _build_xray_profile_from_sop(
    report_dir: Path,
    a_meta: dict[str, Any],
    val_data: dict[str, Any],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Assemble compact xray_profile_json and top_holdings_json from SOP .review files."""
    xray_file = report_dir / ".review" / "xray_profile.json"
    fin_file = report_dir / ".review" / "latest_fund_fin.json"

    xray_profile: dict[str, Any] | None = None
    if xray_file.exists():
        try:
            xray_profile = json.loads(xray_file.read_text(encoding="utf-8-sig"))
        except Exception:
            xray_profile = None

    val_sum = val_data.get("valuation_summary") or {}
    if xray_profile is None and (val_sum or a_meta):
        ftype = str(a_meta.get("fund_type") or "").upper()
        if ftype in ("ETF", "ACTIVE"):
            asset_split = {"equity": 98.0, "bond": 0.0, "cash": 2.0, "other": 0.0}
        elif ftype == "BOND_MMF":
            asset_split = {"equity": 0.0, "bond": 98.0, "cash": 2.0, "other": 0.0}
        else:
            asset_split = None
        xray_profile = {
            "source": "sop_v2",
            "updated_at": str(a_meta.get("data_as_of") or now_hkt().strftime("%Y-%m-%d")),
            "asset_split": asset_split,
            "valuation": {
                "pe": val_sum.get("pe_current"),
                "ytm": val_sum.get("ytm_pct"),
                "duration": val_sum.get("duration_yrs"),
            },
        }

    top_holdings_obj: dict[str, Any] | None = None
    th_file = report_dir / ".review" / "top_holdings.json"
    if th_file.exists():
        try:
            top_holdings_obj = json.loads(th_file.read_text(encoding="utf-8-sig"))
        except Exception:
            top_holdings_obj = None

    if top_holdings_obj is None and fin_file.exists():
        try:
            fin_data = json.loads(fin_file.read_text(encoding="utf-8-sig"))
            em_block = fin_data.get("eastmoney") or {}
            em_top = em_block.get("holdings") or em_block.get("top10_holdings") or []
            if isinstance(em_top, list) and em_top:
                items = []
                for h in em_top[:10]:
                    name = str(h.get("股票名称") or h.get("name") or h.get("股票简称") or "").strip()
                    sym = str(h.get("股票代码") or h.get("symbol") or h.get("code") or "").strip() or None
                    pct_raw = h.get("占净值比例") or h.get("weight_pct")
                    pct = float(pct_raw) if pct_raw not in (None, "") else None
                    if name or sym:
                        items.append({"name": name or sym, "symbol": sym, "weight_pct": pct})
                if items:
                    top_holdings_obj = {
                        "source": "SOP v2.0 / Eastmoney",
                        "holdings": items,
                        "top10_total_pct": round(sum(x["weight_pct"] or 0.0 for x in items), 2),
                    }
        except Exception:
            top_holdings_obj = None

    return xray_profile, top_holdings_obj


def _extract_masters_summary(body: str) -> list[dict[str, str]]:
    """Parse markdown table rows under §14 for structured UI summary cards."""
    m = re.search(r"<!--\s*FUND_TAB:\s*masters[^>]*-->([\s\S]*?)(?:<!--\s*FUND_TAB:|$)", body)
    if not m:
        return []
    chunk = m.group(1)
    masters: list[dict[str, str]] = []
    known = ("Bogle", "Swensen", "Marks", "Buffett", "Klarman", "Mauboussin")
    for line in chunk.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip().strip("*") for c in line.strip().strip("|").split("|")]
        if len(cells) >= 4 and any(k.lower() in cells[0].lower() for k in known):
            masters.append({
                "master": cells[0],
                "focus": cells[1],
                "evidence": cells[2],
                "stance": cells[3],
                "red_flag": cells[4] if len(cells) >= 5 else "",
            })
    return masters
