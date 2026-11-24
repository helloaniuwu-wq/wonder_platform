from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Any

import httpx
import pandas as pd

from wonder_quant.fetchers import CircuitOpenError

TENCENT_KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
TENCENT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://gu.qq.com/",
}


def fetch_tencent_etf_series(
    cn_code: str,
    years: int = 5,
    client: httpx.Client | None = None,
) -> pd.DataFrame:
    """
    Fetch A-share / HK-Connect exchange-traded ETF daily close & backward-adjusted (hfq) total-return close.
    cn_code example: 'sh515080', 'sz159201'.
    """
    end_dt = date.today()
    start_dt = end_dt - timedelta(days=years * 366 + 15)
    # Request enough bars (~250 trading days/year + margin)
    limit = max(320, years * 260 + 60)

    own_client = client is None
    http = client or httpx.Client(timeout=20.0, headers=TENCENT_HEADERS)
    try:
        # 1. Backward-adjusted (hfq) reflects total return with dividends reinvested
        r_hfq = http.get(
            TENCENT_KLINE_URL,
            params={"param": f"{cn_code},day,{start_dt.isoformat()},{end_dt.isoformat()},{limit},hfq"},
        )
        if r_hfq.status_code in (401, 403, 429):
            raise CircuitOpenError("tencent_hfq", r_hfq.status_code, r_hfq.text[:200])
        r_hfq.raise_for_status()
        d_hfq = r_hfq.json()
        node = (d_hfq.get("data") or {}).get(cn_code) or {}
        hfq_arr = node.get("hfqday") or node.get("qfqday") or node.get("day") or []

        # 2. Unadjusted daily close (for clean display NAV)
        r_raw = http.get(
            TENCENT_KLINE_URL,
            params={"param": f"{cn_code},day,{start_dt.isoformat()},{end_dt.isoformat()},{limit},"},
        )
        raw_map: dict[str, float] = {}
        if r_raw.status_code == 200:
            raw_node = (r_raw.json().get("data") or {}).get(cn_code) or {}
            for rec in raw_node.get("day") or []:
                if len(rec) >= 3:
                    try:
                        val = float(rec[2])
                        if val > 0:
                            raw_map[str(rec[0])[:10]] = val
                    except (TypeError, ValueError):
                        pass

        rows: list[dict[str, Any]] = []
        for rec in hfq_arr:
            if len(rec) < 3:
                continue
            dt_str = str(rec[0])[:10]
            try:
                adj_val = float(rec[2])
            except (TypeError, ValueError):
                continue
            if adj_val <= 0:
                continue
            clean_val = raw_map.get(dt_str, adj_val)
            rows.append(
                {
                    "nav_date": dt_str,
                    "nav": round(clean_val, 6),
                    "adj_nav": round(adj_val, 6),
                    "dividend": 0.0,
                }
            )
        if not rows:
            return pd.DataFrame(columns=["nav_date", "nav", "adj_nav", "dividend"])
        return (
            pd.DataFrame(rows)
            .drop_duplicates(subset=["nav_date"], keep="last")
            .sort_values("nav_date")
            .reset_index(drop=True)
        )
    finally:
        if own_client:
            http.close()


def fetch_tencent_batch(
    cn_codes: list[str],
    years: int = 5,
    pause_seconds: float = 0.25,
) -> tuple[dict[str, pd.DataFrame], dict[str, str]]:
    unique_codes = list(dict.fromkeys(c.strip() for c in cn_codes if c and c.strip()))
    results: dict[str, pd.DataFrame] = {}
    errors: dict[str, str] = {}

    with httpx.Client(timeout=20.0, headers=TENCENT_HEADERS) as client:
        for i, code in enumerate(unique_codes):
            try:
                df = fetch_tencent_etf_series(code, years=years, client=client)
                if not df.empty:
                    results[code] = df
                else:
                    errors[code] = "empty_series"
            except CircuitOpenError:
                raise
            except Exception as exc:
                errors[code] = str(exc)[:200]
            if i + 1 < len(unique_codes) and pause_seconds > 0:
                time.sleep(pause_seconds)

    return results, errors
