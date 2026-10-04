// Order-spec parsing shared by every backend ("confidence.desc.nullslast").

export interface OrderTerm {
  column: string;
  dir: "asc" | "desc";
  nullsLast: boolean;
}

export function parseOrder(order?: string, fallback?: OrderTerm[]): OrderTerm[] {
  if (!order || !order.trim()) return fallback ?? [];
  const terms: OrderTerm[] = [];
  for (const raw of order.split(",")) {
    const parts = raw.trim().split(".").filter(Boolean);
    if (parts.length === 0) continue;
    const column = parts[0];
    const dir = parts[1] === "asc" ? "asc" : "desc";
    const nullsLast = parts.includes("nullslast");
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
      terms.push({ column, dir, nullsLast });
    }
  }
  return terms.length ? terms : (fallback ?? []);
}

/** Compare two rows by an order spec, mirroring Postgres semantics loosely. */
export function compareBy<T>(a: T, b: T, terms: OrderTerm[]): number {
  for (const t of terms) {
    const av = (a as Record<string, unknown>)[t.column];
    const bv = (b as Record<string, unknown>)[t.column];
    const an = av === null || av === undefined || av === "";
    const bn = bv === null || bv === undefined || bv === "";
    if (an && bn) continue;
    if (an) return t.nullsLast ? 1 : -1;
    if (bn) return t.nullsLast ? -1 : 1;
    const numA = typeof av === "number" ? av : Number(av);
    const numB = typeof bv === "number" ? bv : Number(bv);
    let cmp: number;
    if (Number.isFinite(numA) && Number.isFinite(numB)) cmp = numA - numB;
    else cmp = String(av).localeCompare(String(bv));
    if (cmp !== 0) return t.dir === "asc" ? cmp : -cmp;
  }
  return 0;
}
