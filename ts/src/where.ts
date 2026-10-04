// Row filtering shared by the in-memory (JSON) backend.

import type { QuerySpec } from "./types";

function norm(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export function matches<T>(row: T, spec?: QuerySpec): boolean {
  const r = row as Record<string, unknown>;

  if (spec?.filters) {
    for (const [col, value] of Object.entries(spec.filters)) {
      const cell = r[col];
      if (typeof value === "boolean") {
        if (Boolean(cell) !== value) return false;
      } else if (String(cell ?? "") !== String(value)) return false;
    }
  }

  if (spec?.ranges) {
    for (const [col, range] of Object.entries(spec.ranges)) {
      const cell = r[col];
      const n = typeof cell === "number" ? cell : Number(cell);
      if (range.gte !== undefined) {
        const bound = typeof range.gte === "number" ? range.gte : Number(range.gte);
        const ok = Number.isFinite(n) && Number.isFinite(bound)
          ? n >= bound
          : norm(cell) >= String(range.gte);
        if (!ok) return false;
      }
      if (range.lte !== undefined) {
        const bound = typeof range.lte === "number" ? range.lte : Number(range.lte);
        const ok = Number.isFinite(n) && Number.isFinite(bound)
          ? n <= bound
          : norm(cell) <= String(range.lte);
        if (!ok) return false;
      }
    }
  }

  if (spec?.search && spec.search.term.trim()) {
    const term = spec.search.term.trim().toLowerCase();
    const hit = spec.search.columns.some((col) =>
      norm(r[col]).toLowerCase().includes(term),
    );
    if (!hit) return false;
  }

  return true;
}
