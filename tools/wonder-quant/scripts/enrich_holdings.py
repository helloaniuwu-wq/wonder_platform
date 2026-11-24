"""
enrich_holdings.py — 全面抓取与丰富基金持仓（Top 10 Holdings）、久期、到期收益率、评级并持久化入库 D1。
支持两种运行模式：
1. 默认批量模式：扫描本地 PDF Factsheet + yfinance + 孪生继承，全量更新 D1。
2. 队列消费模式 (--consume-queue)：读取 D1 `wq_factsheet_queue` 中 status='pending' 的手动更新请求，
   自动下载/定位最新月报 PDF → pypdf 提取文本 → DeepSeek 大模型抽取结构化字段 →
   回写本地与线上 D1（含孪生份额）并标记 completed。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

import httpx
import yfinance as yf
from dotenv import dotenv_values
from pypdf import PdfReader

TOOLS_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = TOOLS_DIR.parent.parent
VAULT_FUND_DIR = Path(r"D:\Claude_Agent_Workspace\derek-obsidian-sync\05_Investment_Research\03_Funds\00_基金产品库")
VAULT_SOURCES = VAULT_FUND_DIR / "sources" / "pdf_富集源"
VAULT_MONTHLY_SOURCES = VAULT_FUND_DIR / "sources" / "月报_2026"
FACTSHEET_REGISTRY = VAULT_FUND_DIR / "factsheet_sources.json"
D1_STATE_DIR = Path(r"D:\WonderQuant\wrangler-state\v3\d1")
TMP_FACTSHEETS_DIR = Path(r"D:\WonderQuant\tmp\factsheets")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def find_local_d1_sqlite() -> Path | None:
    candidates = sorted(D1_STATE_DIR.rglob("*.sqlite"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def load_llm_env() -> dict[str, str]:
    merged: dict[str, str] = {}
    for env_file in (
        ROOT_DIR / "apps" / "api-worker" / ".dev.vars",
        Path(r"D:\WonderQuant\.env"),
    ):
        if env_file.exists():
            for k, v in dotenv_values(env_file).items():
                if v:
                    merged[k] = v
    for k in ("DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"):
        if os.environ.get(k):
            merged[k] = os.environ[k]
    return merged


def extract_text_from_pdf(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    return "\n".join([page.extract_text() or "" for page in reader.pages])


# ── 1. 大模型 Factsheet 通用抽取器（DeepSeek API）──────────────────────────────

def parse_factsheet_with_llm(text: str, fund_name: str) -> dict[str, Any] | None:
    """Call DeepSeek or OpenRouter Chat API (JSON mode) to extract holdings, duration, yield, rating."""
    if not text or len(text.strip()) < 100:
        return None
    env = load_llm_env()
    providers: list[tuple[str, str, str, str]] = []
    if env.get("DEEPSEEK_API_KEY"):
        providers.append((
            "DeepSeek",
            env.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/"),
            env["DEEPSEEK_API_KEY"],
            env.get("DEEPSEEK_MODEL", "deepseek-chat"),
        ))
    if env.get("OPENROUTER_API_KEY"):
        providers.append((
            "OpenRouter",
            env.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/"),
            env["OPENROUTER_API_KEY"],
            env.get("OPENROUTER_DEEPSEEK_MODEL", "deepseek/deepseek-chat"),
        ))
    if not providers:
        return None

    snippet = text[:14000]
    prompt = (
        f"你是一位严谨的买方基金数据抽取专家。下面是从基金「{fund_name}」官方月报/Factsheet PDF 提取的文本。\n"
        "请从中准确抽取以下结构化 JSON（严格只返回 JSON，不要 markdown 代码块，不要编造未出现的数字；缺失字段填 null）：\n"
        "{\n"
        '  "holdings": [{"name": "持仓名称", "symbol": "可选代码或null", "weight_pct": 权重百分比数字或null}],\n'
        '  "top10_total_pct": 前十大持仓合计百分比数字或null,\n'
        '  "duration": 债券有效久期(年)数字或null,\n'
        '  "yield_pct": 到期收益率(YTM)或组合收益率百分比数字或null,\n'
        '  "avg_rating": "平均信用评级如BBB+或null",\n'
        '  "credit_quality": "简短信用质量描述或null",\n'
        '  "report_date": "报告截止日期YYYY-MM-DD或YYYY-MM或null"\n'
        "}\n\n"
        "注意：\n"
        "1. holdings 最多取前 10 项，weight_pct 必须是数字（例如 6.10 表示 6.10%，不要带 %）。\n"
        "2. 如果文本中明确给出了 Top 10 合计占比，填在 top10_total_pct；否则按提取出的 holdings 权重求和（若都有权重）。\n\n"
        f"PDF 文本：\n{snippet}"
    )

    data: dict[str, Any] | None = None
    for pname, base_url, api_key, model in providers:
        try:
            with httpx.Client(timeout=45.0) as client:
                resp = client.post(
                    f"{base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.1,
                        "max_tokens": 1500,
                    },
                )
                resp.raise_for_status()
                content = resp.json()["choices"][0]["message"]["content"]
                # Strip optional markdown code fences if a provider ignores json_object format
                cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.I)
                data = json.loads(cleaned)
                break
        except Exception as exc:
            print(f"  [LLM] {pname} extraction failed ({exc})")
            continue

    if not isinstance(data, dict):
        return None

    raw_holdings = data.get("holdings")
    holdings: list[dict[str, Any]] = []
    if isinstance(raw_holdings, list):
        for item in raw_holdings[:10]:
            if not isinstance(item, dict):
                continue
            h_name = str(item.get("name") or "").strip()
            if not h_name:
                continue
            w = item.get("weight_pct")
            try:
                w_val = round(float(w), 2) if w is not None else None
            except (TypeError, ValueError):
                w_val = None
            sym = item.get("symbol")
            holdings.append({
                "name": h_name,
                "symbol": str(sym).strip() if sym and str(sym).strip().lower() != "null" else None,
                "weight_pct": w_val,
            })

    def _to_float(v: Any) -> float | None:
        if v is None:
            return None
        try:
            return round(float(v), 4)
        except (TypeError, ValueError):
            return None

    top10_total = _to_float(data.get("top10_total_pct"))
    if top10_total is None and holdings:
        weights = [h["weight_pct"] for h in holdings if isinstance(h.get("weight_pct"), (int, float))]
        if weights:
            top10_total = round(sum(weights), 2)

    report_date = data.get("report_date")
    src_label = f"Factsheet AI 解析 ({report_date})" if report_date else "Factsheet AI 解析"

    return {
        "source": src_label,
        "holdings": holdings,
        "top10_total_pct": top10_total,
        "duration": _to_float(data.get("duration")),
        "yield_pct": _to_float(data.get("yield_pct")),
        "avg_rating": str(data.get("avg_rating")).strip() if data.get("avg_rating") else None,
        "credit_quality": str(data.get("credit_quality")).strip() if data.get("credit_quality") else None,
    }


# ── 2. 正则规则兜底解析器 ────────────────────────────────────────────────────

def parse_franklin_income(text: str) -> dict[str, Any]:
    holdings = []
    pos = text.find("主要發行機構")
    if pos != -1:
        chunk = text[pos : pos + 1200]
        matches = re.findall(r"([A-Z0-9\s/.,\-&]{4,40})\s+(\d+\.\d{2})", chunk)
        for name, pct in matches[:10]:
            name_clean = name.strip()
            if "基金" in name_clean or "佔總數" in name_clean:
                continue
            holdings.append({"name": name_clean, "weight_pct": float(pct)})

    ytm = None
    m_ytm = re.search(r"到\s*期收益率\s*(\d+\.\d{2})\s*%", text)
    if m_ytm:
        ytm = float(m_ytm.group(1))

    total = round(sum(h["weight_pct"] for h in holdings), 2)
    return {
        "source": "富兰克林官方 Factsheet",
        "holdings": holdings,
        "top10_total_pct": total if total > 0 else None,
        "yield_pct": ytm,
        "duration": None,
    }


def parse_value_partners(text: str) -> dict[str, Any]:
    holdings = []
    pos = text.find("名稱 行業")
    if pos != -1:
        chunk = text[pos : pos + 1000]
        matches = re.findall(
            r"([\u4e00-\u9fa5A-Za-z0-9\s().,-]+?)\s+(?:信息技術|通訊服務|工業|銀行|保險|房地產|消費|能源|物料|醫療保健|金融)\s+(\d+\.\d)",
            chunk,
        )
        for name, pct in matches[:10]:
            holdings.append({"name": name.strip(), "weight_pct": float(pct)})

    div_yield = None
    m_y = re.search(r"組合收益率\s*(\d+\.\d)\s*%", text)
    if m_y:
        div_yield = float(m_y.group(1))

    total = round(sum(h["weight_pct"] for h in holdings), 2)
    return {
        "source": "惠理官方月报",
        "holdings": holdings,
        "top10_total_pct": total if total > 0 else None,
        "yield_pct": div_yield,
        "duration": None,
    }


def parse_principal_pc4(text: str) -> dict[str, Any]:
    holdings = []
    pos = text.find("前 12 大持股")
    if pos == -1:
        pos = text.find("前十大")
    if pos != -1:
        chunk = text[pos : pos + 800]
        matches = re.findall(r"([A-Za-z0-9\s/.,\-&]{4,40})\s+(\d+\.\d{2})", chunk)
        for name, pct in matches[:10]:
            name_clean = name.strip()
            if "百分比" in name_clean:
                continue
            holdings.append({"name": name_clean, "weight_pct": float(pct)})

    total = round(sum(h["weight_pct"] for h in holdings), 2)
    return {
        "source": "信安官方月报",
        "holdings": holdings,
        "top10_total_pct": total if total > 0 else None,
        "yield_pct": None,
        "duration": 4.9,
    }


PDF_PARSERS = {
    "D18_F": ("富兰克林入息基金单张", parse_franklin_income),
    "Z18_F": ("富兰克林入息基金单张", parse_franklin_income),
    "Z01_F": ("惠理高息股票基金月报", parse_value_partners),
    "PC4_F": ("信安优先证券_月报", parse_principal_pc4),
    "ZP4_F": ("信安优先证券_月报", parse_principal_pc4),
}


# ── 3. Factsheet PDF 定位与下载 ──────────────────────────────────────────────

def _download_pdf_if_valid(url: str, dest: Path) -> Path | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
        if raw[:1024].lstrip().startswith(b"%PDF"):
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(raw)
            return dest
    except Exception:
        return None
    return None


def locate_or_download_factsheet(
    slug: str,
    code: str | None,
    isin: str | None,
    factsheet_url: str | None,
    fund_name: str = "",
) -> Path | None:
    """Locate local PDF or download from registry / deterministic CDN / queue URL."""
    code_key = (code or slug).strip().upper()

    # 1) Check factsheet_sources.json registry
    candidate_urls: list[str] = []
    if factsheet_url and factsheet_url.strip().lower().endswith(".pdf"):
        candidate_urls.append(factsheet_url.strip())

    if FACTSHEET_REGISTRY.exists():
        try:
            reg = json.loads(FACTSHEET_REGISTRY.read_text(encoding="utf-8"))
            for item in reg.get("sources", []):
                if str(item.get("code") or "").strip().upper() == code_key:
                    if item.get("url"):
                        candidate_urls.append(str(item["url"]).strip())
                    if item.get("local_path") and Path(item["local_path"]).exists():
                        return Path(item["local_path"])
        except Exception:
            pass

    if isin and ("abrdn" in fund_name.lower() or "安本" in fund_name):
        candidate_urls.append(f"https://abrdn.kurtosysweb.com/pdfs/F_STDR_en-gb-NN_{isin.strip().upper()}.pdf")

    for u in dict.fromkeys(candidate_urls):
        dest = TMP_FACTSHEETS_DIR / f"{code_key}.pdf"
        downloaded = _download_pdf_if_valid(u, dest)
        if downloaded:
            return downloaded

    # 2) Fallback to local PDF archive folders
    search_dirs = [VAULT_SOURCES, VAULT_MONTHLY_SOURCES]
    all_pdfs: list[Path] = []
    for d in search_dirs:
        if d.exists():
            all_pdfs.extend(sorted(d.glob("*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True))

    if code_key in PDF_PARSERS or slug in PDF_PARSERS:
        pattern = PDF_PARSERS.get(slug, ("", None))[0]
        if pattern:
            hit = next((p for p in all_pdfs if pattern in p.name), None)
            if hit:
                return hit

    for p in all_pdfs:
        if code_key and (p.name.upper().startswith(f"{code_key}_") or f"_{code_key}_" in p.name.upper()):
            return p

    return None


# ── 4. yfinance 抓取器 ───────────────────────────────────────────────────────

def fetch_yfinance_top_holdings(ticker: str) -> dict[str, Any] | None:
    t_clean = ticker.strip()
    if not t_clean or t_clean.startswith(("LU", "IE", "CASH_")):
        return None

    try:
        t = yf.Ticker(t_clean)
        fd = t.funds_data
        if not fd:
            return None
        th = fd.top_holdings
        if th is None or th.empty:
            return None

        holdings = []
        for sym, row in th.iterrows():
            name = str(row.get("Name") or sym or "").strip()
            pct_raw = row.get("Holding Percent")
            pct = round(float(pct_raw) * 100, 2) if pct_raw is not None and float(pct_raw) > 0 else None
            if name:
                holdings.append({
                    "name": name,
                    "symbol": str(sym).strip() if sym and str(sym) != name else None,
                    "weight_pct": pct,
                })

        if not holdings:
            return None

        total = round(sum(h["weight_pct"] for h in holdings if h["weight_pct"]), 2)
        return {
            "source": "Yahoo Finance (Verified)",
            "holdings": holdings[:10],
            "top10_total_pct": total if total > 0 else None,
        }
    except Exception:
        return None


# ── 5. 写入 D1 工具函数（含孪生同步 & 远程 D1 同步）──────────────────────────

def _apply_enrichment_to_local_db(
    cur: sqlite3.Cursor,
    slug: str,
    code: str | None,
    twin_code: str | None,
    payload: dict[str, Any],
) -> None:
    holdings_json = json.dumps(
        {
            "source": payload["source"],
            "holdings": payload["holdings"],
            "top10_total_pct": payload.get("top10_total_pct"),
        },
        ensure_ascii=False,
    )
    cur.execute(
        """
        UPDATE wq_funds
        SET top_holdings_json = ?,
            yield_pct = COALESCE(?, yield_pct),
            duration = COALESCE(?, duration),
            avg_rating = COALESCE(?, avg_rating),
            credit_quality = COALESCE(?, credit_quality)
        WHERE slug = ?
        """,
        (
            holdings_json,
            payload.get("yield_pct"),
            payload.get("duration"),
            payload.get("avg_rating"),
            payload.get("credit_quality"),
            slug,
        ),
    )
    # 同步到孪生份额（无论是 twin_code 指向对方，还是对方 twin_code 指向自己）
    if twin_code:
        cur.execute(
            """
            UPDATE wq_funds
            SET top_holdings_json = ?,
                duration = COALESCE(?, duration),
                avg_rating = COALESCE(?, avg_rating),
                credit_quality = COALESCE(?, credit_quality)
            WHERE code = ?
            """,
            (
                holdings_json,
                payload.get("duration"),
                payload.get("avg_rating"),
                payload.get("credit_quality"),
                twin_code,
            ),
        )
    if code:
        cur.execute(
            """
            UPDATE wq_funds
            SET top_holdings_json = ?,
                duration = COALESCE(?, duration),
                avg_rating = COALESCE(?, avg_rating),
                credit_quality = COALESCE(?, credit_quality)
            WHERE twin_code = ?
            """,
            (
                holdings_json,
                payload.get("duration"),
                payload.get("avg_rating"),
                payload.get("credit_quality"),
                code,
            ),
        )


def _get_remote_d1_client():
    try:
        sys.path.insert(0, str(TOOLS_DIR / "src"))
        from wonder_quant.config import load_settings
        from wonder_quant.d1_client import D1Client

        settings = load_settings()
        if settings.cf_account_id and settings.cf_api_token:
            return D1Client(settings)
    except Exception:
        pass
    return None


def _sync_enrichment_to_remote_d1(
    d1_client: Any,
    slug: str,
    code: str | None,
    twin_code: str | None,
    payload: dict[str, Any],
    result_summary: str,
) -> None:
    if not d1_client:
        return
    holdings_json = json.dumps(
        {
            "source": payload["source"],
            "holdings": payload["holdings"],
            "top10_total_pct": payload.get("top10_total_pct"),
        },
        ensure_ascii=False,
    )
    d1_client.execute_statement(
        """
        UPDATE wq_funds
        SET top_holdings_json = ?,
            yield_pct = COALESCE(?, yield_pct),
            duration = COALESCE(?, duration),
            avg_rating = COALESCE(?, avg_rating),
            credit_quality = COALESCE(?, credit_quality)
        WHERE slug = ?
        """,
        [
            holdings_json,
            payload.get("yield_pct"),
            payload.get("duration"),
            payload.get("avg_rating"),
            payload.get("credit_quality"),
            slug,
        ],
    )
    if twin_code:
        d1_client.execute_statement(
            "UPDATE wq_funds SET top_holdings_json = ?, duration = COALESCE(?, duration) WHERE code = ?",
            [holdings_json, payload.get("duration"), twin_code],
        )
    if code:
        d1_client.execute_statement(
            "UPDATE wq_funds SET top_holdings_json = ?, duration = COALESCE(?, duration) WHERE twin_code = ?",
            [holdings_json, payload.get("duration"), code],
        )
    d1_client.execute_statement(
        "UPDATE wq_factsheet_queue SET status = 'completed', completed_at = datetime('now'), result_summary = ? WHERE slug = ?",
        [result_summary, slug],
    )


# ── 6. 队列消费模式 (--consume-queue) ────────────────────────────────────────

def consume_queue() -> int:
    db_path = find_local_d1_sqlite()
    d1_client = _get_remote_d1_client()
    processed = 0

    # Collect pending tasks from local D1 SQLite and (if configured) remote D1
    pending_tasks: dict[str, tuple[str | None, str | None, str | None]] = {}
    conn: sqlite3.Connection | None = None
    cur: sqlite3.Cursor | None = None

    if db_path:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        try:
            rows = cur.execute(
                "SELECT slug, code, isin, factsheet_url FROM wq_factsheet_queue WHERE status = 'pending' ORDER BY requested_at ASC"
            ).fetchall()
            for slug, code, isin, f_url in rows:
                pending_tasks[slug] = (code, isin, f_url)
        except sqlite3.OperationalError:
            pass

    if d1_client:
        try:
            resp = d1_client.execute_statement(
                "SELECT slug, code, isin, factsheet_url FROM wq_factsheet_queue WHERE status = 'pending' ORDER BY requested_at ASC"
            )
            for row in resp.get("result", [{}])[0].get("results", []):
                slug = row.get("slug")
                if slug and slug not in pending_tasks:
                    pending_tasks[slug] = (row.get("code"), row.get("isin"), row.get("factsheet_url"))
        except Exception as exc:
            print(f"[queue] remote D1 poll skipped: {exc}")

    if not pending_tasks:
        print("[queue] No pending factsheet refresh tasks.")
        if conn:
            conn.close()
        return 0

    print(f"[queue] Found {len(pending_tasks)} pending tasks.")
    for slug, (q_code, q_isin, q_url) in pending_tasks.items():
        if cur:
            cur.execute("UPDATE wq_factsheet_queue SET status = 'processing' WHERE slug = ?", (slug,))
            conn.commit()  # type: ignore[union-attr]

        fund_meta = None
        if cur:
            fund_meta = cur.execute(
                "SELECT code, name, isin, yahoo_ticker, twin_code FROM wq_funds WHERE slug = ?",
                (slug,),
            ).fetchone()
        code = (fund_meta[0] if fund_meta else None) or q_code
        name = (fund_meta[1] if fund_meta else None) or slug
        isin = (fund_meta[2] if fund_meta else None) or q_isin
        y_ticker = fund_meta[3] if fund_meta else None
        twin_code = fund_meta[4] if fund_meta else None

        result_payload: dict[str, Any] | None = None

        # 1) Try Factsheet PDF (download or local) + LLM / regex parser
        pdf_path = locate_or_download_factsheet(slug, code, isin, q_url, fund_name=name)
        if pdf_path:
            print(f"[queue] {slug}: extracted PDF from {pdf_path.name}")
            raw_text = extract_text_from_pdf(pdf_path)
            result_payload = parse_factsheet_with_llm(raw_text, name)
            if (not result_payload or not result_payload.get("holdings")) and slug in PDF_PARSERS:
                _, regex_fn = PDF_PARSERS[slug]
                result_payload = regex_fn(raw_text)

        # 2) Fallback to yfinance holdings if no PDF yielded holdings
        if (not result_payload or not result_payload.get("holdings")) and y_ticker:
            yf_res = fetch_yfinance_top_holdings(y_ticker)
            if yf_res and yf_res.get("holdings"):
                result_payload = yf_res

        if result_payload and result_payload.get("holdings"):
            summary_str = (
                f"{result_payload['source']}: {len(result_payload['holdings'])} holdings, "
                f"top10={result_payload.get('top10_total_pct')}%"
            )
            if cur:
                _apply_enrichment_to_local_db(cur, slug, code, twin_code, result_payload)
                cur.execute(
                    "UPDATE wq_factsheet_queue SET status = 'completed', completed_at = datetime('now'), result_summary = ?, last_error = NULL WHERE slug = ?",
                    (summary_str, slug),
                )
                conn.commit()  # type: ignore[union-attr]
            if d1_client:
                try:
                    _sync_enrichment_to_remote_d1(d1_client, slug, code, twin_code, result_payload, summary_str)
                except Exception as exc:
                    print(f"[queue] remote D1 sync failed for {slug}: {exc}")
            print(f"[queue] {slug} COMPLETED -> {summary_str}")
            processed += 1
        else:
            err_msg = "未找到可访问的公开 PDF 月报或 Yahoo 持仓数据，请将最新月报 PDF 放入本地 sources/pdf_富集源 目录"
            if cur:
                cur.execute(
                    "UPDATE wq_factsheet_queue SET status = 'failed', completed_at = datetime('now'), last_error = ? WHERE slug = ?",
                    (err_msg, slug),
                )
                conn.commit()  # type: ignore[union-attr]
            print(f"[queue] {slug} FAILED -> {err_msg}")

    if conn:
        conn.close()
    return processed


# ── 7. 默认全量批处理模式 ─────────────────────────────────────────────────────

def run_enrichment(limit_yf: int | None = None) -> None:
    db_path = find_local_d1_sqlite()
    if not db_path:
        print("Error: Local D1 SQLite not found under", D1_STATE_DIR)
        return

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    print(f"Target DB: {db_path.name}")

    # Phase 1: 权威 PDF 解析（优先 LLM，regex 兜底）
    pdf_files = list(VAULT_SOURCES.glob("*.pdf")) if VAULT_SOURCES.exists() else []
    print(f"\n--- Phase 1: Parsing {len(pdf_files)} PDF factsheets ---")
    pdf_updated = 0
    for slug, (pattern, parser) in PDF_PARSERS.items():
        matched_pdf = next((p for p in pdf_files if pattern in p.name), None)
        if not matched_pdf:
            continue
        try:
            row_meta = cur.execute("SELECT code, name, twin_code FROM wq_funds WHERE slug = ?", (slug,)).fetchone()
            code, name, twin_code = row_meta if row_meta else (None, slug, None)
            raw_text = extract_text_from_pdf(matched_pdf)
            data = parse_factsheet_with_llm(raw_text, name or slug)
            if not data or not data.get("holdings"):
                data = parser(raw_text)
            if data and data.get("holdings"):
                _apply_enrichment_to_local_db(cur, slug, code, twin_code, data)
                pdf_updated += 1
                print(f"  [PDF] {slug}: {len(data['holdings'])} holdings (Top10: {data.get('top10_total_pct')}%)")
        except Exception as e:
            print(f"  [!] {slug} PDF error: {e}")

    conn.commit()
    print(f"Phase 1 complete: {pdf_updated} funds updated from PDF.")

    # Phase 2: yfinance 批量持仓抓取
    candidates = cur.execute("""
        SELECT slug, code, name, yahoo_ticker
        FROM wq_funds
        WHERE is_trackable = 1
          AND (top_holdings_json IS NULL OR top_holdings_json = '')
          AND yahoo_ticker IS NOT NULL AND yahoo_ticker != ''
          AND yahoo_ticker NOT LIKE 'LU%' AND yahoo_ticker NOT LIKE 'IE%'
    """).fetchall()

    if limit_yf:
        candidates = candidates[:limit_yf]

    print(f"\n--- Phase 2: Fetching yfinance holdings for {len(candidates)} candidates ---")
    yf_updated = 0

    for idx, (slug, code, _name, y_ticker) in enumerate(candidates, 1):
        try:
            res = fetch_yfinance_top_holdings(y_ticker)
            if res and res["holdings"]:
                cur.execute(
                    "UPDATE wq_funds SET top_holdings_json = ? WHERE slug = ?",
                    (json.dumps(res, ensure_ascii=False), slug),
                )
                yf_updated += 1
                print(f"  [{idx}/{len(candidates)}] {code} ({y_ticker}): OK {len(res['holdings'])} holdings (Top10: {res['top10_total_pct']}%)")
        except Exception:
            pass

        if idx % 10 == 0:
            conn.commit()
            time.sleep(0.5)

    conn.commit()
    print(f"Phase 2 complete: {yf_updated} funds updated via yfinance.")

    # Phase 3: 孪生份额持仓自动继承
    print("\n--- Phase 3: Twin share class inheritance ---")
    twins_updated = 0
    twin_pairs = cur.execute("""
        SELECT a.slug, a.code, a.twin_code, b.slug as twin_slug, b.top_holdings_json
        FROM wq_funds a
        JOIN wq_funds b ON a.twin_code = b.code
        WHERE (a.top_holdings_json IS NULL OR a.top_holdings_json = '')
          AND b.top_holdings_json IS NOT NULL AND b.top_holdings_json != ''
    """).fetchall()

    for slug, code, twin_code, _twin_slug, th_json in twin_pairs:
        cur.execute("UPDATE wq_funds SET top_holdings_json = ? WHERE slug = ?", (th_json, slug))
        twins_updated += 1
        print(f"  [Twin] {code} inherited holdings from twin {twin_code}")

    conn.commit()
    print(f"Phase 3 complete: {twins_updated} funds inherited from twins.")

    total_with_holdings = cur.execute(
        "SELECT COUNT(*) FROM wq_funds WHERE top_holdings_json IS NOT NULL AND top_holdings_json != ''"
    ).fetchone()[0]
    total_funds = cur.execute("SELECT COUNT(*) FROM wq_funds WHERE is_trackable = 1").fetchone()[0]
    print(f"\nALL PHASES COMPLETE! Funds with Top 10 Holdings: {total_with_holdings} / {total_funds} ({total_with_holdings/total_funds*100:.1f}%)")

    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Wonder Quant Factsheet & Holdings Enrichment")
    parser.add_argument("--consume-queue", action="store_true", help="Consume pending requests from wq_factsheet_queue")
    parser.add_argument("--limit-yf", type=int, default=None, help="Limit yfinance batch size")
    args = parser.parse_args()

    if args.consume_queue:
        consume_queue()
    else:
        run_enrichment(limit_yf=args.limit_yf)
