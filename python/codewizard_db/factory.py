"""Create a backend from explicit config, with sane probing/fallback."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .base import DbBackend

MODES = ("local", "postgres", "supabase")


def normalize_mode(raw: Optional[str]) -> Optional[str]:
    v = (raw or "").strip().lower()
    if v in ("local", "json", "json_files", "jsonfiles"):
        return "local"
    if v in ("postgres", "postgresql", "pg"):
        return "postgres"
    if v == "supabase":
        return "supabase"
    return None


@dataclass
class BackendConfig:
    mode: str = "local"
    data_dir: Path | str = "data"
    supabase_url: str = ""
    supabase_key: str = ""
    postgres_url: str = ""


def create_backend(config: BackendConfig) -> DbBackend:
    mode = normalize_mode(config.mode) or "local"
    if mode == "postgres":
        from .postgres_store import PostgresBackend

        try:
            backend = PostgresBackend(config.postgres_url)
            ok, reason = backend.probe()
        except Exception as e:  # noqa: BLE001
            ok, reason = False, f"postgres unavailable ({e})"
        if ok:
            return backend
        # fall back to local JSON so a missing local Postgres never breaks a scan
        from .json_store import JsonBackend

        return JsonBackend(config.data_dir, reason=f"{reason} - fell back to local JSON")
    if mode == "supabase":
        from .supabase_store import SupabaseBackend

        try:
            backend = SupabaseBackend(config.supabase_url, config.supabase_key)
            ok, reason = backend.probe()
        except Exception as e:  # noqa: BLE001
            ok, reason = False, f"supabase unavailable ({e})"
        if ok:
            return backend
        from .json_store import JsonBackend

        return JsonBackend(config.data_dir, reason=f"{reason} - fell back to local JSON")
    from .json_store import JsonBackend

    return JsonBackend(config.data_dir)
