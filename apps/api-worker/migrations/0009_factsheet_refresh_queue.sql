-- 投連險與基金月報 (Factsheet) 異步抓取與大模型解析任務隊列
CREATE TABLE IF NOT EXISTS wq_factsheet_queue (
  slug TEXT PRIMARY KEY,
  code TEXT,
  isin TEXT,
  factsheet_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  requested_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  completed_at TEXT,
  last_error TEXT,
  result_summary TEXT
);

CREATE INDEX IF NOT EXISTS ix_wq_factsheet_queue_status ON wq_factsheet_queue (status, requested_at);
