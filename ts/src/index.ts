// Backend factory. Mode selection happens in the caller (settings / env);
// anything explicit passed here wins.

import { JsonBackend } from "./json";
import { PostgresBackend } from "./postgres";
import { SupabaseBackend } from "./supabase";
import type { BackendConfig, DataMode, DbBackend } from "./types";

export * from "./types";
export { JsonBackend } from "./json";
export { PostgresBackend } from "./postgres";
export { SupabaseBackend } from "./supabase";

/** Normalise a user-facing mode string ("json", "local", ...) to DataMode. */
export function normalizeMode(raw?: string | null): DataMode | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "local" || v === "json" || v === "json_files") return "local";
  if (v === "postgres" || v === "postgresql" || v === "pg") return "postgres";
  if (v === "supabase") return "supabase";
  return null;
}

export function createBackend(config: BackendConfig): DbBackend {
  switch (config.mode) {
    case "postgres":
      if (!config.postgresUrl) throw new Error("postgres mode requires postgresUrl (DATABASE_URL)");
      return new PostgresBackend(config.postgresUrl);
    case "supabase":
      if (!config.supabaseUrl || !config.supabaseKey) {
        throw new Error("supabase mode requires supabaseUrl and supabaseKey");
      }
      return new SupabaseBackend(config.supabaseUrl, config.supabaseKey);
    case "local":
    default:
      if (!config.dataDir) throw new Error("local mode requires dataDir");
      return new JsonBackend(config.dataDir);
  }
}
