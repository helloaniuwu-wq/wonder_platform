from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

import pandas as pd


def atomic_write_text(path: Path, content: str) -> None:
    """R4 compliant atomic writer: UTF-8 without BOM, pure LF line endings, temp-file replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp.{os.getpid()}")
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(normalized)
    os.replace(tmp, path)


def atomic_write_json(path: Path, data: Any, indent: int | None = 2) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=indent, sort_keys=False)
    atomic_write_text(path, text + "\n")


def sha256_json(data: Any) -> str:
    canonical = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def atomic_write_parquet(path: Path, df: pd.DataFrame) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp.{os.getpid()}")
    df.to_parquet(tmp, index=False)
    os.replace(tmp, path)


def read_parquet_or_empty(path: Path, columns: list[str]) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=columns)
    return pd.read_parquet(path)


class FetchLedger:
    """Enforces R6: external data sources fetched at most once per local calendar day."""

    def __init__(self, state_dir: Path) -> None:
        self.path = state_dir / "fetch_ledger.json"
        self.data: dict[str, Any] = self._load()

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"sources": {}, "d1_hashes": {}}
        try:
            obj = json.loads(self.path.read_text(encoding="utf-8"))
            obj.setdefault("sources", {})
            obj.setdefault("d1_hashes", {})
            return obj
        except Exception:
            return {"sources": {}, "d1_hashes": {}}

    def save(self) -> None:
        atomic_write_json(self.path, self.data)

    def fetched_today(self, source_key: str, today_str: str) -> bool:
        entry = self.data["sources"].get(source_key)
        return bool(entry and entry.get("date") == today_str and entry.get("status") == "ok")

    def mark_source(self, source_key: str, today_str: str, status: str, detail: str = "") -> None:
        self.data["sources"][source_key] = {
            "date": today_str,
            "status": status,
            "detail": detail,
        }
        self.save()

    def get_d1_hash(self, key: str) -> str | None:
        return self.data["d1_hashes"].get(key)

    def set_d1_hash(self, key: str, digest: str) -> None:
        self.data["d1_hashes"][key] = digest
