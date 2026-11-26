// Explicit period model — pure logic, no I/O.
//
// Periods are "Q1 2026" … "Q4 2026" (quarters) or "2026" (annual). String
// sorting is unreliable for this ("Q10" never exists but "Q2 2026" > "Q4 2025"
// lexically); every ordering/consecutiveness question goes through the
// ordinal here instead. Everything is unit-tested in periods.test.ts.

export type Period =
  | { kind: 'quarter'; year: number; quarter: 1 | 2 | 3 | 4; ordinal: number }
  | { kind: 'year'; year: number; ordinal: number }; // ordinal = first quarter of the year

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

// Parse "Q1 2026", "Q1 2026" variants (Qn'26 not supported deliberately —
// ambiguous) and plain "2026". Returns null for anything else — never guessed.
export function parsePeriod(s: string | null | undefined): Period | null {
  if (typeof s !== 'string') return null;
  const q = s.trim().match(/^Q([1-4])[\s-]+(\d{4})$/i);
  if (q) {
    const year = parseInt(q[2], 10);
    const quarter = parseInt(q[1], 10) as 1 | 2 | 3 | 4;
    if (year < YEAR_MIN || year > YEAR_MAX) return null;
    return { kind: 'quarter', year, quarter, ordinal: year * 4 + (quarter - 1) };
  }
  const y = s.trim().match(/^(\d{4})$/);
  if (y) {
    const year = parseInt(y[1], 10);
    if (year < YEAR_MIN || year > YEAR_MAX) return null;
    return { kind: 'year', year, ordinal: year * 4 };
  }
  return null;
}

export function periodLabel(p: Period): string {
  return p.kind === 'quarter' ? `Q${p.quarter} ${p.year}` : String(p.year);
}

// Chronological comparator: -1 / 0 / +1. Unparseable periods sort last,
// deterministically by string (never crash on bad data).
export function comparePeriods(a: string, b: string): number {
  const pa = parsePeriod(a);
  const pb = parsePeriod(b);
  if (pa && pb) return pa.ordinal - pb.ordinal;
  if (!pa && !pb) return a < b ? -1 : a > b ? 1 : 0;
  return pa ? -1 : 1;
}

// The quarter immediately before p ("Q1 2026" -> "Q4 2025"). Quarters only.
export function previousQuarter(p: string): string | null {
  const parsed = parsePeriod(p);
  if (!parsed || parsed.kind !== 'quarter') return null;
  const o = parsed.ordinal - 1;
  const year = Math.floor(o / 4);
  const quarter = (o % 4) + 1;
  return `Q${quarter} ${year}`;
}

// The 4 quarters ending at `end`, oldest first: [end-3, end-2, end-1, end].
// If end is a year or unparseable → null (TTM is defined on quarters only).
export function trailingFourQuarters(end: string): string[] | null {
  const parsed = parsePeriod(end);
  if (!parsed || parsed.kind !== 'quarter') return null;
  const out: string[] = [];
  for (let i = 3; i >= 0; i--) {
    const o = parsed.ordinal - i;
    out.push(`Q${(o % 4) + 1} ${Math.floor(o / 4)}`);
  }
  return out;
}

// True when b is exactly the quarter after a (both parseable quarters).
export function isNextQuarter(a: string, b: string): boolean {
  const pa = parsePeriod(a);
  const pb = parsePeriod(b);
  return !!pa && !!pb && pa.kind === 'quarter' && pb.kind === 'quarter' && pb.ordinal === pa.ordinal + 1;
}
