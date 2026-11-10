#!/usr/bin/env python3
"""
export-history.py — 导出 portfolio_history, prices, price_cache, dividend_cache 到 D1 SQL
"""
import sqlite3
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
DB_PATH = ROOT_DIR / "backend" / "hk_admin.db"
OUT_SQL = ROOT_DIR / "apps" / "api-worker" / "migrations" / "0003_history_prices.sql"

TABLES = ["prices", "price_cache", "dividend_cache", "portfolio_history"]

def escape_val(val):
    if val is None:
        return "NULL"
    elif isinstance(val, (int, float)):
        return str(val)
    elif isinstance(val, (bytes, bytearray)):
        return f"X'{val.hex()}'"
    else:
        s = str(val).replace("'", "''")
        return f"'{s}'"

def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    lines = [
        "PRAGMA foreign_keys = OFF;",
        "",
    ]

    total_rows = 0
    for table in TABLES:
        cursor.execute(f"SELECT * FROM {table}")
        rows = cursor.fetchall()
        col_names = [d[0] for d in cursor.description]

        if not rows:
            print(f"⚪ 表 [{table}] 为空，跳过")
            continue

        lines.append(f"-- ── Table: {table} ({len(rows)} rows) ──")
        cols_str = ", ".join([f'"{c}"' for c in col_names])

        for row in rows:
            vals_str = ", ".join([escape_val(v) for v in row])
            lines.append(f"INSERT OR REPLACE INTO {table} ({cols_str}) VALUES ({vals_str});")

        lines.append("")
        total_rows += len(rows)
        print(f"✅ 导出表 [{table}]: {len(rows)} 行")

    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    conn.close()
    print(f"🎉 全部导出完成！共 {total_rows} 行，文件: {OUT_SQL} ({OUT_SQL.stat().st_size / 1024:.1f} KB)")

if __name__ == "__main__":
    main()
