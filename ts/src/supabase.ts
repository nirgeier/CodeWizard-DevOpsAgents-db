// Supabase (PostgREST) backend - same behaviour the webapp had before the
// abstraction, just expressed through the shared QuerySpec contract.

import type { DbBackend, Page, QuerySpec, UpdateResult, UpsertResult } from "./types";

function toParams(spec?: QuerySpec): string[] {
  const params: string[] = [];
  if (spec?.filters) {
    for (const [col, value] of Object.entries(spec.filters)) {
      params.push(`${col}=eq.${encodeURIComponent(String(value))}`);
    }
  }
  if (spec?.ranges) {
    for (const [col, range] of Object.entries(spec.ranges)) {
      if (range.gte !== undefined) params.push(`${col}=gte.${encodeURIComponent(String(range.gte))}`);
      if (range.lte !== undefined) params.push(`${col}=lte.${encodeURIComponent(String(range.lte))}`);
    }
  }
  if (spec?.search && spec.search.term.trim()) {
    const safe = spec.search.term.trim().replace(/[(),*]/g, " ").trim();
    if (safe) {
      params.push(`or=(${spec.search.columns.map((c) => `${c}.ilike.*${safe}*`).join(",")})`);
    }
  }
  if (spec?.order) params.push(`order=${spec.order}`);
  if (spec?.limit != null) params.push(`limit=${spec.limit}`);
  return params;
}

export class SupabaseBackend implements DbBackend {
  readonly mode = "supabase" as const;
  private readonly url: string;
  private readonly key: string;

  constructor(url: string, key: string) {
    this.url = url.replace(/\/+$/, "");
    this.key = key;
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      Accept: "application/json",
    };
  }

  async list<T>(table: string, spec?: QuerySpec): Promise<T[]> {
    const params = toParams(spec);
    params.push("select=*");
    try {
      const res = await fetch(`${this.url}/rest/v1/${table}?${params.join("&")}`, {
        headers: this.headers(),
        cache: "no-store",
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? (data as T[]) : [];
    } catch {
      return [];
    }
  }

  async page<T>(table: string, spec?: QuerySpec): Promise<Page<T>> {
    const params = toParams({ ...spec, limit: undefined });
    params.push("select=*");
    const limit = Math.max(spec?.limit ?? 50, 0);
    const offset = Math.max(spec?.offset ?? 0, 0);
    try {
      const res = await fetch(`${this.url}/rest/v1/${table}?${params.join("&")}`, {
        headers: {
          ...this.headers(),
          Range: `${offset}-${offset + limit - 1}`,
          "Range-Unit": "items",
          Prefer: "count=exact",
        },
        cache: "no-store",
      });
      if (!res.ok) return { items: [], total: 0 };
      const data = await res.json();
      const items = Array.isArray(data) ? (data as T[]) : [];
      const total = Number((res.headers.get("content-range") ?? "").split("/")[1]);
      return { items, total: Number.isFinite(total) ? total : items.length };
    } catch {
      return { items: [], total: 0 };
    }
  }

  async get<T>(table: string, match: Record<string, string | number>): Promise<T | null> {
    const filters = Object.entries(match)
      .map(([k, v]) => `${k}=eq.${encodeURIComponent(String(v))}`)
      .join("&");
    try {
      const res = await fetch(
        `${this.url}/rest/v1/${table}?select=*&${filters}&limit=1`,
        { headers: this.headers(), cache: "no-store" },
      );
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) && data.length ? (data[0] as T) : null;
    } catch {
      return null;
    }
  }

  async upsert<T extends object>(table: string, rows: T[], onConflict = "id"): Promise<UpsertResult> {
    if (!rows.length) return { saved: 0 };
    try {
      const res = await fetch(`${this.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
        method: "POST",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });
      if (res.ok) return { saved: rows.length };
      // one bad row must not drop the batch - retry row by row
      let saved = 0;
      let error: string | undefined;
      for (const row of rows) {
        const r = await fetch(`${this.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
          method: "POST",
          headers: {
            ...this.headers(),
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify([row]),
        });
        if (r.ok) saved += 1;
        else if (!error) error = `PostgREST ${r.status}: ${(await r.text()).slice(0, 200)}`;
      }
      return { saved, error };
    } catch (err) {
      return { saved: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async update<T>(
    table: string,
    patch: Record<string, unknown>,
    match: Record<string, string | number>,
  ): Promise<UpdateResult & { row?: T | null }> {
    const filter = Object.entries(match)
      .map(([k, v]) => `${k}=eq.${encodeURIComponent(String(v))}`)
      .join("&");
    try {
      const res = await fetch(`${this.url}/rest/v1/${table}?${filter}`, {
        method: "PATCH",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return { updated: 0 };
      const data = await res.json();
      return {
        updated: Array.isArray(data) ? data.length : 0,
        row: Array.isArray(data) && data.length ? (data[0] as T) : null,
      };
    } catch {
      return { updated: 0 };
    }
  }
}
