from __future__ import annotations

import math
from typing import Any

import pandas as pd
import yfinance as yf

from wonder_quant.config import now_hkt
from wonder_quant.fetchers.yahoo import fetch_yahoo_batch
from wonder_quant.models import MacroSnapshot

MACRO_TICKERS: dict[str, str] = {
    "us10y": "^TNX",
    "us3m": "^IRX",
    "us5y": "^FVX",
    "spy": "SPY",
    "qqq": "QQQ",
    "hsi": "2800.HK",
    "gold": "GC=F",
    "gld": "GLD",
    "wti": "CL=F",
    "brent": "BZ=F",
    "copper": "HG=F",
    "dbc": "DBC",
    "dxy": "DX-Y.NYB",
    "hyg": "HYG",
    "ief": "IEF",
}

# 5-year historical trailing PE baseline statistics (mean, std) calibrated from Shiller/HSI series
# Used with live trailingPE overrides or trend-based valuation proxy when free APIs omit daily PE history.
VALUATION_BASELINES: dict[str, dict[str, float]] = {
    "SPY": {"pe_mean": 22.5, "pe_std": 3.4, "ref_pe": 25.5},
    "HSI": {"pe_mean": 10.4, "pe_std": 1.6, "ref_pe": 9.8},
}


def _norm_cdf_pctile(z: float) -> float:
    """Approximate standard normal CDF in 0-100 percentile scale."""
    cdf = 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))
    return round(max(1.0, min(99.0, cdf * 100.0)), 1)


def compute_valuation_percentile(
    df: pd.DataFrame | None,
    baseline_key: str,
    live_pe: float | None = None,
) -> tuple[float | None, float | None]:
    """
    Estimate trailing PE & 5Y historical percentile.
    Uses live trailingPE when available, otherwise anchors PE via price distance to 200D trend.
    """
    cfg = VALUATION_BASELINES.get(baseline_key, {"pe_mean": 20.0, "pe_std": 3.0, "ref_pe": 20.0})
    est_pe: float | None = float(live_pe) if (live_pe is not None and live_pe > 0) else None

    if est_pe is None and df is not None and not df.empty:
        closes = df["nav"].dropna().astype(float)
        if len(closes) >= 20:
            latest = float(closes.iloc[-1])
            ma200 = float(closes.tail(200).mean())
            ratio = latest / ma200 if ma200 > 0 else 1.0
            est_pe = round(cfg["ref_pe"] * ratio, 2)

    if est_pe is None:
        return None, None

    z = (est_pe - cfg["pe_mean"]) / max(0.5, cfg["pe_std"])
    return round(est_pe, 2), _norm_cdf_pctile(z)


def _latest_val(df: pd.DataFrame | None) -> float | None:
    if df is None or df.empty:
        return None
    s = df["nav"].dropna().astype(float)
    return round(float(s.iloc[-1]), 4) if not s.empty else None


def _ma_diff_pct(df: pd.DataFrame | None, window: int = 200) -> float | None:
    if df is None or df.empty:
        return None
    s = df["nav"].dropna().astype(float)
    if len(s) < min(20, window):
        return None
    latest = float(s.iloc[-1])
    ma = float(s.tail(window).mean())
    if ma <= 0:
        return None
    return round(((latest / ma) - 1.0) * 100.0, 2)


def _ret_n_days(df: pd.DataFrame | None, days: int = 20) -> float | None:
    if df is None or df.empty:
        return None
    s = df["nav"].dropna().astype(float)
    if len(s) <= days:
        return None
    prev = float(s.iloc[-(days + 1)])
    curr = float(s.iloc[-1])
    if prev <= 0:
        return None
    return round(((curr / prev) - 1.0) * 100.0, 2)


def _normalize_yahoo_yield(raw_val: float | None) -> float | None:
    """Yahoo ^TNX / ^IRX / ^FVX quote yield * 10 (e.g., 4.35 -> 4.35, rarely 43.5 -> 4.35)."""
    if raw_val is None:
        return None
    val = float(raw_val)
    if val > 20.0:
        val = val / 10.0
    return round(val, 3)


def compute_macro_snapshot(
    series_map: dict[str, pd.DataFrame],
    as_of_date: str | None = None,
    live_pe_overrides: dict[str, float] | None = None,
) -> MacroSnapshot:
    """
    Pure computation of daily macro, rates, equity valuation, gold, oil & commodity regime indicators.
    Keys in series_map should match Yahoo tickers in MACRO_TICKERS.
    """
    overrides = live_pe_overrides or {}
    date_str = as_of_date or now_hkt().strftime("%Y-%m-%d")

    df_10y = series_map.get("^TNX")
    df_3m = series_map.get("^IRX")
    df_5y = series_map.get("^FVX")
    df_spy = series_map.get("SPY")
    df_hsi = series_map.get("2800.HK")
    df_gold = series_map.get("GC=F") if series_map.get("GC=F") is not None else series_map.get("GLD")
    df_wti = series_map.get("CL=F")
    df_brent = series_map.get("BZ=F")
    df_copper = series_map.get("HG=F")
    df_dbc = series_map.get("DBC")
    df_dxy = series_map.get("DX-Y.NYB")
    df_hyg = series_map.get("HYG")
    df_ief = series_map.get("IEF")

    # Determine latest common valuation date from primary US series if present
    if as_of_date is None:
        cand_dates: list[str] = []
        for df in (df_spy, df_gold, df_10y):
            if df is not None and not df.empty:
                cand_dates.append(str(df["nav_date"].iloc[-1])[:10])
        if cand_dates:
            date_str = max(cand_dates)

    us10y = _normalize_yahoo_yield(_latest_val(df_10y))
    us3m = _normalize_yahoo_yield(_latest_val(df_3m))
    us5y = _normalize_yahoo_yield(_latest_val(df_5y))
    curve_10y_3m = round(us10y - us3m, 3) if (us10y is not None and us3m is not None) else None

    spy_pe_est, spy_pe_pctile = compute_valuation_percentile(df_spy, "SPY", overrides.get("SPY"))
    spy_erp: float | None = None
    if spy_pe_est and spy_pe_est > 0 and us10y is not None:
        spy_erp = round((100.0 / spy_pe_est) - us10y, 2)

    _, hsi_pe_pctile = compute_valuation_percentile(df_hsi, "HSI", overrides.get("2800.HK"))

    gold_price = _latest_val(df_gold)
    gold_ma200_pct = _ma_diff_pct(df_gold, 200)

    wti_price = _latest_val(df_wti)
    brent_price = _latest_val(df_brent)
    oil_ret_20d = _ret_n_days(df_wti if df_wti is not None else df_brent, 20)

    copper_price = _latest_val(df_copper)
    copper_gold_ratio: float | None = None
    copper_gold_trend: str = "NEUTRAL"

    if copper_price is not None and gold_price is not None and gold_price > 0:
        copper_gold_ratio = round((copper_price / gold_price) * 1000.0, 4)

    if df_copper is not None and df_gold is not None and not df_copper.empty and not df_gold.empty:
        c_s = df_copper.set_index("nav_date")["nav"].astype(float)
        g_s = df_gold.set_index("nav_date")["nav"].astype(float)
        joined = pd.concat([c_s.rename("cu"), g_s.rename("au")], axis=1).dropna()
        if len(joined) >= 60:
            ratio_series = (joined["cu"] / joined["au"]) * 1000.0
            ma50 = float(ratio_series.tail(50).mean())
            ma200 = float(ratio_series.tail(200).mean())
            if ma200 > 0:
                rel = (ma50 / ma200) - 1.0
                if rel >= 0.03:
                    copper_gold_trend = "RISING"
                elif rel <= -0.03:
                    copper_gold_trend = "FALLING"

    dbc_price = _latest_val(df_dbc)
    dbc_ret_20d = _ret_n_days(df_dbc, 20)
    dxy_index = _latest_val(df_dxy)

    hyg_ief_ratio: float | None = None
    credit_stress = False
    if df_hyg is not None and df_ief is not None and not df_hyg.empty and not df_ief.empty:
        h_s = df_hyg.set_index("nav_date")["nav"].astype(float)
        i_s = df_ief.set_index("nav_date")["nav"].astype(float)
        j_cred = pd.concat([h_s.rename("hyg"), i_s.rename("ief")], axis=1).dropna()
        if not j_cred.empty:
            ratio_cred = j_cred["hyg"] / j_cred["ief"]
            hyg_ief_ratio = round(float(ratio_cred.iloc[-1]), 4)
            if len(ratio_cred) >= 30:
                ma60 = float(ratio_cred.tail(60).mean())
                if ma60 > 0 and (hyg_ief_ratio / ma60 - 1.0) <= -0.03:
                    credit_stress = True

    flags: list[str] = []
    if us10y is not None and us10y >= 4.5:
        flags.append("RATES_ELEVATED")
    if curve_10y_3m is not None and curve_10y_3m < 0:
        flags.append("CURVE_INVERTED")
    if (spy_pe_pctile is not None and spy_pe_pctile >= 80.0) or (spy_erp is not None and spy_erp <= 0.5):
        flags.append("US_VALUATION_ELEVATED")
    if hsi_pe_pctile is not None and hsi_pe_pctile <= 25.0:
        flags.append("HK_DEEP_VALUE")
    if gold_ma200_pct is not None and gold_ma200_pct >= 12.0:
        flags.append("GOLD_BREAKOUT")
    if (oil_ret_20d is not None and oil_ret_20d >= 15.0) or (wti_price is not None and wti_price >= 90.0):
        flags.append("OIL_INFLATION_SHOCK")
    if copper_gold_trend == "FALLING":
        flags.append("COPPER_GOLD_RISK_OFF")
    if credit_stress:
        flags.append("CREDIT_STRESS")

    return MacroSnapshot(
        as_of_date=date_str,
        us10y_yield=us10y,
        us3m_yield=us3m,
        us5y_yield=us5y,
        yield_curve_10y_3m=curve_10y_3m,
        spy_pe_est=spy_pe_est,
        spy_pe_pctile=spy_pe_pctile,
        spy_erp=spy_erp,
        hsi_pe_pctile=hsi_pe_pctile,
        gold_price=gold_price,
        gold_ma200_pct=gold_ma200_pct,
        wti_oil_price=wti_price,
        brent_oil_price=brent_price,
        oil_ret_20d=oil_ret_20d,
        copper_price=copper_price,
        copper_gold_ratio=copper_gold_ratio,
        copper_gold_trend=copper_gold_trend,  # type: ignore[arg-type]
        dbc_price=dbc_price,
        dxy_index=dxy_index,
        hyg_ief_ratio=hyg_ief_ratio,
        regime_flags=flags,
        indicators={
            "qqq_price": _latest_val(series_map.get("QQQ")),
            "qqq_ret_20d": _ret_n_days(series_map.get("QQQ"), 20),
            "gld_price": _latest_val(series_map.get("GLD")),
            "dbc_ret_20d": dbc_ret_20d,
        },
    )


def fetch_macro_snapshot(years: int = 2) -> tuple[MacroSnapshot, dict[str, str]]:
    """Fetch macro, rate, equity, and commodity tickers via Yahoo Finance and compute snapshot."""
    tickers = list(dict.fromkeys(MACRO_TICKERS.values()))
    series_map, errors = fetch_yahoo_batch(tickers, years=years, batch_size=20)

    live_pe_overrides: dict[str, float] = {}
    for sym in ("SPY", "2800.HK"):
        try:
            info: dict[str, Any] = yf.Ticker(sym).info or {}
            pe = info.get("trailingPE")
            if isinstance(pe, (int, float)) and pe > 0:
                live_pe_overrides[sym] = float(pe)
        except Exception:
            pass

    snapshot = compute_macro_snapshot(series_map, live_pe_overrides=live_pe_overrides)
    return snapshot, errors
