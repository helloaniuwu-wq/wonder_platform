import yfinance as yf
import subprocess
import tempfile
import os

isins = [
  "0P00006T5J", "IE0033534557", "LU1041599405", "1478.T", "2564.T", "1343.T", 
  "3690.hk", "2269.HK", "9866.HK", "2382.HK", "300059.SZ", "LU1116320737", 
  "HK0000288743", "LU1128926489", "IE0033528617", "LQD", "SCHD", "515080.SS", 
  "159545.SZ", "QWLD", "3110.HK", "AGG", "VT", "IDHQ", "MOAT", "JEPI", "PFF", 
  "LU1882441907", "LU2621531008", "LU0265550359", "LU1746179297", "HK0000288735", "IE0034235188"
]

all_stmts = []
for isin in isins:
    try:
        t = yf.Ticker(isin)
        hist = t.history(start="2024-01-01", auto_adjust=False)
        if hist.empty:
            continue
        for idx, row in hist.iterrows():
            d_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            close = float(row["Close"])
            if close > 0:
                all_stmts.append(f"INSERT OR REPLACE INTO prices (isin, date, price) VALUES ('{isin}', '{d_str}', {round(close, 4)});")
    except Exception as e:
        print(f"Error {isin}: {e}")

print(f"Total price rows to insert: {len(all_stmts)}")

# Batch into files of 500 statements and execute
batch_size = 500
for i in range(0, len(all_stmts), batch_size):
    batch = all_stmts[i:i + batch_size]
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as f:
        f.write("\n".join(batch))
        tmp_path = f.name
    
    cmd = f"cd apps/api-worker && npx --yes wrangler d1 execute wonder-db --remote --file=\"{tmp_path}\""
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    os.remove(tmp_path)
    print(f"Batch {i//batch_size + 1}/{(len(all_stmts)-1)//batch_size + 1}: status {res.returncode}")

print("Backfill complete!")
