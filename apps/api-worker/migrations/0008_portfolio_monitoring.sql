-- =============================================================
-- Wonder Platform — Portfolio Continuous Monitoring & Rebalance (0008_portfolio_monitoring.sql)
-- =============================================================

-- 1. 交易流水补充批次标识与对账备注（用于精确批次撤销与实盘校准溯源）
ALTER TABLE transactions ADD COLUMN batch_id TEXT;
ALTER TABLE transactions ADD COLUMN notes TEXT;
CREATE INDEX IF NOT EXISTS ix_transactions_batch ON transactions (portfolio_id, batch_id);

-- 2. 每日宏观与大宗商品指标快照（1 天 1 行，供投研/实验室/组合监控零外网毫秒级读取）
CREATE TABLE IF NOT EXISTS wq_macro_snapshot (
  as_of_date TEXT NOT NULL PRIMARY KEY,
  us10y_yield REAL,
  us3m_yield REAL,
  us5y_yield REAL,
  yield_curve_10y_3m REAL,
  spy_pe_est REAL,
  spy_pe_pctile REAL,
  spy_erp REAL,
  hsi_pe_pctile REAL,
  gold_price REAL,
  gold_ma200_pct REAL,
  wti_oil_price REAL,
  brent_oil_price REAL,
  oil_ret_20d REAL,
  copper_price REAL,
  copper_gold_ratio REAL,
  copper_gold_trend TEXT,
  dbc_price REAL,
  dxy_index REAL,
  hyg_ief_ratio REAL,
  regime_flags_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  content_sha256 TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- 3. 组合持续监控与 IPS 投资契约配置
CREATE TABLE IF NOT EXISTS portfolio_monitoring_config (
  id TEXT PRIMARY KEY,
  portfolio_id INTEGER NOT NULL UNIQUE REFERENCES portfolios(id) ON DELETE CASCADE,
  wrapper_type TEXT NOT NULL DEFAULT 'AIA_TMP2' CHECK (wrapper_type IN ('AIA_TMP2', 'BROKER_ETF', 'HYBRID')),
  rebalance_mode TEXT NOT NULL DEFAULT 'CALENDAR_BAND' CHECK (rebalance_mode IN ('PERIODIC', 'TOLERANCE_BAND', 'CALENDAR_BAND', 'MACRO_TRIGGER')),
  drift_tolerance REAL NOT NULL DEFAULT 0.05,
  max_drawdown_limit REAL NOT NULL DEFAULT 0.15,
  reeval_interval_days INTEGER NOT NULL DEFAULT 90,
  last_reeval_at TEXT,
  macro_sensitivity_level TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (macro_sensitivity_level IN ('LOW', 'MEDIUM', 'HIGH')),
  ips_profile_json TEXT DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- 4. 再平衡执行单（两阶段确认：DRAFT -> CONFIRMED / CANCELLED）
CREATE TABLE IF NOT EXISTS portfolio_rebalance_tickets (
  id TEXT PRIMARY KEY,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL UNIQUE,
  wrapper_type TEXT NOT NULL DEFAULT 'AIA_TMP2',
  ticket_type TEXT NOT NULL DEFAULT 'DRIFT_REBALANCE',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
  trigger_reason TEXT NOT NULL,
  proposed_allocations_json TEXT NOT NULL,
  order_payload_json TEXT NOT NULL,
  ai_analysis TEXT,
  macro_snapshot_date TEXT,
  created_by TEXT DEFAULT 'SYSTEM',
  confirmed_at TEXT,
  confirmed_by TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- 5. 组合每日健康度与 TWR 时间加权回撤监控日志
CREATE TABLE IF NOT EXISTS portfolio_health_logs (
  id TEXT PRIMARY KEY,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  twr_nav REAL NOT NULL DEFAULT 100.0,
  twr_drawdown REAL NOT NULL DEFAULT 0.0,
  max_asset_drift REAL NOT NULL DEFAULT 0.0,
  drifted_assets_json TEXT NOT NULL DEFAULT '[]',
  macro_risk_flags_json TEXT NOT NULL DEFAULT '[]',
  dna_summary_json TEXT NOT NULL DEFAULT '{}',
  health_score INTEGER NOT NULL DEFAULT 100,
  action_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  UNIQUE(portfolio_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS ix_port_health_date ON portfolio_health_logs (snapshot_date, action_required);
CREATE INDEX IF NOT EXISTS ix_port_ticket_status ON portfolio_rebalance_tickets (portfolio_id, status);
