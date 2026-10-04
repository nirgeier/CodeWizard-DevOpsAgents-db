"""Storage backends for CodeWizard-DevOpsAgents.

Three interchangeable backends behind one small contract:
  * ``json``     - per-table <table>.json snapshots under a data dir
  * ``postgres`` - a real Postgres (local or remote) via psycopg
  * ``supabase`` - Supabase/PostgREST over HTTPS with the publishable key

Every backend speaks the same rows and the same upsert semantics
(deterministic ids + merge-duplicates, so re-runs never duplicate).
"""

from .factory import MODES, BackendConfig, create_backend, normalize_mode
from .base import DbBackend

__all__ = ["BackendConfig", "DbBackend", "MODES", "create_backend", "normalize_mode"]
