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
    # Guard against tax/withholding strings mistakenly mapped into fee
    if any(k in s for k in ("税", "tax", "withholding", "预扣")):
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", s)
    if not m:
        return None
    val = round(float(m.group(1)), 4)
    return val if 0.0 <= val <= 5.0 else None


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


_EXPLICIT_CORE_CODES: set[str] = {
    # Broad Global / Developed / US Market-Cap Core Equities
    "VT", "VWRA", "VWRD", "IWDA", "MXWO", "JREG", "IXUS",
    "SPY", "VOO", "IVV", "VTI", "CSPX", "VUAA", "SPYL", "VUSD", "IUSA", "IDUS",
    "A22", "M01", "CG1",
    # Broad Global / Developed / US Dividend & Equity-Income Core Equities
    "VHYA", "VHYD", "VHYL", "VYMI", "VIGI",
    "SCHD", "VYM", "VIG", "HDV", "SPYD", "DGRO", "NOBL", "DVY", "SDY",
    "I17", "Z17", "Z37", "J16", "R51", "Z51",
    # Broad Sovereign / IG Aggregate / 100% IG Corporate / Short IG / Money Market
    "AGG", "BND", "SCHZ", "SPAB", "IUSB", "FBND", "AGGU",
    "VDTA", "VDTY", "CBU7", "CBU0", "IDTM", "IEF",
    "LQDA", "LQDE", "PURC", "PRIP", "VCIT", "IGSB", "SCHJ", "VSCSX",
    "BIL", "SGOV", "IB01", "IB0D", "IBTU", "IBTA", "IBTS", "IDBT", "CSH2",
    "SCHO", "SPTS", "BSV", "VBIRX", "VSBSX", "VSGBX", "VUSB", "JPST", "MINT", "EMNT",
    "BUBIX", "BSBSX", "FSHBX", "FJRLX", "FLTB", "PAIAX", "PSHAX", "TSDUX", "BOXX",
    "VTIP", "SCHP", "9096.HK",
    "M11", "N08", "CG9", "Z29", "Z39", "B01", "W06", "Z36", "Z66", "E05", "M13", "W04", "A05",
    # Broad Core Balanced / Allocation (US/Global Equity + IG Aggregate Bond)
    "AOA", "AOR", "AOK", "IRTR", "ITDB", "ITDC", "ITDD", "ITDE", "ITDF", "ITDG", "ITDH", "ITDI", "ITDJ",
    "R03", "Z33",
}

_HARD_SATELLITE_CODES: set[str] = {
    # Sub-IG / High Yield / Opportunistic / Flexible / Convertible / Preferred / CEF
    "F16", "Z12", "Z32",
    "G16", "Z16", "Z26", "I28", "M10", "Z13", "P08", "Z08", "R52", "Z52", "U06", "ZU6", "X15", "Z15", "Z25",
    "C03", "C09", "Z69", "J07", "NB1", "Z05", "I27", "L51", "ZL1", "Q02", "Y02", "Y22", "Z11", "Z22",
    "N01", "PC4", "ZP4",
    "P07", "Z07", "Z27", "D18", "Z18", "Z28", "J20", "Z20", "Z30", "W07", "Z77", "A32", "Z06", "V07",
    "A15", "GG", "I23", "N06", "N07", "L52",
    "V02", "Z01", "Z21", "F15", "Z04", "Z24", "Q01",
    "HYG", "HYGH", "JNK", "SJNK", "SCYB", "USHY", "UHYC", "YIEL", "IHYU", "NEMD",
    "TFLR", "HFSI", "JFLX", "JPIE", "PSDM", "SDMZX", "BRTR", "FPNIX", "JCPB", "UYLX",
    "BINC", "BTZ", "EFR", "FLC", "JPC", "PCN", "PTY", "VTEB",
    "DIVO", "IDVO", "BDJ", "DNP", "UTF", "JEPI", "JEPQ", "R01", "Z31",
    "DTLA", "IDTL", "TLT", "EDV",
    "I37MXN", "ID27", "IDTXX", "IMMXX", "VMSTX",
    "IWVL", "IWVG", "EFV", "IQLT", "MOAT",
    "CNDX", "EQAC", "EQQQ", "EQQU", "IUIT", "QQQ",
}

_SATELLITE_RE = re.compile(
    r"高收益|備兌|备兑|新兴|新興|亚洲|亞洲|亚太|亞太|太平洋|东盟|印度|南韓|韩国|台灣|台湾|"
    r"拉丁美洲|巴西|東歐|东欧|澳洲|中國|中国|神州|大中華|大中华|港股|A股|沪深|中证|恒生|日本|歐洲.*股票|欧洲.*股票|歐洲遠見|歐洲動態|"
    r"科技|纳斯达克|生物|醫療|医疗|健康|能源|環境|礦業|黃金|貴金屬|資源|消費|品牌|房地產|基建|可轉換|可转换|優先證券|优先证券|CoCo|"
    r"小型|中小|20\+yr|20\+年|超长期|焦點|焦点|機會基金|優勢基金|"
    r"high\s*yield|hi\s*yld|\bhy\b|covered\s*call|enhanced\s*dividend|superdividend|emerging|\bem\b|asian|asia|china|chinese|greater\s*china|taiwan|korea|india|asean|latin|brazil|japan|nikkei|topix|"
    r"convertible|preferred|floating\s*rate|flexible|strategic\s*income|credit\s*allocation|multi-sector|yield\s*plus|"
    r"nasdaq|technology|biotech|health|energy|gold|mining|resources|real\s*estate|reit|infrastructure|thematic|small[\s-]*cap|value\s*factor|basic\s*value|moat|mxn\s*hedged|tax-exempt",
    re.I,
)

_CORE_KEYWORD_RE = re.compile(
    r"全球综合债|环球债券|全球公司债|标普\s*500|全世界|全市场|短期国债|短期美债|美元短期债|极短期债|货币市场|美元现金|"
    r"美股分红型ETF|美国红利|美国高股息|全球高股息|环球股票高息|环球收益股票|high\s*dividend\s*yield|dividend\s*appreciation|dividend\s*equity|"
    r"s&p\s*500|ftse\s*all-world|msci\s*world|total\s*world|total\s*intl|total\s*stock|total\s*bond|aggregate\s*bond|treasury\s*bond|"
    r"short[- ]term\s*(?:bond|treasury|corporate)|ultra[- ]short|money\s*market",
    re.I,
)


def infer_canonical_role(
    *,
    code: str,
    aia_code: str | None,
    name: str,
    name_en: str | None,
    asset_class: str,
    platform: str,
    currency: str,
    benchmark_code: str,
) -> str:
    """Institutional Core vs. Satellite rule:
    Core is strictly reserved for broad, high-quality Beta (Global/Developed/US broad equities,
    Sovereign/IG aggregate/IG corporate/short-IG bonds, money market cash, and core IG balanced).
    High-yield, EM/Asia/single-country, convertible/preferred, sector/theme/factor, and 20+Y duration are strictly Satellite.
    """
    c = (aia_code or code or "").strip().upper()
    c_base = re.sub(r"\.[A-Z]+$", "", c)
    text = f"{name or ''} {name_en or ''} {platform or ''}"

    if (
        c in _HARD_SATELLITE_CODES
        or c_base in _HARD_SATELLITE_CODES
        or currency == "MXN"
        or benchmark_code == "HYG"
        or _SATELLITE_RE.search(text)
    ):
        return "卫星"

    is_cash = asset_class == "货币基金" or bool(re.search(r"money\s*market|货币|現金|现金", text, re.I))
    if not is_cash and re.search(r"香港|hong\s*kong", text, re.I):
        return "卫星"

    if c in _EXPLICIT_CORE_CODES or c_base in _EXPLICIT_CORE_CODES:
        return "核心"

    if _CORE_KEYWORD_RE.search(text):
        return "核心"

    return "卫星"


def load_catalog(
    vault_fund_dir: Path,
    overrides_path: Path | None = None,
    extra_funds_path: Path | None = None,
) -> list[FundRecord]:
    """Read Vault 309-fund catalog read-only and merge local overrides + TMP2/AIA snapshots + extra UCITS ETFs."""
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

        platform = str(ov.get("ilas_platform") or item.get("ilas_platform") or "").strip()
        raw_code = str(ov.get("code") or item.get("code") or "").strip()
        name = str(ov.get("name") or item.get("name") or slug).strip()
        asset_class = str(ov.get("asset_class") or item.get("asset_class") or "股票").strip()
        base_tags = [str(t) for t in (item.get("tags") or [])]
        ov_tags = [str(t) for t in (ov.get("tags") or [])]
        tags = list(dict.fromkeys([*ov_tags, *base_tags])) if ov_tags else base_tags
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
                        sy = float(d_info["yield_pct"])
                        if 0.0 <= sy <= 25.0:
                            snapshot_yield_pct = sy
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

        canonical_role = infer_canonical_role(
            code=clean_code,
            aia_code=aia_code,
            name=name,
            name_en=str(ov.get("name_en") or item.get("name_en") or "").strip() or None,
            asset_class=asset_class,
            platform=platform,
            currency=currency,
            benchmark_code=benchmark_code,
        )
        # Only honor explicit role override when it doesn't promote a Hard-Satellite asset into Core
        eff_role = str(ov["role"]).strip() if "role" in ov and ov["role"] in ("核心", "卫星") else canonical_role
        if canonical_role == "卫星":
            eff_role = "卫星"

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
                manager=str(ov.get("manager") or item.get("manager") or "").strip() or None,
                asset_class=asset_class,
                ilas_platform=platform,
                currency=currency,
                risk_class=str(item.get("risk_class") or "").strip() or None,
                morningstar_stars=_parse_stars(item.get("stars")),
                fee_pct=(
                    _parse_fee_pct(ov["fee_pct"])
                    if "fee_pct" in ov
                    else _parse_fee_pct(item.get("fee_pct") or item.get("fee"))
                ),
                role=eff_role,
                fit_plans=fit_plans,
                tags=tags,
                commentary=str(ov.get("commentary") or item.get("commentary") or "").strip() or None,
                twin_code=twin_code,
                is_distributing=is_distributing,
                snapshot_yield_pct=snapshot_yield_pct,
                benchmark_code=benchmark_code,
                primary_source=primary_source or "none",
                data_tier=prelim_tier,
                is_trackable=True,
                is_vault_native=True,
                status=str(item.get("status") or "active"),
                vault_last_updated=str(item.get("last_updated") or "") or None,
            )
        )

    # Merge supplemental funds defined outside Vault (strict R3: read-only Vault)
    resolved_extra_path = extra_funds_path or (CONFIG_DIR / "extra_ucits_etfs.yaml" if overrides_path is None else None)
    if resolved_extra_path and resolved_extra_path.exists():
        existing_slugs = {r.slug for r in records}
        extra_cfg = _load_yaml(resolved_extra_path)
        for ex in extra_cfg.get("extra_funds") or []:
            ex_slug = str(ex.get("slug") or "").strip()
            if not ex_slug or ex_slug in existing_slugs:
                continue
            ex_ov = slug_overrides.get(ex_slug, {})
            ex_name = str(ex_ov.get("name") or ex.get("name") or ex_slug).strip()
            ex_asset_class = str(ex_ov.get("asset_class") or ex.get("asset_class") or "股票").strip()
            ex_platform = str(ex_ov.get("ilas_platform") or ex.get("ilas_platform") or "非投连险-国际股票").strip()
            ex_ccy = str(ex_ov.get("currency") or ex.get("currency") or "USD").upper()
            ex_tags = [str(t) for t in (ex_ov.get("tags") or ex.get("tags") or [])]
            ex_bench = str(
                ex_ov.get("benchmark_code")
                or ex.get("benchmark_code")
                or _infer_benchmark(ex_asset_class, ex_platform, ex_name, ex_ccy, ex_tags)
            )
            ex_code = str(ex_ov.get("code") or ex.get("code") or ex_slug).strip()
            ex_canon_role = infer_canonical_role(
                code=ex_code,
                aia_code=None,
                name=ex_name,
                name_en=str(ex.get("name_en") or "").strip() or None,
                asset_class=ex_asset_class,
                platform=ex_platform,
                currency=ex_ccy,
                benchmark_code=ex_bench,
            )
            ex_raw_role = str(ex_ov.get("role") or ex.get("role") or "").strip()
            ex_eff_role = ex_raw_role if ex_raw_role in ("核心", "卫星") and ex_canon_role != "卫星" else ex_canon_role
            records.append(
                FundRecord(
                    slug=ex_slug,
                    code=ex_code,
                    aia_code=None,
                    isin=ex_ov.get("isin") or ex.get("isin"),
                    morningstar_id=ex_ov.get("morningstar_id") or ex.get("morningstar_id"),
                    yahoo_ticker=ex_ov.get("yahoo_ticker") or ex.get("yahoo_ticker"),
                    cn_code=None,
                    name=ex_name,
                    name_en=str(ex.get("name_en") or "").strip() or None,
                    manager=str(ex_ov.get("manager") or ex.get("manager") or "").strip() or None,
                    asset_class=ex_asset_class,
                    ilas_platform=ex_platform,
                    currency=ex_ccy,
                    risk_class=str(ex.get("risk_class") or "").strip() or None,
                    morningstar_stars=_parse_stars(ex.get("stars")),
                    fee_pct=_parse_fee_pct(ex_ov.get("fee_pct") if "fee_pct" in ex_ov else ex.get("fee_pct")),
                    role=ex_eff_role,
                    fit_plans=[str(p) for p in (ex.get("fit_plans") or [])],
                    tags=ex_tags,
                    commentary=str(ex_ov.get("commentary") or ex.get("commentary") or "").strip() or None,
                    twin_code=ex_ov.get("twin_code") if "twin_code" in ex_ov else ex.get("twin_code"),
                    is_distributing=bool(ex_ov.get("is_distributing", ex.get("is_distributing", False))),
                    snapshot_yield_pct=None,
                    benchmark_code=ex_bench,
                    primary_source=ex_ov.get("primary_source") or ex.get("primary_source") or "yfinance",
                    data_tier="A",
                    is_trackable=True,
                    is_vault_native=False,
                    status=str(ex.get("status") or "active"),
                    vault_last_updated=None,
                )
            )
            existing_slugs.add(ex_slug)

    # Bidirectional twin_code linking (Acc <-> Dist) so both accumulating and distributing funds carry their twin code
    by_code: dict[str, FundRecord] = {}
    for rec in records:
        if not rec.is_trackable:
            continue
        if rec.aia_code:
            by_code.setdefault(rec.aia_code.strip().upper(), rec)
        if rec.code:
            by_code.setdefault(rec.code.strip().upper(), rec)

    # Sort sources so same-currency opposite share-class wins first when multiple twins exist (e.g. Z01 USD before Z21 CNY)
    reverse_candidates: dict[str, list[FundRecord]] = {}
    for rec in records:
        if rec.is_trackable and rec.twin_code:
            target = by_code.get(rec.twin_code.strip().upper())
            if target and target.slug != rec.slug:
                reverse_candidates.setdefault(target.slug, []).append(rec)

    for rec in records:
        if rec.is_trackable and not rec.twin_code:
            cands = reverse_candidates.get(rec.slug, [])
            if cands:
                cands_sorted = sorted(
                    cands,
                    key=lambda x: (
                        0 if x.currency == rec.currency else 1,
                        0 if x.is_distributing != rec.is_distributing else 1,
                        x.code,
                    ),
                )
                best = cands_sorted[0]
                rec.twin_code = (best.aia_code or best.code).strip().upper()

    # Enforce uniform Core/Satellite role across twin share classes of the exact same fund
    for rec in records:
        if rec.is_trackable and rec.twin_code:
            twin = by_code.get(rec.twin_code.strip().upper())
            if twin and twin.slug != rec.slug and (rec.role == "卫星" or twin.role == "卫星"):
                rec.role = "卫星"
                twin.role = "卫星"

    return records


def summarize_catalog(records: list[FundRecord]) -> dict[str, Any]:
    trackable = [r for r in records if r.is_trackable]
    skipped = [r for r in records if not r.is_trackable]
    vault_native_count = sum(1 for r in records if r.is_vault_native)
    extra_catalog_count = sum(1 for r in records if not r.is_vault_native)
    return {
        "total_in_vault": vault_native_count,
        "extra_catalog_count": extra_catalog_count,
        "total_catalog": len(records),
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
