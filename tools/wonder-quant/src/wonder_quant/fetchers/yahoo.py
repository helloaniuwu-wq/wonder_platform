from __future__ import annotations

import random
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


def _median(vals: list[float]) -> float | None:
    if not vals:
        return None
    s = sorted(vals)
    m = len(s) // 2
    if len(s) % 2 == 1:
        return float(s[m])
    return float((s[m - 1] + s[m]) / 2.0)


def sanitize_yahoo_series_df(df: pd.DataFrame, ticker: str = "") -> pd.DataFrame:
    """Clean Yahoo Finance / market ETF NAV series against known data defects:

    1. 100x minor/major currency-regime flips (e.g. LSE GBp/GBP alternating on .L tickers).
    2. 1-5 bar transient split/bad-print glitches (ratio > 4.0 or < 0.25 vs surrounding bars).
    3. Corrupted dividend entries (e.g. GBp dividend reported on GBP NAV -> div / 100; > 25% dropped).
    """
    if df is None or df.empty or "nav" not in df.columns:
        return df

    work = df.copy()
    work["nav_date"] = work["nav_date"].astype(str)
    work = work.drop_duplicates(subset=["nav_date"], keep="last").sort_values("nav_date").reset_index(drop=True)

    n = len(work)
    if n < 3:
        return work

    nav = work["nav"].astype(float).tolist()
    adj = work["adj_nav"].astype(float).tolist() if "adj_nav" in work.columns else list(nav)
    div = work["dividend"].astype(float).fillna(0.0).tolist() if "dividend" in work.columns else [0.0] * n

    # Step 1: Normalize 100x currency-regime flips anchored to the most recent terminal window
    tail_vals = [v for v in nav[-min(10, n) :] if v and v > 0]
    anchor = _median(tail_vals)
    if anchor and anchor > 0:
        for i in range(n):
            v = nav[i]
            if v <= 0:
                continue
            ratio = v / anchor
            if 50.0 <= ratio <= 200.0:
                scale = 0.01
            elif 0.005 <= ratio <= 0.02:
                scale = 100.0
            else:
                scale = 1.0
            if scale != 1.0:
                nav[i] = round(nav[i] * scale, 6)
                adj[i] = round(adj[i] * scale, 6)
                if div[i] > 0:
                    if scale == 0.01 and (div[i] / nav[i]) > 0.20:
                        div[i] = round(div[i] * scale, 6)
                    elif scale == 100.0 and (div[i] * 100.0) / nav[i] <= 0.15 and (div[i] / v) <= 0.15:
                        div[i] = round(div[i] * scale, 6)

    # Step 2: Repair 1..5 bar transient glitches (longest block first; endpoints must match baseline)
    for k in range(min(5, max(1, n - 4)), 0, -1):
        i = 2
        while i <= n - k - 2:
            pre = [x for x in nav[max(0, i - 3) : i] if x > 0]
            post = [x for x in nav[i + k : min(n, i + k + 3)] if x > 0]
            pre_med = _median(pre)
            post_med = _median(post)
            if pre_med and post_med and pre_med > 0 and post_med > 0:
                neighbor_drift = pre_med / post_med
                baseline = 0.5 * (pre_med + post_med)
                left_nav, right_nav = nav[i - 1], nav[i + k]
                endpoints_clean = (
                    0.65 <= neighbor_drift <= 1.54
                    and left_nav > 0
                    and right_nav > 0
                    and 0.65 <= (left_nav / baseline) <= 1.54
                    and 0.65 <= (right_nav / baseline) <= 1.54
                )
                if endpoints_clean:
                    all_glitched = all(
                        (nav[j] / baseline > 2.5) or (nav[j] / baseline < 0.4)
                        for j in range(i, i + k)
                        if nav[j] > 0
                    )
                    if all_glitched and any(nav[j] > 0 for j in range(i, i + k)):
                        left_adj, right_adj = adj[i - 1], adj[i + k]
                        span = k + 1
                        for step_idx in range(k):
                            j = i + step_idx
                            frac = (step_idx + 1) / span
                            nav[j] = round(left_nav + (right_nav - left_nav) * frac, 6)
                            adj[j] = round(left_adj + (right_adj - left_adj) * frac, 6)
                        i += k
                        continue
            i += 1

    # Step 3: Guard against single-bar minor-unit dividends on major-unit NAV (e.g. GBp div on GBP NAV)
    for i in range(n):
        if div[i] <= 0 or nav[i] <= 0:
            continue
        single_yield = div[i] / nav[i]
        if single_yield > 0.20:
            if (div[i] / 100.0) / nav[i] <= 0.15:
                div[i] = round(div[i] / 100.0, 6)
            elif single_yield > 0.25:
                div[i] = 0.0

    work["nav"] = nav
    work["adj_nav"] = adj
    work["dividend"] = div
    return work


def fetch_yahoo_batch(
    tickers: list[str],
    start_date: str | None = None,
    years: int = 15,
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
    is_deep_backfill = start_date is None and years > 2
    eff_batch_size = min(batch_size, 12) if is_deep_backfill else batch_size
    eff_pause = max(pause_seconds, 2.4) if is_deep_backfill else pause_seconds
    results: dict[str, pd.DataFrame] = {}
    errors: dict[str, str] = {}

    for idx in range(0, len(unique_tickers), eff_batch_size):
        chunk = unique_tickers[idx : idx + eff_batch_size]
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
                results[t] = sanitize_yahoo_series_df(out_df.reset_index(drop=True), ticker=t)
            else:
                errors[t] = "no_valid_points"

        if idx + eff_batch_size < len(unique_tickers) and eff_pause > 0:
            jitter = random.uniform(0.3, 0.9) if is_deep_backfill else 0.0
            time.sleep(eff_pause + jitter)

    return results, errors
