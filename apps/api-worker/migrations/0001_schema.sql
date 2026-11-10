-- =============================================================
-- Wonder Platform — Cloudflare D1 Schema (0001_schema.sql)
-- 精简定稿版：保留 Auth / Companies / Clients / Invoices / Expenses /
-- Commissions / Compliance / FIP (Portfolios, Transactions, Lab, ILP)
-- =============================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT NOT NULL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  role TEXT NOT NULL DEFAULT 'free',
  is_verified INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);

CREATE TABLE IF NOT EXISTS user_tokens (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT NOT NULL PRIMARY KEY,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  cr_number TEXT,
  br_number TEXT,
  incorporation_date TEXT,
  fiscal_year_end_month TEXT DEFAULT '03',
  base_currency TEXT DEFAULT 'HKD',
  address TEXT,
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  business_mode TEXT NOT NULL DEFAULT 'trading_sme',
  company_legal_type TEXT NOT NULL DEFAULT 'limited'
);

CREATE TABLE IF NOT EXISTS user_company_access (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY(user_id) REFERENCES users (id),
  FOREIGN KEY(company_id) REFERENCES companies (id)
);

CREATE TABLE IF NOT EXISTS company_tax_profiles (
  id TEXT NOT NULL PRIMARY KEY,
  company_id TEXT NOT NULL UNIQUE,
  marital_status TEXT DEFAULT 'single',
  spouse_net_income TEXT DEFAULT '0',
  children_count TEXT DEFAULT '0',
  dependent_parents_60 TEXT DEFAULT '0',
  dependent_parents_55 TEXT DEFAULT '0',
  mpf_self_contribution TEXT DEFAULT '0',
  other_deductions TEXT DEFAULT '0',
  FOREIGN KEY(company_id) REFERENCES companies (id)
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT NOT NULL PRIMARY KEY,
  company_id TEXT NOT NULL,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY(company_id) REFERENCES companies (id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT NOT NULL PRIMARY KEY,
  company_id TEXT NOT NULL,
  client_id TEXT,
  invoice_number TEXT NOT NULL,
  invoice_type TEXT DEFAULT 'invoice',
  status TEXT DEFAULT 'draft',
  client_name TEXT NOT NULL,
  client_address TEXT,
  client_email TEXT,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  currency TEXT DEFAULT 'HKD',
  subtotal REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  total_amount REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  notes TEXT,
  terms TEXT,
  bank_info TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY(company_id) REFERENCES companies (id),
  FOREIGN KEY(client_id) REFERENCES clients (id)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT NOT NULL PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  description TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  FOREIGN KEY(invoice_id) REFERENCES invoices (id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT NOT NULL PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT,
  reference TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY(invoice_id) REFERENCES invoices (id),
  FOREIGN KEY(company_id) REFERENCES companies (id)
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT NOT NULL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  simple_category TEXT,
  hk_tax_deductible TEXT NOT NULL DEFAULT 'full',
  hk_tax_note TEXT,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT NOT NULL PRIMARY KEY,
  company_id TEXT NOT NULL,
  voucher_number TEXT NOT NULL UNIQUE,
  receipt_type TEXT DEFAULT 'hk_receipt',
  receipt_date TEXT,
  upload_date TEXT DEFAULT (CURRENT_TIMESTAMP),
  vendor_name TEXT,
  vendor_tax_id TEXT,
  vendor_address TEXT,
  description TEXT,
  currency TEXT DEFAULT 'HKD',
  amount_original REAL,
  tax_rate REAL,
  tax_amount REAL,
  total_amount REAL,
  amount_hkd REAL,
  cn_invoice_code TEXT,
  cn_invoice_number TEXT,
  category_id TEXT,
  ai_confidence INTEGER,
  ai_raw_response TEXT,
  receipt_image_path TEXT,
  receipt_original_filename TEXT,
  source_format TEXT,
  fiscal_year TEXT,
  status TEXT DEFAULT 'pending_review',
  notes TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  file_hash TEXT,
  source_type TEXT DEFAULT 'manual',
  source_ref TEXT,
  FOREIGN KEY(company_id) REFERENCES companies (id),
  FOREIGN KEY(category_id) REFERENCES expense_categories (id)
);
CREATE INDEX IF NOT EXISTS ix_expenses_company_status ON expenses (company_id, status);
CREATE INDEX IF NOT EXISTS ix_expenses_company_date ON expenses (company_id, receipt_date);
CREATE INDEX IF NOT EXISTS ix_expenses_company_fiscal ON expenses (company_id, fiscal_year);

CREATE TABLE IF NOT EXISTS commission_statements (
  id TEXT NOT NULL PRIMARY KEY,
  company_id TEXT NOT NULL,
  insurer_name TEXT NOT NULL,
  agent_code TEXT,
  agent_name TEXT,
  statement_month TEXT NOT NULL,
  fiscal_year TEXT,
  fyc_life_annual REAL DEFAULT 0,
  fyc_life_semi_annual REAL DEFAULT 0,
  fyc_life_quarterly REAL DEFAULT 0,
  fyc_life_monthly REAL DEFAULT 0,
  fyc_life_extra REAL DEFAULT 0,
  fyc_pa REAL DEFAULT 0,
  fyc_mpf REAL DEFAULT 0,
  fyc_subtotal REAL DEFAULT 0,
  renewal_life REAL DEFAULT 0,
  renewal_pa REAL DEFAULT 0,
  renewal_mpf REAL DEFAULT 0,
  renewal_subtotal REAL DEFAULT 0,
  other_taxable_income REAL DEFAULT 0,
  total_taxable_income REAL DEFAULT 0,
  misc_deduction REAL DEFAULT 0,
  allowance_offset REAL DEFAULT 0,
  payment_this_month REAL DEFAULT 0,
  ytd_fyc_subtotal REAL DEFAULT 0,
  ytd_renewal_subtotal REAL DEFAULT 0,
  ytd_other_income REAL DEFAULT 0,
  ytd_total_taxable REAL DEFAULT 0,
  ytd_payment REAL DEFAULT 0,
  source_image_path TEXT,
  source_original_filename TEXT,
  ai_confidence INTEGER,
  ai_raw_response TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  notes TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY(company_id) REFERENCES companies (id)
);
CREATE INDEX IF NOT EXISTS ix_stmt_company_month ON commission_statements (company_id, statement_month);
CREATE INDEX IF NOT EXISTS ix_stmt_company_fiscal ON commission_statements (company_id, fiscal_year);

CREATE TABLE IF NOT EXISTS ir56m_statements (
  id TEXT NOT NULL PRIMARY KEY,
  company_id TEXT NOT NULL,
  payer_name TEXT,
  agent_code TEXT,
  agent_name TEXT,
  period_start TEXT,
  period_end TEXT,
  fiscal_year TEXT,
  total_income REAL DEFAULT 0,
  source_image_path TEXT,
  source_original_filename TEXT,
  ai_confidence INTEGER,
  ai_raw_response TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  notes TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY(company_id) REFERENCES companies (id)
);

CREATE TABLE IF NOT EXISTS compliance_items (
  id TEXT NOT NULL PRIMARY KEY,
  company_id TEXT NOT NULL,
  code TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  title TEXT NOT NULL,
  title_en TEXT,
  category TEXT NOT NULL,
  applies_to TEXT NOT NULL,
  legal_ref TEXT,
  authority TEXT,
  penalty_note TEXT,
  due_date TEXT,
  is_manual_date INTEGER DEFAULT 0,
  needs_manual INTEGER DEFAULT 0,
  reminder_days_before INTEGER DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY(company_id) REFERENCES companies (id)
);

-- ── FIP (FIS Hub 金融沙盘表) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolios (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  base_currency TEXT DEFAULT 'USD',
  dividend_strategy TEXT DEFAULT 'CASH',
  target_allocations TEXT,
  user_id TEXT,
  is_public INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER,
  date TEXT,
  isin TEXT,
  type TEXT,
  shares REAL,
  price REAL,
  FOREIGN KEY(portfolio_id) REFERENCES portfolios (id)
);

CREATE TABLE IF NOT EXISTS manual_dividends (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER,
  isin TEXT,
  date TEXT,
  amount_per_share REAL,
  currency TEXT,
  FOREIGN KEY(portfolio_id) REFERENCES portfolios (id)
);

CREATE TABLE IF NOT EXISTS prices (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  isin TEXT,
  date TEXT,
  price REAL,
  currency TEXT
);

CREATE TABLE IF NOT EXISTS price_cache (
  isin TEXT NOT NULL,
  date TEXT NOT NULL,
  price REAL,
  name TEXT,
  sector TEXT,
  country TEXT,
  PRIMARY KEY (isin, date)
);

CREATE TABLE IF NOT EXISTS dividend_cache (
  isin TEXT NOT NULL,
  date TEXT NOT NULL,
  amount REAL,
  PRIMARY KEY (isin, date)
);

CREATE TABLE IF NOT EXISTS portfolio_history (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER,
  date TEXT,
  total_nav REAL,
  wallet_balance REAL
);

CREATE TABLE IF NOT EXISTS portfolio_stats_cache (
  portfolio_id INTEGER NOT NULL PRIMARY KEY,
  total_nav REAL,
  wallet_balance REAL,
  total_pnl REAL,
  total_divs REAL,
  cumulative_roi REAL,
  annualized_return REAL,
  details TEXT,
  dividend_history TEXT,
  last_updated TEXT
);

CREATE TABLE IF NOT EXISTS assets (
  isin TEXT NOT NULL PRIMARY KEY,
  name TEXT,
  ticker TEXT,
  sector TEXT,
  country TEXT,
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS advisor_clients (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  advisor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  assigned_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  assigned_by TEXT,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS insurance_plans (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  advisor_id TEXT NOT NULL,
  client_id TEXT,
  plan_data TEXT NOT NULL,
  excel_filename TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT,
  is_template INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lab_scenarios (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  assets_json TEXT NOT NULL,
  weights_json TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  chart_json TEXT NOT NULL,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS user_ilp_config (
  user_id TEXT NOT NULL PRIMARY KEY,
  age INTEGER,
  gender TEXT,
  smoker INTEGER,
  premium REAL,
  currency TEXT,
  enrollment_rate REAL,
  updated_at TEXT
);
