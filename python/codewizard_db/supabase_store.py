"""Supabase/PostgREST backend (urllib only, never raises)."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List

from .base import DbBackend, Row


class SupabaseBackend(DbBackend):
    mode = "supabase"

    def __init__(self, url: str, key: str, reason: str = "supabase reachable") -> None:
        self.url = url.rstrip("/")
        self.key = key
        self.reason = reason

    def _request(self, method: str, path: str, body: Any = None, prefer: str | None = None):
        url = f"{self.url}/rest/v1/{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8", "replace")
                return resp.status, (json.loads(raw) if raw.strip() else None)
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                parsed = json.loads(raw) if raw.strip() else None
            except ValueError:
                parsed = raw
            return e.code, parsed
        except Exception as e:  # network error
            return 0, str(e)

    def probe(self) -> tuple[bool, str]:
        status, payload = self._request("GET", "opportunities?select=id&limit=1")
        if status in (200, 206):
            return True, "supabase reachable"
        code = ""
        if isinstance(payload, dict):
            code = str(payload.get("code") or payload.get("message") or "")
        if "PGRST205" in code or "does not exist" in code or status == 404:
            return False, "tables missing - apply db/schema_app.sql"
        return False, f"supabase unavailable ({status}: {code})"

    def info(self) -> Dict[str, Any]:
        return {"mode": self.mode, "reason": self.reason, "url": self.url}

    def count(self, table: str) -> int:
        return len(self.read(table))

    def read(self, table: str, select: str = "*", limit: int = 1000) -> List[Row]:
        status, payload = self._request("GET", f"{table}?select={select}&limit={limit}")
        if status in (200, 206) and isinstance(payload, list):
            return payload
        return []

    def save(self, table: str, rows: List[Row], conflict: str = "id", merge: bool = False) -> Dict[str, Any]:
        rows = [r for r in rows if r]
        if not rows:
            return {"table": table, "mode": self.mode, "saved": 0}
        q = urllib.parse.urlencode({"on_conflict": conflict})
        status, payload = self._request(
            "POST", f"{table}?{q}", body=rows,
            prefer="resolution=merge-duplicates,return=minimal",
        )
        if status in (200, 201, 204):
            return {"table": table, "mode": "supabase", "saved": len(rows)}
        saved = 0
        for row in rows:
            s2, _ = self._request(
                "POST", f"{table}?on_conflict={conflict}", body=[row],
                prefer="resolution=merge-duplicates,return=minimal",
            )
            if s2 in (200, 201, 204):
                saved += 1
        return {"table": table, "mode": "supabase", "saved": saved, "bulk_error": str(payload)[:200]}
