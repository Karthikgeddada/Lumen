// Unit-scale detection for extracted financial figures.
//
// Financial statements declare their scale in headers — "in thousands",
// "$ millions", "000s", "$ in 000" — and silently ignoring it means a
// "4,820" under an "in $ millions" header becomes 4,820 instead of 4.82e9.
// This module (a) detects declared scales in header/title/column text,
// (b) resolves exactly ONE scale per figure in a documented precedence order,
// and (c) refuses to guess: conflicts and absences are flagged for review,
// never silently scaled.

export interface ScaleDetection {
  multiplier: number;
  label: string; // e.g. 'thousands' — human-facing in the review queue
  headerText: string; // the matched snippet, for provenance
}

// Most specific patterns first; each entry is a self-contained scale
// declaration. '000'-style patterns are anchored so a plain number like
// 4,000 can never match (no digit may precede the zeros).
const SCALE_PATTERNS: { re: RegExp; multiplier: number; label: string }[] = [
  { re: /(?:in\s+)?(?:[$€£]|us\$|usd)?\s*trillions?\b/i, multiplier: 1e12, label: 'trillions' },
  { re: /(?:in\s+)?(?:[$€£]|us\$|usd)?\s*(?:billions?|bn)\b/i, multiplier: 1e9, label: 'billions' },
  { re: /(?:in\s+)?(?:[$€£]|us\$|usd)?\s*(?:millions?|mn|mm)\b/i, multiplier: 1e6, label: 'millions' },
  { re: /(?:in\s+)?(?:[$€£]|us\$|usd)?\s*thousands?\b/i, multiplier: 1e3, label: 'thousands' },
  // "000s", "$ in 000", "(000)", "£'000", "'000's": standalone zeros,
  // optionally currency-prefixed, optionally followed by 's, never part of a larger number.
  { re: /(?<![\d.,])[$€£]?['’`]?(?:in\s+)?[$€£]?['’`]?0{3}\s*'?(?:s\b)?/i, multiplier: 1e3, label: "'000s" },
];

/** Find the first declared scale in a header/title/column snippet. */
export function detectScaleInText(text: string | null | undefined): ScaleDetection | null {
  if (!text) return null;
  const t = String(text);
  for (const p of SCALE_PATTERNS) {
    const m = t.match(p.re);
    if (m) return { multiplier: p.multiplier, label: p.label, headerText: m[0].trim() };
  }
  return null;
}

/** Does a unit string name a currency (so a missing scale would be dangerous)? */
export function isCurrencyish(raw: string | null | undefined, unit: string | null | undefined): boolean {
  const u = (unit ?? '').toLowerCase();
  const t = String(raw ?? '').toLowerCase();
  return (
    /usd|eur|gbp|dollar|euro|pound|sterling|[$€£]/i.test(u) ||
    /[$€£]/.test(t)
  );
}

// Where a candidate scale was found — from most specific to least.
export type ScaleOrigin = 'table' | 'page' | 'document';

export interface ScaleCandidate extends ScaleDetection {
  from: ScaleOrigin;
  page?: number | null;
  sheet?: string | null;
  tableId?: string | null;
}

export interface ScaleDecision {
  /** Multiplier to apply to the RAW-parsed value (null = none). */
  multiplier: number | null;
  /** Which precedence rule fired — 'suffix'/'unit' mean parseNumericValue
   *  already applied the scale; 'table'/'page'/'document' apply it here. */
  appliedFrom: 'suffix' | 'unit' | ScaleOrigin | 'none' | null;
  provenance: {
    label: string | null;
    headerText: string | null;
    from: 'suffix' | 'unit' | ScaleOrigin | 'exempt' | 'none' | null;
    page?: number | null;
    sheet?: string | null;
    tableId?: string | null;
  } | null;
  /** Review flags — non-empty means the figure needs a human look. */
  flags: string[];
}

export interface ScaleInput {
  raw: string | null | undefined;
  unit: string | null | undefined;
  /** scale already applied inside the raw value ("4.82 billion") */
  suffixApplied: boolean;
  /** scale applied via the extractor's unit field ("millions") */
  unitApplied: boolean;
  /** never-scaled figures: ratios, multiples, percentages, per-share */
  nonScalable: boolean;
  nonScalableReason?: string | null;
  table?: ScaleCandidate | null;
  page?: ScaleCandidate | null;
  document?: ScaleCandidate | null;
}

/**
 * Resolve ONE scale for a figure. Precedence (documented in FEATURES.md 4a):
 *   value's own suffix > extractor unit > table header > page header > document header.
 * Lower-precedence scales are never stacked (double-scaling guard). Ratios,
 * multiples, percentages and per-share figures are never scaled. Conflicts
 * among table/page/document use the most specific level and flag for review;
 * a missing scale on a currency figure keeps the raw value and flags too.
 */
export function decideScale(input: ScaleInput): ScaleDecision {
  const { raw, unit } = input;

  if (input.nonScalable) {
    return {
      multiplier: null,
      appliedFrom: 'none',
      provenance: { label: null, headerText: null, from: 'exempt', page: input.table?.page ?? input.page?.page ?? null },
      flags: [], // exempt is correct behavior, not a flag
    };
  }

  // 1. The value already carries its own scale ("4.82 billion", "4,820mn").
  if (input.suffixApplied) {
    return {
      multiplier: null, // parseNumericValue already applied it
      appliedFrom: 'suffix',
      provenance: { label: null, headerText: String(raw ?? '').slice(0, 120), from: 'suffix' },
      flags: [],
    };
  }

  // 2. The extractor's unit field carries the scale ("millions").
  if (input.unitApplied) {
    return {
      multiplier: null, // parseNumericValue already applied it
      appliedFrom: 'unit',
      provenance: { label: String(unit ?? ''), headerText: String(unit ?? ''), from: 'unit' },
      flags: [],
    };
  }

  // 3–5. Header scales, most specific first. Never stack — pick one level.
  const levels: { cand: ScaleCandidate | null | undefined; origin: ScaleOrigin }[] = [
    { cand: input.table, origin: 'table' },
    { cand: input.page, origin: 'page' },
    { cand: input.document, origin: 'document' },
  ];

  const present = levels.filter((l) => l.cand);
  const distinctMultipliers = new Set(present.map((l) => l.cand!.multiplier));

  if (present.length) {
    const winner = present[0]!; // most specific level that exists
    const flags: string[] = [];
    if (distinctMultipliers.size > 1) {
      // e.g. table says millions, page says thousands — a mixed-scale statement.
      flags.push(
        `scale conflict: ${present
          .map((l) => `${l.origin} declares ${l.cand!.label} (×${l.cand!.multiplier})`)
          .join('; ')} — used ${winner.origin}; verify against the source`,
      );
    }
    return {
      multiplier: winner.cand!.multiplier,
      appliedFrom: winner.origin,
      provenance: {
        label: winner.cand!.label,
        headerText: winner.cand!.headerText,
        from: winner.origin,
        page: winner.cand!.page ?? null,
        sheet: winner.cand!.sheet ?? null,
        tableId: winner.cand!.tableId ?? null,
      },
      flags,
    };
  }

  // No scale anywhere. For currency figures that's dangerous — never assume
  // units; keep the raw value and flag. Non-currency figures (counts, days,
  // headcount) don't need a scale at all.
  if (isCurrencyish(raw, unit)) {
    return {
      multiplier: null,
      appliedFrom: 'none',
      provenance: { label: null, headerText: null, from: 'none' },
      flags: ['scale not found — currency figure with no detectable scale; verify units against the source'],
    };
  }
  return {
    multiplier: null,
    appliedFrom: 'none',
    provenance: { label: null, headerText: null, from: 'none' },
    flags: [],
  };
}

