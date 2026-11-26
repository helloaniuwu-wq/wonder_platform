from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

DataTier = Literal["A", "B", "C", "U"]
SeriesType = Literal["official_aia", "market_etf", "cn_open_fund", "proxy_underlying", "manual_csv"]
PrimarySource = Literal["aia_fundinfo2", "yfinance", "tencent_hfq", "eastmoney_open", "manual_csv", "none"]


class FundRecord(BaseModel):
    slug: str
    code: str = ""
    aia_code: str | None = None
    isin: str | None = None
    morningstar_id: str | None = None
    yahoo_ticker: str | None = None
    cn_code: str | None = None
    name: str
    name_en: str | None = None
    manager: str | None = None
    asset_class: str = "股票"
    ilas_platform: str = ""
    currency: str = "USD"
    risk_class: str | None = None
    morningstar_stars: int | None = None
    fee_pct: float | None = None
    role: str | None = None
    fit_plans: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    commentary: str | None = None
    twin_code: str | None = None
    is_distributing: bool = False
    snapshot_yield_pct: float | None = None
    benchmark_code: str = "SPY"
    primary_source: PrimarySource = "none"
    data_tier: DataTier = "U"
    is_trackable: bool = True
    is_vault_native: bool = True
    skip_reason: str | None = None
    status: str = "active"
    vault_last_updated: str | None = None


class PackedSeriesPayload(BaseModel):
    """Columnar compact time-series stored as 1 row per instrument in D1 Free Tier.

    Uses anchor date `d0` + day offsets `dd` (and omits redundant `a` when identical to `n`)
    so 15 years (~3,780 trading days) compresses well under Cloudflare D1's 100 KB SQL statement limit.
    """

    d0: str | None = None
    dd: list[int] = Field(default_factory=list)
    d: list[str] = Field(default_factory=list)
    n: list[float] = Field(default_factory=list)  # Clean unit NAV / close
    a: list[float] | None = None  # Total-return adjusted NAV (omitted if identical to n)
    v: list[list[float]] = Field(default_factory=list)  # Sparse dividends [[date_index, amount], ...]
    t: SeriesType = "market_etf"
    s: str = "yfinance"


class FundMetrics(BaseModel):
    slug: str
    as_of_date: str
    valuation_date: str | None = None
    latest_nav: float | None = None
    latest_nav_currency: str = "USD"
    ret_1m: float | None = None
    ret_3m: float | None = None
    ret_6m: float | None = None
    ret_ytd: float | None = None
    ret_1y: float | None = None
    ret_3y_ann: float | None = None
    ret_5y_ann: float | None = None
    vol_1y: float | None = None
    vol_3y: float | None = None
    max_dd_1y: float | None = None
    max_dd_3y: float | None = None
    max_dd_5y: float | None = None
    dd_recovery_days: int | None = None
    sharpe_3y: float | None = None
    sortino_3y: float | None = None
    calmar_3y: float | None = None
    beta_3y: float | None = None
    alpha_3y: float | None = None
    r2_3y: float | None = None
    ir_3y: float | None = None
    div_yield_ttm: float | None = None
    peer_rank_pct: float | None = None
    quant_score: float | None = None
    quant_grade: str | None = None
    obs_days: int = 0
    data_tier: DataTier = "U"
    anomalies: list[str] = Field(default_factory=list)
    computed_at: str = ""


class PipelineRunSummary(BaseModel):
    run_id: str
    job_type: str
    started_at: str
    finished_at: str | None = None
    status: Literal["running", "ok", "partial", "failed", "circuit_open"] = "running"
    total_funds: int = 0
    succeeded_funds: int = 0
    failed_funds: int = 0
    failure_rate: float = 0.0
    max_valuation_date: str | None = None
    aia_valuation_date: str | None = None
    alerts: list[str] = Field(default_factory=list)
    host_name: str = ""


class MacroSnapshot(BaseModel):
    """Daily macro rates, valuation, gold, oil & commodities snapshot synced to D1."""

    as_of_date: str
    us10y_yield: float | None = None
    us3m_yield: float | None = None
    us5y_yield: float | None = None
    yield_curve_10y_3m: float | None = None
    spy_pe_est: float | None = None
    spy_pe_pctile: float | None = None
    spy_erp: float | None = None
    hsi_pe_pctile: float | None = None
    gold_price: float | None = None
    gold_ma200_pct: float | None = None
    wti_oil_price: float | None = None
    brent_oil_price: float | None = None
    oil_ret_20d: float | None = None
    copper_price: float | None = None
    copper_gold_ratio: float | None = None
    copper_gold_trend: Literal["RISING", "FALLING", "NEUTRAL"] = "NEUTRAL"
    dbc_price: float | None = None
    dxy_index: float | None = None
    hyg_ief_ratio: float | None = None
    regime_flags: list[str] = Field(default_factory=list)
    indicators: dict[str, object] = Field(default_factory=dict)
