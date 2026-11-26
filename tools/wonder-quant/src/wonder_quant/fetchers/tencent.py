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
    years: int = 15,
    client: httpx.Client | None = None,
    start_date: str | None = None,
    chunk_pause_seconds: float = 0.30,
) -> pd.DataFrame:
    """
    Fetch A-share / HK-Connect exchange-traded ETF daily close & backward-adjusted (hfq) total-return close.
    Paginates backwards in ~2Y (730-day) chunks because Tencent caps each request (~640 bars), stopping
    early once the ETF's IPO date is reached.
    """
    end_dt = date.today()
    start_dt = (
        date.fromisoformat(start_date)
        if start_date
        else end_dt - timedelta(days=years * 366 + 15)
    )

    own_client = client is None
    http = client or httpx.Client(timeout=20.0, headers=TENCENT_HEADERS)
    rows: list[dict[str, Any]] = []
    try:
        cur_end = end_dt
        step_days = 720
        while cur_end > start_dt:
            cur_start = max(start_dt, cur_end - timedelta(days=step_days))
            limit = max(320, int((cur_end - cur_start).days * 0.8) + 60)

            # 1. Backward-adjusted (hfq) reflects total return with dividends reinvested
            r_hfq = http.get(
                TENCENT_KLINE_URL,
                params={"param": f"{cn_code},day,{cur_start.isoformat()},{cur_end.isoformat()},{limit},hfq"},
            )
            if r_hfq.status_code in (401, 403, 429):
                raise CircuitOpenError("tencent_hfq", r_hfq.status_code, r_hfq.text[:200])
            r_hfq.raise_for_status()
            d_hfq = r_hfq.json()
            node = (d_hfq.get("data") or {}).get(cn_code) or {}
            hfq_arr = node.get("hfqday") or node.get("qfqday") or node.get("day") or []
            if not hfq_arr:
                break

            # 2. Unadjusted daily close (for clean display NAV)
            r_raw = http.get(
                TENCENT_KLINE_URL,
                params={"param": f"{cn_code},day,{cur_start.isoformat()},{cur_end.isoformat()},{limit},"},
            )
            if r_raw.status_code in (401, 403, 429):
                raise CircuitOpenError("tencent_hfq", r_raw.status_code, r_raw.text[:200])
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

            earliest_in_chunk: date | None = None
            for rec in hfq_arr:
                if len(rec) < 3:
                    continue
                dt_str = str(rec[0])[:10]
                try:
                    rec_dt = date.fromisoformat(dt_str)
                    if earliest_in_chunk is None or rec_dt < earliest_in_chunk:
                        earliest_in_chunk = rec_dt
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

            # Stop early when ETF inception date was reached (earliest bar > cur_start + 45d)
            if earliest_in_chunk is None or (earliest_in_chunk - cur_start).days > 45:
                break
            cur_end = cur_start - timedelta(days=1)
            if cur_end > start_dt and chunk_pause_seconds > 0:
                time.sleep(chunk_pause_seconds)

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
    years: int = 15,
    pause_seconds: float = 0.40,
    start_date: str | None = None,
) -> tuple[dict[str, pd.DataFrame], dict[str, str]]:
    unique_codes = list(dict.fromkeys(c.strip() for c in cn_codes if c and c.strip()))
    results: dict[str, pd.DataFrame] = {}
    errors: dict[str, str] = {}

    with httpx.Client(timeout=20.0, headers=TENCENT_HEADERS) as client:
        for i, code in enumerate(unique_codes):
            try:
                df = fetch_tencent_etf_series(code, years=years, client=client, start_date=start_date)
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
