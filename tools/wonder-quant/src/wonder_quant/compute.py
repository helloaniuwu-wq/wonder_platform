from __future__ import annotations

import math
from datetime import timedelta

import numpy as np
import pandas as pd

from wonder_quant.config import now_hkt
from wonder_quant.models import DataTier, FundMetrics, FundRecord

TRADING_DAYS_PER_YEAR = 252.0


def _round_opt(val: float | None, digits: int = 4) -> float | None:
    if val is None or not math.isfinite(val):
        return None
    return round(float(val), digits)


def _window_return(dates: pd.Series, adj: pd.Series, days_back: int, annualize: bool = False) -> float | None:
    if len(adj) < 2:
        return None
    end_dt = dates.iloc[-1]
    target_dt = end_dt - timedelta(days=days_back)
    # Must have data reaching reasonably close to target window (at least 85% of lookback span)
    first_dt = dates.iloc[0]
    if (end_dt - first_dt).days < int(days_back * 0.85):
        return None
    idx = int(dates.searchsorted(target_dt, side="left"))
    idx = min(max(idx, 0), len(adj) - 2)
    start_val = float(adj.iloc[idx])
    end_val = float(adj.iloc[-1])
    if start_val <= 0 or end_val <= 0:
        return None
    total_ret = end_val / start_val - 1.0
    if not annualize:
        return total_ret
    actual_years = max((end_dt - dates.iloc[idx]).days / 365.25, 0.5)
    if 1.0 + total_ret <= 0:
        return -1.0
    return (1.0 + total_ret) ** (1.0 / actual_years) - 1.0


def _ytd_return(dates: pd.Series, adj: pd.Series) -> float | None:
    if len(adj) < 2:
        return None
    end_dt = dates.iloc[-1]
    year_start = pd.Timestamp(year=end_dt.year, month=1, day=1)
    before = dates[dates < year_start]
    if len(before) > 0:
        start_val = float(adj.iloc[before.index[-1]])
    else:
        # Use earliest point in current year if fund launched mid-year (only if within first 15 days)
        if (dates.iloc[0] - year_start).days > 15:
            return None
        start_val = float(adj.iloc[0])
    end_val = float(adj.iloc[-1])
    if start_val <= 0 or end_val <= 0:
        return None
    return end_val / start_val - 1.0


def _max_drawdown_and_recovery(
    dates: pd.Series, adj: pd.Series, days_back: int | None = None
) -> tuple[float | None, int | None]:
    if len(adj) < 5:
        return None, None
    if days_back is not None:
        cutoff = dates.iloc[-1] - timedelta(days=days_back)
        if (dates.iloc[-1] - dates.iloc[0]).days < int(days_back * 0.80):
            return None, None
        mask = dates >= cutoff
        sub_dates = dates[mask].reset_index(drop=True)
        sub_adj = adj[mask].reset_index(drop=True)
    else:
        sub_dates = dates.reset_index(drop=True)
        sub_adj = adj.reset_index(drop=True)

    if len(sub_adj) < 5:
        return None, None

    vals = sub_adj.to_numpy(dtype=float)
    running_max = np.maximum.accumulate(vals)
    dd = vals / running_max - 1.0
    trough_idx = int(np.argmin(dd))
    max_dd = float(dd[trough_idx])
    peak_val = float(running_max[trough_idx])
    peak_idx = int(np.argmax(vals[: trough_idx + 1]))

    # Recovery days: first index after trough reaching >= peak_val
    recovery_days: int | None = None
    after = vals[trough_idx + 1 :]
    rec_positions = np.where(after >= peak_val * 0.9999)[0]
    if len(rec_positions) > 0:
        rec_idx = trough_idx + 1 + int(rec_positions[0])
        recovery_days = int((sub_dates.iloc[rec_idx] - sub_dates.iloc[peak_idx]).days)
    return max_dd, recovery_days


def _compute_single_fund_metrics(
    fund: FundRecord,
    df: pd.DataFrame | None,
    bench_df: pd.DataFrame | None,
    as_of_date: str,
    risk_free_rate: float = 0.04,
    anomaly_threshold: float = 0.15,
) -> FundMetrics:
    now_iso = now_hkt().isoformat(timespec="seconds")
    if df is None or df.empty:
        return FundMetrics(
            slug=fund.slug,
            as_of_date=as_of_date,
            latest_nav_currency=fund.currency,
            obs_days=0,
            data_tier="U",
            anomalies=["no_nav_series"],
            computed_at=now_iso,
        )

    work = df.copy()
    work["dt"] = pd.to_datetime(work["nav_date"])
    work = work.dropna(subset=["dt", "nav", "adj_nav"]).sort_values("dt").drop_duplicates(subset=["dt"], keep="last")
    work = work[(work["nav"] > 0) & (work["adj_nav"] > 0)].reset_index(drop=True)

    obs_days = len(work)
    if obs_days == 0:
        return FundMetrics(
            slug=fund.slug,
            as_of_date=as_of_date,
            latest_nav_currency=fund.currency,
            obs_days=0,
            data_tier="U",
            anomalies=["no_valid_nav_points"],
            computed_at=now_iso,
        )

    dates = work["dt"]
    adj = work["adj_nav"].astype(float)
    nav = work["nav"].astype(float)
    divs = work["dividend"].astype(float) if "dividend" in work.columns else pd.Series(0.0, index=work.index)
    val_date = dates.iloc[-1].strftime("%Y-%m-%d")
    latest_nav = float(nav.iloc[-1])

    # Determine actual data tier based on series_type and length
    series_types = set(work["series_type"].dropna().astype(str)) if "series_type" in work.columns else set()
    if obs_days < 60:
        tier: DataTier = "C"
    elif "proxy_underlying" in series_types or fund.primary_source == "aia_fundinfo2":
        tier = "B" if obs_days >= 180 else "C"
    elif "manual_csv" in series_types:
        tier = "B"
    else:
        tier = "A" if obs_days >= 180 else "C"

    anomalies: list[str] = []
    # Check daily returns for abnormal single-day moves (>15%)
    daily_rets = adj.pct_change().dropna()
    if len(daily_rets) > 0:
        recent_tail = daily_rets.iloc[-5:]
        max_recent = float(recent_tail.abs().max())
        if max_recent > anomaly_threshold:
            bad_pos = recent_tail.abs().idxmax()
            bad_dt = dates.iloc[bad_pos].strftime("%Y-%m-%d")
            anomalies.append(f"daily_jump:{bad_dt}:{daily_rets.iloc[bad_pos - 1 if bad_pos == len(daily_rets) else bad_pos]:+.2%}")

    ret_1m = _window_return(dates, adj, 30, annualize=False)
    ret_3m = _window_return(dates, adj, 91, annualize=False)
    ret_6m = _window_return(dates, adj, 182, annualize=False)
    ret_ytd = _ytd_return(dates, adj)
    ret_1y = _window_return(dates, adj, 365, annualize=False)
    ret_3y_ann = _window_return(dates, adj, 365 * 3, annualize=True)
    ret_5y_ann = _window_return(dates, adj, 365 * 5, annualize=True)

    # Volatility (1Y and 3Y, falling back to full window if >= 120 obs for 3Y metrics)
    def _ann_vol(days_back: int) -> float | None:
        cutoff = dates.iloc[-1] - timedelta(days=days_back)
        if (dates.iloc[-1] - dates.iloc[0]).days < int(days_back * 0.80):
            return None
        sub = adj[dates >= cutoff].pct_change().dropna()
        if len(sub) < 20:
            return None
        return float(sub.std(ddof=1) * math.sqrt(TRADING_DAYS_PER_YEAR))

    vol_1y = _ann_vol(365)
    vol_3y = _ann_vol(365 * 3)

    max_dd_1y, _ = _max_drawdown_and_recovery(dates, adj, 365)
    max_dd_3y, dd_rec_3y = _max_drawdown_and_recovery(dates, adj, 365 * 3)
    max_dd_5y, dd_rec_5y = _max_drawdown_and_recovery(dates, adj, 365 * 5)
    dd_recovery_days = dd_rec_3y if dd_rec_3y is not None else dd_rec_5y

    # Risk-adjusted ratios (prefer 3Y window; fall back to 1Y when fund is 1-3Y old)
    ratio_ret = ret_3y_ann if ret_3y_ann is not None else ret_1y
    ratio_vol = vol_3y if vol_3y is not None else vol_1y
    ratio_dd = max_dd_3y if max_dd_3y is not None else max_dd_1y

    sharpe_3y: float | None = None
    if ratio_ret is not None and ratio_vol is not None and ratio_vol > 1e-6:
        sharpe_3y = (ratio_ret - risk_free_rate) / ratio_vol

    calmar_3y: float | None = None
    if ratio_ret is not None and ratio_dd is not None and abs(ratio_dd) > 1e-6:
        calmar_3y = ratio_ret / abs(ratio_dd)

    # Downside deviation & Sortino
    sortino_3y: float | None = None
    ratio_days = 365 * 3 if ret_3y_ann is not None else 365
    if ratio_ret is not None:
        cutoff = dates.iloc[-1] - timedelta(days=ratio_days)
        sub_rets = adj[dates >= cutoff].pct_change().dropna()
        if len(sub_rets) >= 20:
            rf_daily = risk_free_rate / TRADING_DAYS_PER_YEAR
            downside = np.minimum(0.0, sub_rets.to_numpy(dtype=float) - rf_daily)
            downside_vol = float(np.sqrt(np.mean(downside**2)) * math.sqrt(TRADING_DAYS_PER_YEAR))
            if downside_vol > 1e-6:
                sortino_3y = (ratio_ret - risk_free_rate) / downside_vol

    # Benchmark relative metrics (Beta, Alpha, R2, IR) over 3Y (or 1Y fallback)
    beta_3y = alpha_3y = r2_3y = ir_3y = None
    if bench_df is not None and not bench_df.empty and obs_days >= 60:
        b = bench_df.copy()
        b["dt"] = pd.to_datetime(b["nav_date"])
        b = b.dropna(subset=["dt", "adj_close"]).sort_values("dt").drop_duplicates(subset=["dt"], keep="last")
        cutoff = dates.iloc[-1] - timedelta(days=365 * 3)
        f_sub = work[work["dt"] >= cutoff][["dt", "adj_nav"]].rename(columns={"adj_nav": "f"})
        b_sub = b[b["dt"] >= cutoff][["dt", "adj_close"]].rename(columns={"adj_close": "b"})
        aligned = pd.merge(f_sub, b_sub, on="dt", how="inner").sort_values("dt")
        if len(aligned) >= 60:
            fr = aligned["f"].pct_change().dropna().to_numpy(dtype=float)
            br = aligned["b"].pct_change().dropna().to_numpy(dtype=float)
            var_b = float(np.var(br, ddof=1))
            if var_b > 1e-12:
                cov_fb = float(np.cov(fr, br, ddof=1)[0, 1])
                beta_3y = cov_fb / var_b
                corr = float(np.corrcoef(fr, br)[0, 1]) if float(np.var(fr, ddof=1)) > 1e-12 else 0.0
                r2_3y = corr * corr
                rf_d = risk_free_rate / TRADING_DAYS_PER_YEAR
                # Jensen's Alpha (annualized)
                alpha_3y = float((np.mean(fr) - rf_d - beta_3y * (np.mean(br) - rf_d)) * TRADING_DAYS_PER_YEAR)
                active = fr - br
                te = float(np.std(active, ddof=1) * math.sqrt(TRADING_DAYS_PER_YEAR))
                if te > 1e-6:
                    ir_3y = float((np.mean(active) * TRADING_DAYS_PER_YEAR) / te)

    # TTM dividend yield
    div_yield_ttm: float | None = None
    one_year_ago = dates.iloc[-1] - timedelta(days=365)
    ttm_div_sum = float(divs[dates >= one_year_ago].sum())
    if ttm_div_sum > 0 and latest_nav > 0:
        div_yield_ttm = min(0.30, ttm_div_sum / latest_nav)
    elif fund.snapshot_yield_pct is not None and fund.snapshot_yield_pct > 0:
        div_yield_ttm = min(0.30, fund.snapshot_yield_pct / 100.0)
    else:
        div_yield_ttm = 0.0

    return FundMetrics(
        slug=fund.slug,
        as_of_date=as_of_date,
        valuation_date=val_date,
        latest_nav=_round_opt(latest_nav, 6),
        latest_nav_currency=fund.currency,
        ret_1m=_round_opt(ret_1m),
        ret_3m=_round_opt(ret_3m),
        ret_6m=_round_opt(ret_6m),
        ret_ytd=_round_opt(ret_ytd),
        ret_1y=_round_opt(ret_1y),
        ret_3y_ann=_round_opt(ret_3y_ann),
        ret_5y_ann=_round_opt(ret_5y_ann),
        vol_1y=_round_opt(vol_1y),
        vol_3y=_round_opt(vol_3y),
        max_dd_1y=_round_opt(max_dd_1y),
        max_dd_3y=_round_opt(max_dd_3y),
        max_dd_5y=_round_opt(max_dd_5y),
        dd_recovery_days=dd_recovery_days,
        sharpe_3y=_round_opt(sharpe_3y, 3),
        sortino_3y=_round_opt(sortino_3y, 3),
        calmar_3y=_round_opt(calmar_3y, 3),
        beta_3y=_round_opt(beta_3y, 3),
        alpha_3y=_round_opt(alpha_3y, 4),
        r2_3y=_round_opt(r2_3y, 3),
        ir_3y=_round_opt(ir_3y, 3),
        div_yield_ttm=_round_opt(div_yield_ttm, 4),
        obs_days=obs_days,
        data_tier=tier,
        anomalies=anomalies,
        computed_at=now_iso,
    )


def compute_all_metrics(
    funds: list[FundRecord],
    nav_by_slug: dict[str, pd.DataFrame],
    benchmarks: dict[str, pd.DataFrame],
    as_of_date: str | None = None,
    risk_free_rate: float = 0.04,
    anomaly_threshold: float = 0.15,
) -> list[FundMetrics]:
    """Compute quant metrics across all trackable funds, then assign peer percentile rank & A/B/C/D grade."""
    eff_date = as_of_date or now_hkt().strftime("%Y-%m-%d")
    metrics_list: list[FundMetrics] = []
    fund_map = {f.slug: f for f in funds}

    for f in funds:
        if not f.is_trackable:
            continue
        m = _compute_single_fund_metrics(
            fund=f,
            df=nav_by_slug.get(f.slug),
            bench_df=benchmarks.get(f.benchmark_code),
            as_of_date=eff_date,
            risk_free_rate=risk_free_rate,
            anomaly_threshold=anomaly_threshold,
        )
        metrics_list.append(m)

    # Peer percentile ranking & composite Quant Score (0-100) within each asset_class
    by_class: dict[str, list[FundMetrics]] = {}
    for m in metrics_list:
        ac = fund_map[m.slug].asset_class
        by_class.setdefault(ac, []).append(m)

    def _pct_ranks(vals: list[tuple[str, float]], higher_is_better: bool = True) -> dict[str, float]:
        if not vals:
            return {}
        if len(vals) == 1:
            return {vals[0][0]: 0.5}
        ordered = sorted(vals, key=lambda kv: kv[1], reverse=not higher_is_better)
        n = len(ordered)
        return {slug: i / (n - 1) for i, (slug, _) in enumerate(ordered)}

    for group in by_class.values():
        sharpe_ranks = _pct_ranks([(m.slug, m.sharpe_3y) for m in group if m.sharpe_3y is not None], True)
        ret_ranks = _pct_ranks(
            [(m.slug, m.ret_3y_ann if m.ret_3y_ann is not None else m.ret_1y) for m in group if (m.ret_3y_ann is not None or m.ret_1y is not None)],
            True,
        )
        dd_ranks = _pct_ranks(
            [(m.slug, m.max_dd_3y if m.max_dd_3y is not None else m.max_dd_1y) for m in group if (m.max_dd_3y is not None or m.max_dd_1y is not None)],
            True,  # less negative (-0.05 > -0.30) is better
        )
        fee_ranks = _pct_ranks(
            [(m.slug, fund_map[m.slug].fee_pct) for m in group if fund_map[m.slug].fee_pct is not None],
            False,  # lower fee is better
        )

        raw_scores: list[tuple[str, float]] = []
        for m in group:
            parts: list[tuple[float, float]] = []
            if m.slug in sharpe_ranks:
                parts.append((sharpe_ranks[m.slug], 0.40))
            if m.slug in ret_ranks:
                parts.append((ret_ranks[m.slug], 0.25))
            if m.slug in dd_ranks:
                parts.append((dd_ranks[m.slug], 0.25))
            if m.slug in fee_ranks:
                parts.append((fee_ranks[m.slug], 0.10))
            if not parts:
                continue
            w_sum = sum(w for _, w in parts)
            score = round(100.0 * sum(v * w for v, w in parts) / w_sum, 1)
            m.quant_score = score
            raw_scores.append((m.slug, score))

        peer_ranks = _pct_ranks(raw_scores, True)
        for m in group:
            if m.slug in peer_ranks:
                pct = round(peer_ranks[m.slug], 3)
                m.peer_rank_pct = pct
                if pct >= 0.75:
                    m.quant_grade = "A"
                elif pct >= 0.45:
                    m.quant_grade = "B"
                elif pct >= 0.20:
                    m.quant_grade = "C"
                else:
                    m.quant_grade = "D"

    return metrics_list
