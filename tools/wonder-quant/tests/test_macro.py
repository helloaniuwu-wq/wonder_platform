from __future__ import annotations

import pandas as pd

from wonder_quant.macro import compute_macro_snapshot


def _make_series(dates: list[str], values: list[float]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "nav_date": dates,
            "nav": values,
            "adj_nav": values,
            "dividend": [0.0] * len(dates),
        }
    )


def test_compute_macro_snapshot_and_commodities():
    dates = pd.bdate_range("2025-01-01", periods=220).strftime("%Y-%m-%d").tolist()
    n = len(dates)

    # Gold rallies sharply at end (>12% above 200D MA -> GOLD_BREAKOUT)
    gold_vals = [2400.0] * (n - 10) + [2850.0] * 10
    # Oil surges >15% in last 20 days (-> OIL_INFLATION_SHOCK)
    oil_vals = [70.0] * (n - 10) + [86.0] * 10
    # Copper weakens while gold strengthens -> falling copper/gold ratio
    copper_vals = [4.6] * (n - 60) + [3.7] * 60

    series_map = {
        "^TNX": _make_series(dates, [4.65] * n),
        "^IRX": _make_series(dates, [4.80] * n),
        "^FVX": _make_series(dates, [4.30] * n),
        "SPY": _make_series(dates, [500.0 + i * 0.5 for i in range(n)]),
        "2800.HK": _make_series(dates, [22.0 - i * 0.02 for i in range(n)]),
        "GC=F": _make_series(dates, gold_vals),
        "CL=F": _make_series(dates, oil_vals),
        "BZ=F": _make_series(dates, [v + 4.0 for v in oil_vals]),
        "HG=F": _make_series(dates, copper_vals),
        "DBC": _make_series(dates, [22.5] * n),
        "DX-Y.NYB": _make_series(dates, [105.5] * n),
        "HYG": _make_series(dates, [80.0] * (n - 10) + [76.0] * 10),
        "IEF": _make_series(dates, [95.0] * n),
    }

    snap = compute_macro_snapshot(series_map, as_of_date=dates[-1], live_pe_overrides={"SPY": 28.0})

    assert snap.as_of_date == dates[-1]
    assert snap.us10y_yield == 4.65
    assert snap.yield_curve_10y_3m == -0.15
    assert snap.spy_pe_est == 28.0
    assert snap.spy_erp is not None and snap.spy_erp < 0
    assert snap.gold_price == 2850.0
    assert snap.gold_ma200_pct is not None and snap.gold_ma200_pct >= 12.0
    assert snap.wti_oil_price == 86.0
    assert snap.oil_ret_20d is not None and snap.oil_ret_20d >= 15.0
    assert snap.copper_gold_trend == "FALLING"

    assert "RATES_ELEVATED" in snap.regime_flags
    assert "CURVE_INVERTED" in snap.regime_flags
    assert "US_VALUATION_ELEVATED" in snap.regime_flags
    assert "GOLD_BREAKOUT" in snap.regime_flags
    assert "OIL_INFLATION_SHOCK" in snap.regime_flags
    assert "COPPER_GOLD_RISK_OFF" in snap.regime_flags
    assert "CREDIT_STRESS" in snap.regime_flags
