"""Backend contract. Mirrors db/ts/src/types.ts."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple

Row = Dict[str, Any]


class DbBackend(ABC):
    mode: str = "local"
    reason: str = ""

    @abstractmethod
    def info(self) -> Dict[str, Any]: ...

    @abstractmethod
    def save(self, table: str, rows: List[Row], conflict: str = "id", merge: bool = False) -> Dict[str, Any]:
        """Insert-or-update rows. ``merge=True`` keeps fields of existing rows
        that the new row does not set (accumulating scanners use this)."""

    @abstractmethod
    def read(self, table: str, select: str = "*", limit: int = 1000) -> List[Row]:
        """Return up to ``limit`` rows of ``table``. Never raises."""

    @abstractmethod
    def count(self, table: str) -> int: ...


def row_key(row: Row, conflict: str = "id") -> Optional[Any]:
    return row.get(conflict) or row.get("id") or row.get("dedupe_key") or row.get("hash")
