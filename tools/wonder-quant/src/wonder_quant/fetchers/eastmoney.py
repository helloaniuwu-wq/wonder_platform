from __future__ import annotations

import time
from datetime import date, timedelta

import pandas as pd

from wonder_quant.fetchers import CircuitOpenError


def fetch_eastmoney_open_fund(fund_code: str, years: int = 5) -> pd.DataFrame:
    """
    Fetch CN open-end mutual fund unit NAV & cumulative NAV via AkShare (EastMoney backend).
    Returns DataFrame[nav_date, nav, adj_nav, dividend].
    """
    import akshare as ak

    cutoff = (date.today() - timedelta(days=years * 366 + 15)).isoformat()
    try:
        unit_df = ak.fund_open_fund_info_em(symbol=fund_code, indicator="单位净值走势")
        cum_df = ak.fund_open_fund_info_em(symbol=fund_code, indicator="累计净值走势")
    except Exception as exc:
        msg = str(exc)
        if any(k in msg for k in ("403", "429", "Too Many Requests")):
            raise CircuitOpenError("eastmoney_open", 429 if "429" in msg else 403, msg[:200]) from exc
        raise

    if unit_df is None or unit_df.empty:
        return pd.DataFrame(columns=["nav_date", "nav", "adj_nav", "dividend"])

    u = unit_df.rename(columns={"净值日期": "nav_date", "单位净值": "nav"})[["nav_date", "nav"]].copy()
    u["nav_date"] = pd.to_datetime(u["nav_date"]).dt.strftime("%Y-%m-%d")
    u["nav"] = pd.to_numeric(u["nav"], errors="coerce")

    if cum_df is not None and not cum_df.empty:
        c = cum_df.rename(columns={"净值日期": "nav_date", "累计净值": "adj_nav"})[["nav_date", "adj_nav"]].copy()
        c["nav_date"] = pd.to_datetime(c["nav_date"]).dt.strftime("%Y-%m-%d")
        c["adj_nav"] = pd.to_numeric(c["adj_nav"], errors="coerce")
        merged = pd.merge(u, c, on="nav_date", how="left")
        merged["adj_nav"] = merged["adj_nav"].fillna(merged["nav"])
    else:
        merged = u.copy()
        merged["adj_nav"] = merged["nav"]

    merged = merged.dropna(subset=["nav"])
    merged = merged[(merged["nav"] > 0) & (merged["nav_date"] >= cutoff)].copy()
    merged["dividend"] = 0.0
    return (
        merged[["nav_date", "nav", "adj_nav", "dividend"]]
        .drop_duplicates(subset=["nav_date"], keep="last")
        .sort_values("nav_date")
        .reset_index(drop=True)
    )


def fetch_eastmoney_batch(
    fund_codes: list[str],
    years: int = 15,
    pause_seconds: float = 1.2,
) -> tuple[dict[str, pd.DataFrame], dict[str, str]]:
    unique_codes = list(dict.fromkeys(c.strip() for c in fund_codes if c and c.strip()))
    results: dict[str, pd.DataFrame] = {}
    errors: dict[str, str] = {}
    for i, code in enumerate(unique_codes):
        try:
            df = fetch_eastmoney_open_fund(code, years=years)
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
