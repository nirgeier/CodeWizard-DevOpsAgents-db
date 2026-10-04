"""Local JSON files: <data_dir>/<table>.json, one JSON array per table."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from .base import DbBackend, Row, row_key


class JsonBackend(DbBackend):
    mode = "local"

    def __init__(self, data_dir: Path | str, reason: str = "local JSON files") -> None:
        self.data_dir = Path(data_dir)
        self.reason = reason
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass

    def _path(self, table: str) -> Path:
        if not table.replace("_", "").isalnum():
            raise ValueError(f"bad table name: {table}")
        return self.data_dir / f"{table}.json"

    def info(self) -> Dict[str, Any]:
        return {"mode": self.mode, "reason": self.reason, "data_dir": str(self.data_dir)}

    def count(self, table: str) -> int:
        return len(self.read(table))

    def read(self, table: str, select: str = "*", limit: int = 1000) -> List[Row]:
        try:
            data = json.loads(self._path(table).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        if isinstance(data, dict):
            rows = list(data.get("items") or [])
        else:
            rows = list(data or [])
        return rows[:limit]

    def save(self, table: str, rows: List[Row], conflict: str = "id", merge: bool = False) -> Dict[str, Any]:
        rows = [r for r in rows if r]
        if not rows:
            return {"table": table, "mode": self.mode, "saved": 0}
        try:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc).isoformat()
        except Exception:  # pragma: no cover - datetime always available
            now = ""
        payload: List[Row] = []
        seen: set = set()
        for row in rows:
            rid = row_key(row, conflict)
            if rid is None or rid in seen:
                continue
            seen.add(rid)
            merged = dict(row)
            merged.setdefault("updated_at", now)
            merged.setdefault("created_at", now)
            payload.append(merged)
        if merge:
            by_id: Dict[Any, Row] = {}
            for row in self.read(table):
                rid = row_key(row, conflict)
                if rid is not None:
                    by_id[rid] = row
            for row in payload:
                rid = row_key(row, conflict)
                by_id[rid] = {**by_id.get(rid, {}), **row}
            payload = list(by_id.values())
        self._path(table).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
        )
        return {"table": table, "mode": self.mode, "saved": len(payload)}
