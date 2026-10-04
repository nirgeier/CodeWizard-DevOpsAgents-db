# Storage abstraction

`ts/` and `python/` hold the same backend contract for the webapp (Next.js) and
the agents (Python pipeline). One of three backends is active per run:

| mode | sdk | where the rows live |
|---|---|---|
| `local` (alias `json`) | `ts/src/json.ts`, `codewizard_db/json_store.py` | `<repo>/data/*.json` |
| `postgres` | `ts/src/postgres.ts` (`pg`), `codewizard_db/postgres_store.py` (`psycopg`) | a local/remote Postgres, schema from `schema_app.sql` |
| `supabase` | `ts/src/supabase.ts`, `codewizard_db/supabase_store.py` | Supabase project |

Choose it with `STORAGE_MODE` / `DB_MODE` env (or the `storage_mode` setting in
the webapp Settings page): `local` | `postgres` | `supabase`.
Connection via `DATABASE_URL` (postgres) and `SUPABASE_URL` +
`SUPABASE_PUBLISHABLE_KEY` (supabase).
