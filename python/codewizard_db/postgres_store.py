"""Postgres backend via psycopg3 (optional dependency: pip install 'codewizard-db[postgres]')."""
from __future__ import annotations

import json
from typing import Any, Dict, List

from .base import DbBackend, Row

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    psycopg = None  # type: ignore
    dict_row = None  # type: ignore
    Jsonb = None  # type: ignore


def _adapt(v: Any) -> Any:
    if Jsonb is not None and isinstance(v, (dict, list)):
        return Jsonb(v)
    return v


def _ident(name: str) -> str:
    if not name.replace("_", "").isalnum():
        raise ValueError(f"bad identifier: {name}")
    return f'"{name}"'


class PostgresBackend(DbBackend):
    mode = "postgres"

    def __init__(self, dsn: str, reason: str = "postgres reachable") -> None:
        self.dsn = dsn
        self.reason = reason
        if psycopg is None:
            raise RuntimeError("psycopg is not installed - pip install 'psycopg[binary]'")

    def _connect(self):
        return psycopg.connect(self.dsn, row_factory=dict_row, autocommit=True)

    def probe(self) -> tuple[bool, str]:
        try:
            with self._connect() as conn:
                conn.execute("SELECT 1")
            return True, "postgres reachable"
        except Exception as e:
            return False, f"postgres unavailable ({e})"

    def info(self) -> Dict[str, Any]:
        return {"mode": self.mode, "reason": self.reason}

    def count(self, table: str) -> int:
        try:
            with self._connect() as conn:
                row = conn.execute(f"SELECT count(*) AS n FROM {_ident(table)}").fetchone()
                return int(row["n"]) if row else 0
        except Exception:
            return 0

    def read(self, table: str, select: str = "*", limit: int = 1000) -> List[Row]:
        try:
            cols = "*" if select == "*" else ", ".join(_ident(c.strip()) for c in select.split(","))
            with self._connect() as conn:
                cur = conn.execute(f"SELECT {cols} FROM {_ident(table)} LIMIT %s", (limit,))
                return [dict(r) for r in cur.fetchall()]
        except Exception:
            return []

    def save(self, table: str, rows: List[Row], conflict: str = "id", merge: bool = False) -> Dict[str, Any]:
        rows = [r for r in rows if r]
        if not rows:
            return {"table": table, "mode": self.mode, "saved": 0}
        saved = 0
        error = None
        try:
            with self._connect() as conn:
                for row in rows:
                    cols = list(row.keys())
                    values = [_adapt(row[c]) for c in cols]
                    updates = ", ".join(
                        f"{_ident(c)} = EXCLUDED.{_ident(c)}" for c in cols if c != conflict
                    )
                    try:
                        conn.execute(
                            f"INSERT INTO {_ident(table)} ({', '.join(_ident(c) for c in cols)}) "
                            f"VALUES ({', '.join(['%s'] * len(cols))}) "
                            f"ON CONFLICT ({_ident(conflict)}) DO UPDATE SET {updates}",
                            values,
                        )
                        saved += 1
                    except Exception as e:
                        error = str(e)
        except Exception as e:
            return {"table": table, "mode": self.mode, "saved": saved, "error": str(e)}
        out: Dict[str, Any] = {"table": table, "mode": self.mode, "saved": saved}
        if error:
            out["error"] = error
        return out
