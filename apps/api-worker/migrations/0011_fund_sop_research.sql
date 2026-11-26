-- =====================================================================
-- Single-Fund SOP v2.0 Reports & FIS Hub Watchlist Queue (0011)
-- =====================================================================

-- 1. 单只基金 SOP 深度分析报告（1 基金 1 行）
--    摘要字段供 loadQuantCatalog 毫秒级 LEFT JOIN；正文按需单行读取
CREATE TABLE IF NOT EXISTS wq_fund_sop_reports (
  slug TEXT NOT NULL PRIMARY KEY,
  code TEXT NOT NULL,
  fund_name TEXT NOT NULL,
  sop_version TEXT NOT NULL DEFAULT '2.0',
  report_date TEXT NOT NULL,
  data_as_of TEXT NOT NULL,
  fund_type TEXT NOT NULL DEFAULT 'ETF',
  val_route TEXT NOT NULL DEFAULT 'FV1',
  medal_rating TEXT NOT NULL DEFAULT 'Neutral',
  pillar_score REAL DEFAULT 0,
  g1_g5_pass INTEGER NOT NULL DEFAULT 1,
  uncertainty TEXT NOT NULL DEFAULT 'Medium',
  valuation_zone TEXT NOT NULL DEFAULT '合理中性',
  valuation_pct_5y REAL,
  dividend_yield_ttm REAL,
  dividend_spread_rf REAL,
  one_liner TEXT,
  red_flag_top TEXT,
  pillar_json TEXT NOT NULL DEFAULT '{}',
  valuation_summary_json TEXT NOT NULL DEFAULT '{}',
  dividend_summary_json TEXT NOT NULL DEFAULT '{}',
  masters_json TEXT NOT NULL DEFAULT '[]',
  commercial_tabs_json TEXT NOT NULL DEFAULT '[]',
  decision_md TEXT,
  one_pager_md TEXT,
  content_sha256 TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS ix_wq_sop_medal ON wq_fund_sop_reports (medal_rating, valuation_zone);

-- 2. FIS Hub 基金观察分析队列（多人标记去重 + 管理员后台调度）
CREATE TABLE IF NOT EXISTS wq_fund_research_queue (
  slug TEXT NOT NULL PRIMARY KEY,
  code TEXT,
  fund_name TEXT,
  asset_class TEXT,
  ilas_platform TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'watching', 'in_progress', 'completed', 'dismissed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('P0_urgent', 'P1_high', 'normal')),
  request_count INTEGER NOT NULL DEFAULT 1,
  requesters_json TEXT NOT NULL DEFAULT '[]',
  admin_note TEXT,
  assigned_to TEXT,
  first_requested_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  last_requested_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_wq_research_queue_prio ON wq_fund_research_queue (status, priority, request_count DESC);
