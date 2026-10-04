// Shared contract for the storage backends.
//
// Every backend answers the same three operations - list (capped array),
// page (slice + total) and a point write - so the webapp and the agents
// never need to know which one they are talking to.

export type DataMode = "supabase" | "postgres" | "local";

/** Structured WHERE clause. All parts are ANDed. */
export interface QuerySpec {
  /** Exact matches: { status: "review", source: "greenhouse" } */
  filters?: Record<string, string | number | boolean>;
  /** Inclusive ranges: { confidence: { gte: 0.7 } } */
  ranges?: Record<string, { gte?: number | string; lte?: number | string }>;
  /** Case-insensitive substring search over several columns (OR-ed). */
  search?: { columns: string[]; term: string } | null;
  /** PostgREST-style sort, e.g. "confidence.desc,created_at.desc" (optional ".nullslast"). */
  order?: string;
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface UpsertResult {
  saved: number;
  error?: string;
}

export interface UpdateResult {
  updated: number;
}

export interface DbBackend {
  readonly mode: DataMode;
  list<T = Record<string, unknown>>(table: string, spec?: QuerySpec): Promise<T[]>;
  page<T = Record<string, unknown>>(table: string, spec?: QuerySpec): Promise<Page<T>>;
  get<T = Record<string, unknown>>(
    table: string,
    match: Record<string, string | number>,
  ): Promise<T | null>;
  upsert<T extends object>(
    table: string,
    rows: T[],
    onConflict?: string,
  ): Promise<UpsertResult>;
  update<T>(
    table: string,
    patch: Record<string, unknown>,
    match: Record<string, string | number>,
  ): Promise<UpdateResult & { row?: T | null }>;
}

export interface BackendConfig {
  mode: DataMode;
  /** Directory holding the per-table <table>.json snapshots (local mode). */
  dataDir?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  /** postgres connection string, e.g. postgres://user:pw@localhost:5432/db */
  postgresUrl?: string;
}
