from __future__ import annotations

from pathlib import Path

import pandas as pd


def load_manual_csv(csv_path: Path) -> pd.DataFrame:
    """
    Load manual CSV fallback (R6) into normalized nav DataFrame.
    Accepted columns: date (or nav_date), nav (or close), optional adj_nav (or adj_close), optional dividend.
    """
    df = pd.read_csv(csv_path)
    col_map = {c.strip().lower(): c for c in df.columns}
    date_col = col_map.get("date") or col_map.get("nav_date")
    nav_col = col_map.get("nav") or col_map.get("close") or col_map.get("price")
    if not date_col or not nav_col:
        raise ValueError(f"CSV must contain 'date'/'nav_date' and 'nav'/'close' columns. Got: {list(df.columns)}")

    adj_col = col_map.get("adj_nav") or col_map.get("adj_close") or nav_col
    div_col = col_map.get("dividend") or col_map.get("div")

    out = pd.DataFrame()
    out["nav_date"] = pd.to_datetime(df[date_col]).dt.strftime("%Y-%m-%d")
    out["nav"] = pd.to_numeric(df[nav_col], errors="coerce")
    out["adj_nav"] = pd.to_numeric(df[adj_col], errors="coerce").fillna(out["nav"])
    out["dividend"] = pd.to_numeric(df[div_col], errors="coerce").fillna(0.0) if div_col else 0.0
    out = out.dropna(subset=["nav"])
    out = out[out["nav"] > 0].drop_duplicates(subset=["nav_date"], keep="last").sort_values("nav_date")
    return out.reset_index(drop=True)
