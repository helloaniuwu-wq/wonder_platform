CREATE TABLE IF NOT EXISTS wq_admin_core_picks (
  slug TEXT PRIMARY KEY,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  priority INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wq_admin_core_picks_updated
  ON wq_admin_core_picks(updated_at DESC);
