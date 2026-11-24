from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Any

import pandas as pd
import yfinance as yf

from wonder_quant.fetchers import CircuitOpenError


def _extract_ticker_frame(df: pd.DataFrame, ticker: str, single_mode: bool) -> pd.DataFrame | None:
    if df is None or df.empty:
        return None
    if not isinstance(df.columns, pd.MultiIndex):
        return df
    # yfinance >= 1.0 returns MultiIndex (Price, Ticker) or (Ticker, Price) depending on group_by
    if ticker in df.columns.get_level_values(0):
        return df[ticker]
    if ticker in df.columns.get_level_values(-1):
        return df.xs(ticker, axis=1, level=-1)
    if single_mode:
        out = df.copy()
        out.columns = [c[0] if isinstance(c, tuple) else c for c in out.columns]
        return out
    return None


def fetch_yahoo_batch(
    tickers: list[str],
    start_date: str | None = None,
    years: int = 5,
    batch_size: int = 25,
    pause_seconds: float = 1.2,
) -> tuple[dict[str, pd.DataFrame], dict[str, str]]:
    """
    Fetch Close, Adj Close, and Dividends via yfinance (curl_cffi Chrome impersonation).
    Returns (ticker -> DataFrame[nav_date, nav, adj_nav, dividend], errors).
    Raises CircuitOpenError immediately if HTTP 401/403/429 rate-limit text is detected (R6).
    """
    unique_tickers = list(dict.fromkeys(t.strip() for t in tickers if t and t.strip()))
    if not unique_tickers:
        return {}, {}

    start = start_date or (date.today() - timedelta(days=years * 366 + 15)).isoformat()
    results: dict[str, pd.DataFrame] = {}
    errors: dict[str, str] = {}

    for idx in range(0, len(unique_tickers), batch_size):
        chunk = unique_tickers[idx : idx + batch_size]
        single_mode = len(chunk) == 1
        try:
            raw = yf.download(
                tickers=chunk if not single_mode else chunk[0],
                start=start,
                interval="1d",
                auto_adjust=False,
                actions=True,
                group_by="ticker",
                progress=False,
                threads=False,
            )
        except Exception as exc:
            msg = str(exc)
            if any(code in msg for code in ("429", "Too Many Requests", "403", "401", "Unauthorized")):
                raise CircuitOpenError("yfinance", 429 if "429" in msg else 403, msg[:250]) from exc
            for t in chunk:
                errors[t] = msg[:200]
            continue

        for t in chunk:
            sub = _extract_ticker_frame(raw, t, single_mode=single_mode)
            if sub is None or sub.empty:
                errors[t] = "empty_series"
                continue
            close_col = "Close" if "Close" in sub.columns else None
            adj_col = "Adj Close" if "Adj Close" in sub.columns else close_col
            div_col = "Dividends" if "Dividends" in sub.columns else None
            if not close_col:
                errors[t] = "missing_close_column"
                continue

            rows: list[dict[str, Any]] = []
            for ts, row in sub.iterrows():
                close_v = row.get(close_col)
                adj_v = row.get(adj_col) if adj_col else close_v
                div_v = row.get(div_col, 0.0) if div_col else 0.0
                if pd.isna(close_v) or float(close_v) <= 0:
                    continue
                c_val = float(close_v)
                a_val = float(adj_v) if (adj_v is not None and not pd.isna(adj_v) and float(adj_v) > 0) else c_val
                d_val = float(div_v) if (div_v is not None and not pd.isna(div_v) and float(div_v) > 0) else 0.0
                dt_str = pd.Timestamp(ts).strftime("%Y-%m-%d")
                rows.append({"nav_date": dt_str, "nav": round(c_val, 6), "adj_nav": round(a_val, 6), "dividend": round(d_val, 6)})

            if rows:
                out_df = pd.DataFrame(rows).drop_duplicates(subset=["nav_date"], keep="last").sort_values("nav_date")
                results[t] = out_df.reset_index(drop=True)
            else:
                errors[t] = "no_valid_points"

        if idx + batch_size < len(unique_tickers) and pause_seconds > 0:
            time.sleep(pause_seconds)

    return results, errors
