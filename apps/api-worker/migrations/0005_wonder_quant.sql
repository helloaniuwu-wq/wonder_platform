-- =============================================================
-- Wonder Quant — Cloudflare D1 Schema Extension (0005_wonder_quant.sql)
-- 针对 D1 免费版读写配额优化：时序采用列式紧凑单行压缩（每标的仅 1 行，约 32KB）
-- 首日全量 5 年回溯 < 1,000 行写；日常增量 < 660 行写；单基金 5 年曲线 = 1 行读
-- =============================================================

-- 1. 基金产品主档（由 PC 端 wq 从 Vault _funds.json + overrides 同步）
CREATE TABLE IF NOT EXISTS wq_funds (
  slug TEXT NOT NULL PRIMARY KEY,
  code TEXT,
  aia_code TEXT,
  isin TEXT,
  yahoo_ticker TEXT,
  cn_code TEXT,
  name TEXT NOT NULL,
  name_en TEXT,
  manager TEXT,
  asset_class TEXT NOT NULL,
  ilas_platform TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  risk_class TEXT,
  morningstar_stars INTEGER,
  fee_pct REAL,
  role TEXT,
  fit_plans_json TEXT DEFAULT '[]',
  tags_json TEXT DEFAULT '[]',
  commentary TEXT,
  twin_code TEXT,
  is_distributing INTEGER DEFAULT 0,
  benchmark_code TEXT NOT NULL DEFAULT 'SPY',
  primary_source TEXT NOT NULL,
  data_tier TEXT NOT NULL DEFAULT 'U',
  is_trackable INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  vault_last_updated TEXT,
  synced_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS ix_wq_funds_platform ON wq_funds (ilas_platform, asset_class);
CREATE INDEX IF NOT EXISTS ix_wq_funds_aia_code ON wq_funds (aia_code);
CREATE INDEX IF NOT EXISTS ix_wq_funds_isin ON wq_funds (isin);
CREATE INDEX IF NOT EXISTS ix_wq_funds_code ON wq_funds (code);

-- 2. 基金历史时序压缩表（每只基金仅占 1 行）
-- series_json: {"d":["2021-11-23",...],"n":[...],"a":[...],"v":[[idx,amt],...],"t":"market_etf","s":"yfinance"}
CREATE TABLE IF NOT EXISTS wq_fund_series (
  slug TEXT NOT NULL PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'USD',
  series_type TEXT NOT NULL DEFAULT 'market_etf',
  source TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  obs_days INTEGER NOT NULL DEFAULT 0,
  series_json TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (slug) REFERENCES wq_funds (slug)
);

-- 3. 历史与日度汇率压缩表（每个货币对仅占 1 行）
-- series_json: {"d":["2021-11-23",...],"r":[0.1285,...]}
CREATE TABLE IF NOT EXISTS wq_fx_series (
  pair TEXT NOT NULL PRIMARY KEY,
  start_date TEXT,
  end_date TEXT,
  latest_rate REAL NOT NULL,
  series_json TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'yfinance',
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- 4. 参照基准指数压缩表（每个基准仅占 1 行）
-- series_json: {"d":["2021-11-23",...],"c":[...],"a":[...]}
CREATE TABLE IF NOT EXISTS wq_benchmark_series (
  code TEXT NOT NULL PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'USD',
  start_date TEXT,
  end_date TEXT,
  series_json TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- 5. 全库量化体检最新快照（供基金量化库列表毫秒级筛选排序）
CREATE TABLE IF NOT EXISTS wq_fund_metrics (
  slug TEXT NOT NULL PRIMARY KEY,
  as_of_date TEXT NOT NULL,
  valuation_date TEXT,
  latest_nav REAL,
  latest_nav_currency TEXT,
  ret_1m REAL,
  ret_3m REAL,
  ret_6m REAL,
  ret_ytd REAL,
  ret_1y REAL,
  ret_3y_ann REAL,
  ret_5y_ann REAL,
  vol_1y REAL,
  vol_3y REAL,
  max_dd_1y REAL,
  max_dd_3y REAL,
  max_dd_5y REAL,
  dd_recovery_days INTEGER,
  sharpe_3y REAL,
  sortino_3y REAL,
  calmar_3y REAL,
  beta_3y REAL,
  alpha_3y REAL,
  r2_3y REAL,
  ir_3y REAL,
  div_yield_ttm REAL,
  peer_rank_pct REAL,
  quant_score REAL,
  quant_grade TEXT,
  obs_days INTEGER DEFAULT 0,
  data_tier TEXT NOT NULL DEFAULT 'U',
  anomalies_json TEXT DEFAULT '[]',
  computed_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (slug) REFERENCES wq_funds (slug)
);
CREATE INDEX IF NOT EXISTS ix_wq_metrics_grade ON wq_fund_metrics (quant_grade, sharpe_3y DESC);

-- 6. PC 批处理执行流水记录
CREATE TABLE IF NOT EXISTS wq_pipeline_runs (
  run_id TEXT NOT NULL PRIMARY KEY,
  job_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  total_funds INTEGER DEFAULT 0,
  succeeded_funds INTEGER DEFAULT 0,
  failed_funds INTEGER DEFAULT 0,
  failure_rate REAL DEFAULT 0,
  max_valuation_date TEXT,
  aia_valuation_date TEXT,
  alerts_json TEXT DEFAULT '[]',
  host_name TEXT
);
CREATE INDEX IF NOT EXISTS ix_wq_runs_started ON wq_pipeline_runs (started_at DESC);

-- 7. PC 在线心跳与看门狗冷却状态表
CREATE TABLE IF NOT EXISTS wq_heartbeat (
  host_id TEXT NOT NULL PRIMARY KEY,
  last_seen_at TEXT NOT NULL,
  wq_version TEXT,
  last_fetch_ok_at TEXT,
  last_writeback_ok_at TEXT,
  last_aia_val_date TEXT,
  last_alert_sent_at TEXT,
  last_alert_fingerprint TEXT,
  metrics_summary_json TEXT DEFAULT '{}'
);
