// Free-text unit parsing — pure logic, no I/O.
//
// MetricObservation.unit is unconstrained free text ("USD millions", "%",
// "x", "$ in 000", "days"). Charts and cross-metric aggregation need to know
// what a unit MEANS: which dimension it measures, which currency, and what
// scale the text already implies. Everything here is derived at read time —
// no schema change, no backfill.
//
// TRUST RULE: anything we cannot confidently parse is "unit unresolved" —
// it is NEVER silently treated as comparable, and callers must exclude
// unresolved units from cross-metric aggregation and surface them flagged.

export type UnitDimension = 'currency' | 'percent' | 'multiple' | 'count' | 'unknown';

export type ParsedUnit = {
  dimension: UnitDimension;
  // ISO-ish currency code when the unit names a currency ('USD', 'EUR', …).
  // null for non-currency dimensions, and for scale words with no currency
  // marker ('millions') — those can never aggregate against a named currency.
  currency: string | null;
  // Multiplier already implied by the unit text (1e6 for 'USD millions').
  // null when the text carries no scale (base units).
  scale: number | null;
  unitUnresolved: boolean;
  // Canonical human-facing label ('USD millions', 'percent', 'multiple', …).
  label: string;
};

const CURRENCIES: Array<[RegExp, string]> = [
  [/^(?:us\$|usd|\$)/i, 'USD'],
  [/^(?:eur|€)/i, 'EUR'],
  [/^(?:gbp|£)/i, 'GBP'],
  [/^cad/i, 'CAD'],
  [/^chf/i, 'CHF'],
  [/^(?:jpy|¥)/i, 'JPY'],
  [/^(?:inr|₹)/i, 'INR'],
];

// Count-like units we recognize as plain quantities. Anything else without a
// currency/percent/multiple marker is unknown — we never guess that 'foo'
// is a count.
const COUNT_WORDS =
  /^(?:days?|months?|years?|hours?|count|number|units?|shares?|employees?|people|customers?|users?|orders?|pages?|items?|accounts?|sites?)$/i;

const PERCENT = /^(?:%|pct\.?|percent(?:age)?|per\s?cent)$/i;
const MULTIPLE = /^(?:x|×|times|multiples?)$/i;

const UNRESOLVED: ParsedUnit = { dimension: 'unknown', currency: null, scale: null, unitUnresolved: true, label: '—' };

// Scale implied by words/notations: billions → 1e9, millions → 1e6,
// thousands/k → 1e3, "000"/"000s"/"$ in 000" → 1e3.
function scaleWord(text: string): number | null {
  if (/\b(?:billions?|bn)\b/i.test(text)) return 1e9;
  if (/\b(?:millions?|mn|mm)\b/i.test(text)) return 1e6;
  if (/\bthousands?\b/i.test(text) || /\bin\s+0{3}s?\b/i.test(text) || /\b0{3}s?\b/.test(text)) return 1e3;
  // 'k'/'m'/'b' suffixes directly after a currency marker ($k, $m, usd b)
  const suffix = text.match(/(?:\$|usd|eur|gbp)\s*([kmb])\b/i);
  if (suffix) {
    const s = suffix[1].toLowerCase();
    if (s === 'b') return 1e9;
    if (s === 'm') return 1e6;
    if (s === 'k') return 1e3;
  }
  return null;
}

function currencyMarker(text: string): string | null {
  for (const [re, code] of CURRENCIES) if (re.test(text)) return code;
  return null;
}

/** Parse free-text unit into a dimension/currency/scale triple. */
export function parseUnit(raw: string | null | undefined): ParsedUnit {
  if (typeof raw !== 'string') return UNRESOLVED;
  const text = raw.trim();
  if (!text) return UNRESOLVED;

  if (PERCENT.test(text)) return { dimension: 'percent', currency: null, scale: null, unitUnresolved: false, label: 'percent' };
  if (MULTIPLE.test(text)) return { dimension: 'multiple', currency: null, scale: null, unitUnresolved: false, label: 'multiple' };

  const currency = currencyMarker(text);
  const scale = scaleWord(text);

  // Dimension conflict ("USD %"-style): never guess which one was meant.
  if (currency && /%|\bpercent|\bpct\b/i.test(text)) return UNRESOLVED;

  if (currency) {
    const label = `${currency}${scale ? ` ${scale === 1e9 ? 'billions' : scale === 1e6 ? 'millions' : 'thousands'}` : ''}`;
    return { dimension: 'currency', currency, scale, unitUnresolved: false, label };
  }

  // Scale words without a currency marker (AI sometimes emits 'millions').
  // It is a magnitude of *something* — almost always money in this product —
  // but we cannot prove the currency, so it parses (with currency null) and
  // canAggregateUnits still refuses to mix it with named currencies.
  if (scale) {
    const label = scale === 1e9 ? 'billions' : scale === 1e6 ? 'millions' : 'thousands';
    return { dimension: 'currency', currency: null, scale, unitUnresolved: false, label };
  }

  if (COUNT_WORDS.test(text)) {
    return { dimension: 'count', currency: null, scale: null, unitUnresolved: false, label: text.toLowerCase() };
  }

  return UNRESOLVED;
}

/** TRUST RULE helper: true when the unit cannot be confidently parsed. */
export function isUnitUnresolved(raw: string | null | undefined): boolean {
  return parseUnit(raw).unitUnresolved;
}

/**
 * Normalize a value + unit to base units:
 *   currency  → whole currency units (4.82 'USD millions' → 4_820_000)
 *   percent / multiple / count → value unchanged
 * Unresolved units return the value untouched with unitUnresolved: true —
 * callers must NOT aggregate that value and must show it flagged.
 */
export function normalizeValue(value: number, raw: string | null | undefined): { value: number; unit: ParsedUnit } {
  const unit = parseUnit(raw);
  if (unit.unitUnresolved) return { value, unit };
  if (unit.dimension === 'currency' && unit.scale != null) return { value: value * unit.scale, unit };
  return { value, unit };
}

/**
 * Two units can appear on the same aggregate axis only when both resolve,
 * share a dimension, and (for currency) name the same currency. Scale words
 * don't matter — normalize first.
 */
export function canAggregateUnits(a: ParsedUnit, b: ParsedUnit): boolean {
  if (a.unitUnresolved || b.unitUnresolved) return false;
  if (a.dimension !== b.dimension) return false;
  if (a.dimension === 'currency') return a.currency !== null && a.currency === b.currency;
  return true;
}

/** A display unit/scale for chart axes — friendly magnitudes for currency. */
export type DisplayUnit = { label: string; divideBy: number };

export function chooseDisplayUnit(unit: ParsedUnit, maxAbsBase: number): DisplayUnit {
  if (unit.unitUnresolved) return { label: unit.label, divideBy: 1 };
  if (unit.dimension !== 'currency' || !unit.currency) return { label: unit.label, divideBy: 1 };
  const cur = unit.currency;
  if (maxAbsBase >= 1e9) return { label: `${cur} billions`, divideBy: 1e9 };
  if (maxAbsBase >= 1e6) return { label: `${cur} millions`, divideBy: 1e6 };
  if (maxAbsBase >= 1e3) return { label: `${cur} thousands`, divideBy: 1e3 };
  return { label: cur, divideBy: 1 };
}
