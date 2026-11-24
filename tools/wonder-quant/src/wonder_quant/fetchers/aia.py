from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

import httpx

from wonder_quant.fetchers import CircuitOpenError

AIA_FUNDINFO2_URL = "https://www1.aia.com.hk/CorpWS/Investment/Get/FundInfo2/"
AIA_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.aia.com.hk/zh-hk/help-and-support/individuals/investment-information/investment-options-prices.html",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
}

PRICE_BRACKET_RE = re.compile(r"\[(\d+(?:,\d{3})*(?:\.\d+)?)\]")
TAG_RE = re.compile(r"<[^>]+>")


def parse_aia_valuation_date(raw: str, today: date | None = None) -> str:
    """Parse AIA FundInfo2 valuationDate string strictly as MM/DD/YYYY (e.g. '[09/01/2026]' -> '2026-09-01')."""
    cleaned = str(raw or "").strip().strip("[]").strip()
    if not cleaned:
        raise ValueError("Empty AIA valuationDate")

    # AIA HK FundInfo2 consistently uses MM/DD/YYYY inside brackets
    try:
        dt = datetime.strptime(cleaned, "%m/%d/%Y").date()
    except ValueError as exc:
        # Fallback if AIA ever switches to ISO YYYY-MM-DD
        try:
            dt = datetime.strptime(cleaned, "%Y-%m-%d").date()
        except ValueError:
            raise ValueError(f"Unsupported AIA valuationDate format: {raw!r}") from exc

    ref_today = today or date.today()
    if dt > ref_today + timedelta(days=2):
        raise ValueError(
            f"AIA valuationDate {dt.isoformat()} is in the future relative to {ref_today.isoformat()} (raw={raw!r})"
        )
    return dt.isoformat()


def parse_aia_price(raw: str) -> float | None:
    if raw is None:
        return None
    s = str(raw)
    m = PRICE_BRACKET_RE.search(s)
    if m:
        return float(m.group(1).replace(",", ""))
    plain = TAG_RE.sub(" ", s).replace("&nbsp;", " ")
    m2 = re.search(r"(\d+(?:,\d{3})*(?:\.\d+)?)", plain)
    return float(m2.group(1).replace(",", "")) if m2 else None


def fetch_aia_tmp2_snapshot(
    scheme: str = "TMP2",
    proxy: str | None = None,
    timeout: float = 25.0,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """Fetch official AIA HK FundInfo2 snapshot for TMP2 (single HTTP request per R6)."""
    client_kwargs: dict[str, Any] = {"timeout": timeout, "headers": AIA_HEADERS, "follow_redirects": True}
    if proxy:
        client_kwargs["proxy"] = proxy

    with httpx.Client(**client_kwargs) as client:
        resp = client.get(
            AIA_FUNDINFO2_URL,
            params={"fund_cat": scheme, "lang": "zh"},
        )
        if resp.status_code in (401, 403, 429):
            raise CircuitOpenError("aia_fundinfo2", resp.status_code, resp.text[:200])
        resp.raise_for_status()
        payload = resp.json()

    items = payload if isinstance(payload, list) else payload.get("data", payload.get("FundInfo", []))
    parsed: list[dict[str, Any]] = []
    for row in items:
        code = str(row.get("code") or "").strip().upper()
        if not code:
            continue
        bid = parse_aia_price(row.get("bidPrice") or row.get("offerPrice"))
        if bid is None or bid <= 0:
            continue
        val_date = parse_aia_valuation_date(str(row.get("valuationDate") or ""), today=today)
        parsed.append(
            {
                "aia_code": code,
                "isin": str(row.get("ISIN") or "").strip().upper() or None,
                "nav_date": val_date,
                "nav": bid,
                "currency_raw": str(row.get("currency") or "").strip(),
                "name": str(row.get("name") or "").strip(),
            }
        )
    return parsed
