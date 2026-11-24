from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import yaml

from wonder_quant.config import CONFIG_DIR
from wonder_quant.models import FundRecord

ISIN_RE = re.compile(r"\b(?:LU|IE|HK|US|KY|GB|FR|DE|JP|CN|AU|SG|BM|CH)[A-Z0-9]{9}\d\b")
MORNINGSTAR_0P_RE = re.compile(r"\b0P[0-9A-Z]{8}\b")
AIA_CODE_RE = re.compile(r"^([A-Z]{1,3}\d{0,2})\b")
CN_6DIGIT_RE = re.compile(r"\b(\d{6})\b")

CURRENCY_CN_MAP = {
    "美元": "USD",
    "港元": "HKD",
    "港幣": "HKD",
    "人民幣": "CNY",
    "人民币": "CNY",
    "歐元": "EUR",
    "欧元": "EUR",
    "英鎊": "GBP",
    "英镑": "GBP",
    "日圓": "JPY",
    "日元": "JPY",
    "澳元": "AUD",
    "加元": "CAD",
    "新加坡元": "SGD",
    "瑞士法郎": "CHF",
}


def _parse_fee_pct(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s in {"—", "-", "N/A", "n/a", "None"}:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", s)
    return round(float(m.group(1)), 4) if m else None


def _parse_stars(raw: Any) -> int | None:
    if raw is None:
        return None
    if isinstance(raw, int):
        return raw if 1 <= raw <= 5 else None
    s = str(raw)
    cnt = s.count("★")
    if 1 <= cnt <= 5:
        return cnt
    m = re.search(r"\b([1-5])\b", s)
    return int(m.group(1)) if m else None


def _infer_cn_exchange_code(six_digit: str) -> str:
    """Map 6-digit A-share ETF/LOF code to Tencent sh/sz symbol."""
    if six_digit.startswith(("50", "51", "52", "56", "58")):
        return f"sh{six_digit}"
    return f"sz{six_digit}"


def _infer_benchmark(asset_class: str, platform: str, name: str, currency: str, tags: list[str]) -> str:
    text = f"{platform} {name} {' '.join(tags)}".upper()
    if asset_class == "货币基金" or "货币" in text or "MONEY MARKET" in text or "TREASURY 0-1" in text or "0-3 MONTH" in text or "1-3 M" in text:
        return "BIL"
    if asset_class == "固定收益":
        if any(k in text for k in ("高收益", "HIGH YIELD", "JUNK", "HYG", "JNK", "USHY", "SJNK", "SCYB")):
            return "HYG"
        return "AGG"
    if "日本" in text or "JAPAN" in text or "TOPIX" in text or "NIKKEI" in text or currency == "JPY":
        return "1306.T"
    if "港股" in text or "HONG KONG" in text or "恒生" in text or "HANG SENG" in text:
        return "2800.HK"
    if "A股" in text or "中证" in text or "沪深" in text or "CHINA" in text or currency == "CNY":
        if "中国" in text or "CHINA" in text or currency == "CNY":
            return "sh510300" if currency == "CNY" else "2800.HK"
    if any(k in text for k in ("全球", "環球", "GLOBAL", "WORLD", "INTL", "国际", "EAFE")):
        return "VT"
    return "SPY"


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def load_catalog(
    vault_fund_dir: Path,
    overrides_path: Path | None = None,
) -> list[FundRecord]:
    """Read Vault 309-fund catalog read-only and merge local overrides + TMP2/AIA snapshots."""
    overrides = _load_yaml(overrides_path or (CONFIG_DIR / "catalog_overrides.yaml"))
    non_trackable: dict[str, str] = overrides.get("non_trackable_slugs", {})
    slug_overrides: dict[str, dict[str, Any]] = overrides.get("slug_overrides", {})

    funds_json_path = vault_fund_dir / "_funds.json"
    raw_funds = json.loads(funds_json_path.read_text(encoding="utf-8"))
    items = raw_funds if isinstance(raw_funds, list) else raw_funds.get("funds", list(raw_funds.values()))

    # Optional enrichment from official AIA TMP2 snapshot & distributing snapshot (read-only)
    tmp2_by_code: dict[str, dict[str, Any]] = {}
    tmp2_by_isin: dict[str, dict[str, Any]] = {}
    tmp2_path = vault_fund_dir / "sources" / "_tmp2_官方基金列表_20260901_全146只.json"
    if tmp2_path.exists():
        for entry in json.loads(tmp2_path.read_text(encoding="utf-8")):
            c = str(entry.get("code") or "").strip().upper()
            if c:
                tmp2_by_code[c] = entry
            isin = str(entry.get("ISIN") or "").strip().upper()
            if isin:
                tmp2_by_isin[isin] = entry

    div_by_code: dict[str, dict[str, Any]] = {}
    div_path = vault_fund_dir / "sources" / "AIA可派息投资选择_202609_数据.json"
    if div_path.exists():
        div_raw = json.loads(div_path.read_text(encoding="utf-8"))
        if isinstance(div_raw, list):
            for entry in div_raw:
                c = str(entry.get("code") or "").strip().upper()
                if c:
                    div_by_code[c] = entry

    records: list[FundRecord] = []
    funds_md_dir = vault_fund_dir / "funds"

    for item in items:
        slug = str(item.get("slug") or "").strip()
        if not slug:
            continue

        ov = slug_overrides.get(slug, {})
        if slug in non_trackable:
            records.append(
                FundRecord(
                    slug=slug,
                    code=str(item.get("code") or ""),
                    name=str(item.get("name") or slug),
                    asset_class=str(item.get("asset_class") or "其他"),
                    ilas_platform=str(item.get("ilas_platform") or ""),
                    primary_source="none",
                    data_tier="U",
                    is_trackable=False,
                    skip_reason=non_trackable[slug],
                    status="inactive",
                )
            )
            continue

        md_path = funds_md_dir / f"{slug}.md"
        md_text = md_path.read_text(encoding="utf-8", errors="ignore") if md_path.exists() else ""
        blob = json.dumps(item, ensure_ascii=False) + "\n" + md_text

        platform = str(item.get("ilas_platform") or "").strip()
        raw_code = str(ov.get("code") or item.get("code") or "").strip()
        name = str(item.get("name") or slug).strip()
        asset_class = str(ov.get("asset_class") or item.get("asset_class") or "股票").strip()
        tags = [str(t) for t in (item.get("tags") or [])]
        fit_plans = [str(p) for p in (item.get("fit_plans") or [])]

        # Extract ISIN & Morningstar 0P id from json / md
        found_isins = ISIN_RE.findall(blob)
        isin: str | None = ov.get("isin") or (found_isins[0] if found_isins else None)
        found_0p = MORNINGSTAR_0P_RE.findall(blob)
        ms_0p: str | None = ov.get("morningstar_id") or (found_0p[0] if found_0p else None)

        aia_code: str | None = ov.get("aia_code")
        yahoo_ticker: str | None = ov.get("yahoo_ticker")
        cn_code: str | None = ov.get("cn_code")
        currency: str = str(ov.get("currency") or "USD").upper()
        twin_code: str | None = ov.get("twin_code")
        is_distributing: bool = bool(ov.get("is_distributing", False))
        snapshot_yield_pct: float | None = None
        primary_source = ov.get("primary_source")

        if platform.startswith("AIA"):
            if not aia_code:
                m_aia = AIA_CODE_RE.match(raw_code.upper())
                if m_aia and m_aia.group(1) in tmp2_by_code:
                    aia_code = m_aia.group(1)
                elif isin and isin in tmp2_by_isin:
                    aia_code = str(tmp2_by_isin[isin]["code"]).upper()
                elif raw_code and raw_code != "—":
                    aia_code = raw_code.split()[0].upper()

            if aia_code and aia_code in tmp2_by_code:
                t2 = tmp2_by_code[aia_code]
                isin = isin or (str(t2.get("ISIN") or "").strip().upper() or None)
                cn_ccy = str(t2.get("currency") or "").strip()
                if not ov.get("currency") and cn_ccy in CURRENCY_CN_MAP:
                    currency = CURRENCY_CN_MAP[cn_ccy]
                if str(t2.get("distribution_fund") or "").lower() == "y" or "分派" in name or "派息" in name:
                    is_distributing = True

            if aia_code and aia_code in div_by_code:
                d_info = div_by_code[aia_code]
                is_distributing = True
                if not twin_code and d_info.get("twin_code"):
                    twin_code = str(d_info["twin_code"]).strip().upper()
                if d_info.get("yield_pct") is not None:
                    try:
                        snapshot_yield_pct = float(d_info["yield_pct"])
                    except (TypeError, ValueError):
                        pass

            # Clean display code
            clean_code = aia_code or raw_code
            # Historical backfill ticker for AIA: prefer Morningstar 0P ID (works directly on Yahoo!), else ISIN
            if not yahoo_ticker:
                if ms_0p:
                    yahoo_ticker = ms_0p
                elif isin:
                    yahoo_ticker = isin
            primary_source = primary_source or "aia_fundinfo2"

        else:
            clean_code = raw_code
            m_cn = CN_6DIGIT_RE.search(raw_code)
            if primary_source == "eastmoney_open":
                cn_code = cn_code or (m_cn.group(1) if m_cn else raw_code)
                if not ov.get("currency"):
                    currency = "CNY"
            elif (
                "港股通" in platform
                or "中国分红" in platform
                or "A股" in platform
                or (m_cn and m_cn.group(1).startswith(("50", "51", "52", "56", "58", "159")))
            ):
                if m_cn:
                    six = m_cn.group(1)
                    cn_code = cn_code or _infer_cn_exchange_code(six)
                    clean_code = six
                    primary_source = primary_source or "tencent_hfq"
                    if not ov.get("currency"):
                        currency = "CNY"
            elif "日本" in platform and re.match(r"^\d{4}$", raw_code):
                yahoo_ticker = yahoo_ticker or f"{raw_code}.T"
                primary_source = primary_source or "yfinance"
                if not ov.get("currency"):
                    currency = "JPY"
            elif re.match(r"^\d{4,5}(\.HK)?$", raw_code, re.I):
                num = raw_code.upper().replace(".HK", "").zfill(4)
                yahoo_ticker = yahoo_ticker or f"{num}.HK"
                clean_code = yahoo_ticker
                primary_source = primary_source or "yfinance"
                if not ov.get("currency"):
                    currency = "HKD"
            else:
                yahoo_ticker = yahoo_ticker or raw_code
                primary_source = primary_source or "yfinance"
                if not ov.get("currency"):
                    if yahoo_ticker.endswith(".L"):
                        currency = "USD" if any(k in name.upper() for k in ("USD", "$")) else "GBP"
                    elif yahoo_ticker.endswith((".DE", ".PA", ".AS")):
                        currency = "EUR"
                    elif yahoo_ticker.endswith(".MX"):
                        currency = "MXN"

        benchmark_code = str(
            ov.get("benchmark_code") or _infer_benchmark(asset_class, platform, name, currency, tags)
        )

        # Preliminary expected data tier (refined after actual fetch)
        if primary_source in ("yfinance", "tencent_hfq", "eastmoney_open"):
            prelim_tier = "A"
        elif primary_source == "aia_fundinfo2":
            prelim_tier = "B" if (yahoo_ticker or ms_0p or isin) else "C"
        else:
            prelim_tier = "U"

        records.append(
            FundRecord(
                slug=slug,
                code=clean_code,
                aia_code=aia_code,
                isin=isin,
                morningstar_id=ms_0p,
                yahoo_ticker=yahoo_ticker,
                cn_code=cn_code,
                name=name,
                manager=str(item.get("manager") or "").strip() or None,
                asset_class=asset_class,
                ilas_platform=platform,
                currency=currency,
                risk_class=str(item.get("risk_class") or "").strip() or None,
                morningstar_stars=_parse_stars(item.get("stars")),
                fee_pct=_parse_fee_pct(item.get("fee_pct") or item.get("fee")),
                role=str(item.get("role") or "").strip() or None,
                fit_plans=fit_plans,
                tags=tags,
                commentary=str(item.get("commentary") or "").strip() or None,
                twin_code=twin_code,
                is_distributing=is_distributing,
                snapshot_yield_pct=snapshot_yield_pct,
                benchmark_code=benchmark_code,
                primary_source=primary_source or "none",
                data_tier=prelim_tier,
                is_trackable=True,
                status=str(item.get("status") or "active"),
                vault_last_updated=str(item.get("last_updated") or "") or None,
            )
        )

    return records


def summarize_catalog(records: list[FundRecord]) -> dict[str, Any]:
    trackable = [r for r in records if r.is_trackable]
    skipped = [r for r in records if not r.is_trackable]
    return {
        "total_in_vault": len(records),
        "trackable": len(trackable),
        "non_trackable": len(skipped),
        "skipped_slugs": {r.slug: r.skip_reason for r in skipped},
        "by_primary_source": dict(Counter(r.primary_source for r in trackable)),
        "by_asset_class": dict(Counter(r.asset_class for r in trackable)),
        "by_currency": dict(Counter(r.currency for r in trackable)),
        "by_prelim_tier": dict(Counter(r.data_tier for r in trackable)),
        "by_benchmark": dict(Counter(r.benchmark_code for r in trackable)),
        "aia_count": sum(1 for r in trackable if r.primary_source == "aia_fundinfo2"),
        "aia_with_isin_or_0p": sum(
            1 for r in trackable if r.primary_source == "aia_fundinfo2" and (r.isin or r.morningstar_id)
        ),
        "aia_missing_backfill_id": [
            r.slug for r in trackable if r.primary_source == "aia_fundinfo2" and not (r.isin or r.morningstar_id)
        ],
        "unique_yahoo_tickers": len({r.yahoo_ticker for r in trackable if r.yahoo_ticker}),
        "unique_cn_etf_codes": len({r.cn_code for r in trackable if r.primary_source == "tencent_hfq" and r.cn_code}),
        "unique_cn_open_codes": len({r.cn_code for r in trackable if r.primary_source == "eastmoney_open" and r.cn_code}),
    }
