// Local JSON-file backend: <dataDir>/<table>.json, one JSON array per table.
// Writes go through to disk immediately (unique-id merge), reads are cached
// in memory per process. Webapp refreshes are fine because Next route
// handlers each hold their own module instance - same as the old localCache.

import fs from "node:fs";
import path from "node:path";

import { compareBy, parseOrder } from "./order";
import type { DbBackend, Page, QuerySpec, UpdateResult, UpsertResult } from "./types";
import { matches } from "./where";

function rowId(row: Record<string, unknown>): unknown {
  return row.id ?? row.dedupe_key ?? row.hash ?? null;
}

export class JsonBackend implements DbBackend {
  readonly mode = "local" as const;
  private readonly dataDir: string;
  private readonly cache = new Map<string, Record<string, unknown>[]>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {
      // read-only mode is fine
    }
  }

  private file(table: string): string {
    if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error(`bad table name: ${table}`);
    return path.join(this.dataDir, `${table}.json`);
  }

  private load(table: string): Record<string, unknown>[] {
    const hit = this.cache.get(table);
    if (hit) return hit;
    let items: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file(table), "utf8"));
      if (Array.isArray(parsed)) items = parsed;
      else if (parsed && Array.isArray(parsed.items)) items = parsed.items;
    } catch {
      items = [];
    }
    this.cache.set(table, items);
    return items;
  }

  private persist(table: string): void {
    try {
      fs.writeFileSync(
        this.file(table),
        `${JSON.stringify(this.cache.get(table) ?? [], null, 2)}\n`,
        "utf8",
      );
    } catch {
      // best effort
    }
  }

  private apply(rows: Record<string, unknown>[], spec?: QuerySpec): Record<string, unknown>[] {
    const filtered = rows.filter((r) => matches(r, spec));
    const terms = parseOrder(spec?.order);
    if (terms.length) filtered.sort((a, b) => compareBy(a, b, terms));
    return filtered;
  }

  async list<T>(table: string, spec?: QuerySpec): Promise<T[]> {
    const rows = this.apply(this.load(table), spec);
    const limited = spec?.limit != null ? rows.slice(0, spec.limit) : rows;
    return limited as T[];
  }

  async page<T>(table: string, spec?: QuerySpec): Promise<Page<T>> {
    const filtered = this.apply(this.load(table), spec);
    const total = filtered.length;
    const offset = Math.max(spec?.offset ?? 0, 0);
    const limit = Math.max(spec?.limit ?? total, 0);
    return { items: filtered.slice(offset, offset + limit) as T[], total };
  }

  async get<T>(table: string, match: Record<string, string | number>): Promise<T | null> {
    const row = this.load(table).find((r) =>
      Object.entries(match).every(([k, v]) => String(r[k] ?? "") === String(v)),
    );
    return (row as T) ?? null;
  }

  async upsert<T extends object>(table: string, rows: T[], onConflict = "id"): Promise<UpsertResult> {
    const existing = this.load(table);
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of existing) {
      const id = row[onConflict] ?? rowId(row);
      if (id != null) byId.set(String(id), row);
    }
    let saved = 0;
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const id = r[onConflict] ?? rowId(r);
      const key = id != null ? String(id) : `idx:${byId.size}:${saved}`;
      const merged = { ...(byId.get(key) ?? {}), ...r };
      merged.updated_at = merged.updated_at ?? new Date().toISOString();
      byId.set(key, merged);
      saved += 1;
    }
    this.cache.set(table, [...byId.values()]);
    this.persist(table);
    return { saved };
  }

  async update<T>(
    table: string,
    patch: Record<string, unknown>,
    match: Record<string, string | number>,
  ): Promise<UpdateResult & { row?: T | null }> {
    const rows = this.load(table);
    let updated = 0;
    let row: T | null = null;
    for (let i = 0; i < rows.length; i++) {
      const ok = Object.entries(match).every(
        ([k, v]) => String(rows[i][k] ?? "") === String(v),
      );
      if (!ok) continue;
      rows[i] = { ...rows[i], ...patch, updated_at: new Date().toISOString() };
      updated += 1;
      row = rows[i] as T;
    }
    if (updated) this.persist(table);
    return { updated, row };
  }
}
