// Finance-aware number formatting. PURE apart from the shared unit module
// (lib/units → backend core/units), so both ends render figures identically.
//
// Conventions: thousands separators, fixed decimals (tabular-numeral
// friendly — pair with CSS font-variant-numeric in tables/axes/tooltips),
// negatives in parentheses per finance convention: (1,234).

import { parseUnit } from './units';

export type FormatOpts = {
  decimals?: number;
  /** prefix + for positives (deltas, headroom) */
  signed?: boolean;
  /** render negatives in parentheses — default true; headroom uses false */
  parentheses?: boolean;
  /** compact K/M/B form for axis labels and small charts */
  compact?: boolean;
};

function group(value: number, decimals: number): string {
  const [int, frac] = Math.abs(value).toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/** 1,234,567 → '1,234,567'; −1234.5 → '1,234.5' (sign handled by caller). */
export function formatNumber(value: number, decimals = 0): string {
  return group(value, decimals);
}

/** Compact axis form: 1.2K / 3.4M / 5.6B. */
export function compactNumber(value: number): string {
  const a = Math.abs(value);
  if (a >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(value / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `${value}`;
}

/** Suffix implied by a stated unit: '', '%', 'x', 'M', 'K', 'B'. */
export function unitSuffix(unit?: string | null): string {
  if (!unit) return '';
  const u = unit.toLowerCase();
  if (u === '%' || u.includes('percent') || u.includes('pp')) return '%';
  if (u === 'x' || u.includes('multiple') || u.includes('ratio') || u.includes('leverage') || u.includes('coverage')) return 'x';
  if (u.includes('million') || u === 'm') return 'M';
  if (u.includes('thousand')) return 'K';
  if (u.includes('billion')) return 'B';
  return '';
}

function isCurrency(unit?: string | null): boolean {
  if (!unit) return false;
  try {
    return parseUnit(unit).dimension === 'currency';
  } catch {
    return false;
  }
}

/** Default decimals per unit kind: % → 1, x → 2, whole numbers → 0, ≥100 → 0, else 1. */
function defaultDecimals(value: number, suffix: string): number {
  if (suffix === '%') return 1;
  if (suffix === 'x') return 2;
  if (Number.isInteger(value)) return 0;
  return Math.abs(value) >= 100 ? 0 : 1;
}

/**
 * The one formatter pages should use for figures.
 *   formatValue(456, 'USD millions') → '$456M'
 *   formatValue(-1234.5, null) → '(1,235)'
 *   formatValue(4.23, '%') → '4.2%'
 *   formatValue(0.71, 'x') → '0.71x'
 *   formatValue(null, ...) → '—'
 */
export function formatValue(
  value: number | null | undefined,
  unit?: string | null,
  opts: FormatOpts = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const suffix = unitSuffix(unit);
  const decimals = opts.decimals ?? defaultDecimals(value, suffix);
  const currency = isCurrency(unit);
  const cur = currency ? '$' : '';

  if (opts.compact) {
    // magnitude suffixes (M/K/B) are already baked into the compact form —
    // only ratio-like suffixes (% and x) survive compaction.
    const compactSuffix = suffix === '%' || suffix === 'x' ? suffix : '';
    return `${value < 0 ? '-' : ''}${cur}${compactNumber(value)}${compactSuffix}`;
  }
  const body = group(value, decimals);
  if (value < 0) {
    // negatives: parentheses by default, explicit sign when the caller
    // opted out (headroom/deltas) — the sign is never silently dropped.
    return opts.parentheses === false ? `-${cur}${body}${suffix}` : `${cur}(${body}${suffix})`;
  }
  return `${opts.signed ? '+' : ''}${cur}${body}${suffix}`;
}

/** Signed headroom with explicit sign, no parentheses: '+2.79x', '-0.10x'. */
export function formatHeadroom(headroom: number | null | undefined, unit?: string | null): string {
  if (headroom === null || headroom === undefined) return '—';
  const body = formatValue(headroom, unit, { parentheses: false });
  return `${headroom >= 0 ? '+' : ''}${body}`;
}

/** Signed percent change: '+4.2%' / '-1.1%'. */
export function formatDeltaPct(deltaPct: number | null | undefined): string {
  if (deltaPct === null || deltaPct === undefined || Number.isNaN(deltaPct)) return '—';
  return `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`;
}

/** Plain integer count (KPI tiles): 1,234. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return group(value, 0);
}
