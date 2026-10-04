// Local (or any) Postgres backend. The schema is the same tables the app
// keeps in Supabase (db/schema_app.sql), so every QuerySpec maps onto plain SQL.

import pg from "pg";

import { parseOrder } from "./order";
import type { DbBackend, Page, QuerySpec, UpdateResult, UpsertResult } from "./types";

function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad identifier: ${name}`);
  return `"${name}"`;
}

function buildWhere(spec: QuerySpec | undefined, values: unknown[]): string {
  const clauses: string[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    clauses.push(`${sql} $${values.length}`);
  };

  if (spec?.filters) {
    for (const [col, value] of Object.entries(spec.filters)) {
      add(`${ident(col)} =`, value);
    }
  }
  if (spec?.ranges) {
    for (const [col, range] of Object.entries(spec.ranges)) {
      if (range.gte !== undefined) add(`${ident(col)} >=`, range.gte);
      if (range.lte !== undefined) add(`${ident(col)} <=`, range.lte);
    }
  }
  if (spec?.search && spec.search.term.trim()) {
    values.push(`%${spec.search.term.trim().replace(/[%_]/g, "")}%`);
    const idx = values.length;
    const ors = spec.search.columns.map((c) => `${ident(c)} ILIKE $${idx}`).join(" OR ");
    clauses.push(`(${ors})`);
  }
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

function buildOrder(order?: string): string {
  const terms = parseOrder(order);
  if (!terms.length) return "";
  return `ORDER BY ${terms
    .map((t) => `${ident(t.column)} ${t.dir === "asc" ? "ASC" : "DESC"}${t.nullsLast ? " NULLS LAST" : ""}`)
    .join(", ")}`;
}

export class PostgresBackend implements DbBackend {
  readonly mode = "postgres" as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
  }

  async list<T>(table: string, spec?: QuerySpec): Promise<T[]> {
    const values: unknown[] = [];
    const where = buildWhere(spec, values);
    const order = buildOrder(spec?.order);
    const limit = spec?.limit != null ? `LIMIT ${Math.max(0, Math.floor(spec.limit))}` : "";
    const offset = spec?.offset ? `OFFSET ${Math.max(0, Math.floor(spec.offset))}` : "";
    const res = await this.pool.query(
      `SELECT * FROM ${ident(table)} ${where} ${order} ${limit} ${offset}`,
      values,
    );
    return res.rows as T[];
  }

  async page<T>(table: string, spec?: QuerySpec): Promise<Page<T>> {
    const values: unknown[] = [];
    const where = buildWhere(spec, values);
    const countRes = await this.pool.query(
      `SELECT count(*)::int AS total FROM ${ident(table)} ${where}`,
      values,
    );
    const total = countRes.rows[0]?.total ?? 0;
    const order = buildOrder(spec?.order);
    const limit = `LIMIT ${Math.max(0, Math.floor(spec?.limit ?? total))}`;
    const offset = spec?.offset ? `OFFSET ${Math.max(0, Math.floor(spec.offset))}` : "";
    const res = await this.pool.query(
      `SELECT * FROM ${ident(table)} ${where} ${order} ${limit} ${offset}`,
      values,
    );
    return { items: res.rows as T[], total };
  }

  async get<T>(table: string, match: Record<string, string | number>): Promise<T | null> {
    const values: unknown[] = [];
    const clauses = Object.entries(match).map(([k, v]) => {
      values.push(v);
      return `${ident(k)} = $${values.length}`;
    });
    const res = await this.pool.query(
      `SELECT * FROM ${ident(table)} WHERE ${clauses.join(" AND ") || "true"} LIMIT 1`,
      values,
    );
    return (res.rows[0] as T) ?? null;
  }

  async upsert<T extends object>(table: string, rows: T[], onConflict = "id"): Promise<UpsertResult> {
    let saved = 0;
    let error: string | undefined;
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const cols = Object.keys(r);
      if (!cols.length) continue;
      const values = cols.map((c) => r[c]);
      const updates = cols
        .filter((c) => c !== onConflict)
        .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`)
        .join(", ");
      try {
        await this.pool.query(
          `INSERT INTO ${ident(table)} (${cols.map(ident).join(", ")})
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
           ON CONFLICT (${ident(onConflict)}) DO UPDATE SET ${updates || `${ident(onConflict)} = EXCLUDED.${ident(onConflict)}`}`,
          values,
        );
        saved += 1;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    return { saved, error };
  }

  async update<T>(
    table: string,
    patch: Record<string, unknown>,
    match: Record<string, string | number>,
  ): Promise<UpdateResult & { row?: T | null }> {
    const setCols = Object.keys(patch);
    if (!setCols.length) return { updated: 0 };
    const values: unknown[] = setCols.map((c) => patch[c]);
    const setSql = setCols.map((c, i) => `${ident(c)} = $${i + 1}`).join(", ");
    const matchCols = Object.keys(match);
    const where = matchCols
      .map((c, i) => {
        values.push(match[c]);
        return `${ident(c)} = $${setCols.length + i + 1}`;
      })
      .join(" AND ");
    const res = await this.pool.query(
      `UPDATE ${ident(table)} SET ${setSql} WHERE ${where || "true"} RETURNING *`,
      values,
    );
    return { updated: res.rowCount ?? 0, row: (res.rows[0] as T) ?? null };
  }
}
