// Numeric normalization for extracted values. Extracted values are raw strings
// from documents — "$4.82 billion", "4,820 million", "(1,234)", "4.50x" — and
// the old pipeline stripped everything but digits, silently turning 4.82
// billion into 4.82. This module converts a raw value (plus the optional unit
// the extractor reported) into a real number, or null when there is none.

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  thousands: 1e3,
  m: 1e6,
  mm: 1e6,
  mn: 1e6,
  million: 1e6,
  millions: 1e6,
  bn: 1e9,
  bio: 1e9,
  b: 1e9,
  billion: 1e9,
  billions: 1e9,
  tn: 1e12,
  trillion: 1e12,
  trillions: 1e12,
};

function multiplierFromWord(word: string): number | null {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  return MULTIPLIERS[w] ?? null;
}

// Find the first numeric token with its attached suffix and following word:
// "$4.82 billion" → { token: '4.82', suffixWord: 'billion' }, "4,820 million",
// "1.5m", "(1,234)" → { token: '(1,234)', negative }.
interface NumericToken {
  token: string;
  negative: boolean;
  attached: string; // e.g. 'm', 'B', 'x' — text glued to the token's end
  nextWord: string; // e.g. 'billion' in '4.82 billion'
}

function findNumericToken(raw: string): NumericToken | null {
  const m = raw.match(/(-|\()?\s*\d[\d\u00a0.,\u2019']*\d|\d(\.|-|\u2019)?\d+(\.|-|\u2019)?\d*(\))?/);
  if (!m) return null;
  let token = m[0];
  // Accounting convention: a leading parenthesis (or minus) means negative.
  let negative = token.startsWith('-') || token.startsWith('(');
  token = token.replace(/[()\-\s]/g, '');
  const rest = raw.slice((m.index ?? 0) + m[0].length);
  // Attached suffix letters glued to the number: '1.5m', '4.82B', '4.50x' —
  // at most 3 letters and NOT the start of a longer word.
  const attachedM = rest.match(/^\s*([A-Za-z]{1,3})(?![A-Za-z])/);
  const attached = attachedM ? attachedM[1] : '';
  // The word following the number (after any attached suffix): 'billion' in
  // '4.82 billion', 'million' in '4,820 million'.
  const afterAttached = rest.slice((attachedM?.index ?? 0) + (attachedM ? attachedM[0].length : 0));
  const nextWordM = afterAttached.match(/^\s*([A-Za-z]+)/);
  const nextWord = nextWordM ? nextWordM[1] : '';
  return { token, negative, attached, nextWord };
}

function parseToken(token: string): number | null {
  if (!token) return null;
  const hasComma = token.includes(',');
  const hasDot = token.includes('.');
  let t = token.replace(/[\u00a0\u2019']/g, ''); // digit grouping spaces/prime apostrophes
  if (hasComma && hasDot) {
    // Last separator to appear is the decimal one; the other is grouping.
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(/,/g, '.');
    else t = t.replace(/,/g, '');
  } else if (hasComma) {
    // Commas each followed by exactly 3 digits are grouping (1,234,567);
    // anything else treats the comma as a decimal separator (4,82).
    const parts = t.split(',');
    const grouping = parts.length > 1 && parts.slice(1).every((p) => /^\d{3}$/.test(p));
    t = grouping ? t.replace(/,/g, '') : t.replace(/,/g, '.');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseNumericValue(raw: string | null | undefined, unit?: string | null): number | null {
  if (raw == null) return null;
  const text = String(raw);
  const found = findNumericToken(text);
  if (!found) return null;
  let n = parseToken(found.token);
  if (n == null) return null;

  // Multiplier: attached suffix first (1.5m, 4.82B), then the word after the
  // number (4.82 billion), then the reported unit ("billions of USD").
  const fromAttached = multiplierFromWord(found.attached);
  const fromNext = multiplierFromWord(found.nextWord);
  const fromUnit = unit ? multiplierFromWord(String(unit).split(/\s+/)[0] ?? '') : null;
  const multiplier = fromAttached ?? fromNext ?? fromUnit;
  if (multiplier) n *= multiplier;
  return found.negative ? -n : n;
}

// ── Detailed parse for scale-aware ingestion ─────────────────────────────

export interface NormalizedDetail {
  value: number;
  /** True when the value's own text carried the scale ("4.82 billion"). */
  suffixApplied: boolean;
  /** True when the extractor's unit field carried the scale ("millions"). */
  unitApplied: boolean;
  /** Ratios, multiples, percentages and per-share figures — never scaled. */
  nonScalable: boolean;
  nonScalableReason: string | null;
}

/** Detect figures that must never receive a header scale: multiples (4.5x),
 *  percentages (38.2%, pct), and per-share amounts (EPS 2.14, "/share"). */
function detectNonScalable(
  raw: string,
  unit: string | null | undefined,
  attached: string,
): { nonScalable: boolean; reason: string | null } {
  const u = (unit ?? '').toLowerCase();
  const t = raw.toLowerCase();
  if (
    /%/.test(t) ||
    /percent|^pct|\bpct\b/.test(u) ||
    /percent/.test(t)
  ) return { nonScalable: true, reason: 'percentage' };
  const isX = /^(x|times)$/i.test(attached) || /^x$/.test(u) || /multiple/i.test(u);
  if (isX) return { nonScalable: true, reason: 'multiple/ratio' };
  if (
    /per\s*share|\/\s*share|\beps\b/.test(t) ||
    /per\s*share|\/\s*share|\beps\b/.test(u)
  ) return { nonScalable: true, reason: 'per-share' };
  return { nonScalable: false, reason: null };
}

/** Full parse: the number plus WHICH precedence source (if any) already
 *  applied a scale, and whether the figure is exempt from header scaling.
 *  The header-scale resolution in scale.ts consumes this. */
export function parseNumericValueDetailed(
  raw: string | null | undefined,
  unit?: string | null,
): NormalizedDetail | null {
  if (raw == null) return null;
  const text = String(raw);
  const found = findNumericToken(text);
  if (!found) return null;
  const n = parseToken(found.token);
  if (n == null) return null;

  const fromAttached = multiplierFromWord(found.attached);
  const fromNext = multiplierFromWord(found.nextWord);
  const fromUnit = unit ? multiplierFromWord(String(unit).split(/\s+/)[0] ?? '') : null;

  const suffixApplied = fromAttached != null || fromNext != null;
  const unitApplied = !suffixApplied && fromUnit != null;
  const ns = detectNonScalable(text, unit, found.attached);

  const value = (fromAttached ?? fromNext ?? fromUnit) != null && !ns.nonScalable
    ? n * (fromAttached ?? fromNext ?? fromUnit)!
    : n;

  return {
    value: found.negative ? -value : value,
    suffixApplied: suffixApplied && !ns.nonScalable,
    unitApplied,
    nonScalable: ns.nonScalable,
    nonScalableReason: ns.reason,
  };
}