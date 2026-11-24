-- 為基金產品主檔新增前十大持倉、債券久期/YTM、信用評級與晨星直達連結欄位
ALTER TABLE wq_funds ADD COLUMN top_holdings_json TEXT;
ALTER TABLE wq_funds ADD COLUMN duration REAL;
ALTER TABLE wq_funds ADD COLUMN yield_pct REAL;
ALTER TABLE wq_funds ADD COLUMN avg_rating TEXT;
ALTER TABLE wq_funds ADD COLUMN credit_quality TEXT;
ALTER TABLE wq_funds ADD COLUMN morningstar_url TEXT;
