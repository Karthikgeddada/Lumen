// Chart integrity guardrails — PURE, enforced in the selector AND mirrored
// by the frontend builders (which receive the notes in the response). Every
// rule is unit-tested; every chart response carries the notes that fired.

import { DataProfile } from './profiler';

export type GuardrailNote = {
  rule: string; // stable id, e.g. 'bars-start-at-zero'
  status: 'enforced' | 'warning' | 'info';
  note: string; // one-line human explanation
};

// Pie/doughnut/nightingale constraints: parts must sum to ~100% and there
// must be at most 6 slices. Never auto-selected regardless.
export function pieConstraints(parts: Array<{ label: string; value: number }>): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (parts.length > 6) reasons.push(`${parts.length} slices — more than the 6-slice limit`);
  if (parts.length < 2) reasons.push('fewer than 2 parts — nothing to compare');
  if (total > 0) {
    const pct = (total / 100) * 100;
    if (Math.abs(pct - 100) > 15) {
      reasons.push(`parts sum to ${total.toFixed(1)}% of a whole, not 100%`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

// Stacking is only for additive components — parts that meaningfully sum to
// a whole. Additive-ness is declared by the dataset (segments/metric sets
// validated by the component-sum rules), not guessed from shapes.
export function stackable(
  seriesKeys: string[],
  additiveSets: Array<Set<string>>,
): { ok: boolean; reason: string } {
  if (seriesKeys.length < 2) return { ok: false, reason: 'stacking needs ≥2 components' };
  for (const set of additiveSets) {
    if (seriesKeys.every((k) => set.has(k))) {
      return { ok: true, reason: 'components declared additive (component-sum validated)' };
    }
  }
  return {
    ok: false,
    reason: 'components are not a declared additive set — stacking would imply a fake whole',
  };
}

// Bars (and area baselines) start at zero; a bar encoding a nonzero baseline
// exaggerates differences.
export function barsStartAtZero(profile: DataProfile): GuardrailNote {
  return {
    rule: 'bars-start-at-zero',
    status: 'enforced',
    note: 'Bar (and stacked-area) baselines are pinned to zero; nonzero baselines exaggerate differences.',
  };
}

// Quarterly and annual series never share one time axis.
export function axisSplit(profile: DataProfile): GuardrailNote | null {
  if (profile.granularity !== 'mixed') return null;
  return {
    rule: 'quarterly-annual-split',
    status: 'enforced',
    note: 'Quarterly and annual periods never share one axis — series are split by granularity.',
  };
}

// Discrete periods are never smoothed; gaps stay gaps with real markers.
export function discretePeriods(profile: DataProfile): GuardrailNote {
  if (profile.hasGaps) {
    return {
      rule: 'gaps-stay-gaps',
      status: 'enforced',
      note: 'Missing periods stay missing (visible gap markers) — values are never interpolated across a gap.',
    };
  }
  return {
    rule: 'discrete-periods',
    status: 'enforced',
    note: 'Periods are discrete points with markers — lines connect them for reading order, never smooth over them.',
  };
}

// TRUST RULE: unresolved-flag figures stay flagged on charts and are excluded
// from aggregates (the service already excludes them; this note is the chart's
// promise to the reader).
export function unresolvedFlagging(profile: DataProfile): GuardrailNote | null {
  if (profile.unresolvedCount === 0) return null;
  return {
    rule: 'unresolved-flagged',
    status: 'warning',
    note: `${profile.unresolvedCount} point(s) carry unresolved scale flags — shown flagged, excluded from aggregates and covenant math.`,
  };
}

// Derivation encoding legend.
export const DERIVATION_ENCODING: Record<string, string> = {
  REPORTED: 'solid line/marker',
  CALCULATED: 'dashed',
  AI_INFERRED: 'hollow/lighter marker',
  UNRESOLVED: 'warning marker',
};

export function derivationLegend(): GuardrailNote {
  return {
    rule: 'derivation-encoding',
    status: 'info',
    note: 'Derivation is always visible: REPORTED solid, CALCULATED dashed, AI_INFERRED hollow/lighter, unresolved warning marker — the legend explains all four.',
  };
}

// No forecasts: anything like "can fall X% before breach" is deterministic
// math on recorded values, labeled as such — never a projected series.
export const NO_FORECAST: GuardrailNote = {
  rule: 'no-forecasts',
  status: 'enforced',
  note: 'Charts never extrapolate. "Can fall X% before breach" is deterministic math on recorded values, labeled as such.',
};

// More than 12 series on one axis → small multiples or a heatmap.
export function seriesCap(profile: DataProfile): GuardrailNote | null {
  if (profile.seriesCount <= 12) return null;
  return {
    rule: 'series-cap',
    status: 'enforced',
    note: `>12 series (${profile.seriesCount}) — shown as small multiples or a heatmap, never one tangled axis.`,
  };
}

// Dual axes are only acceptable with a visible warning and axis titles.
export const DUAL_AXIS: GuardrailNote = {
  rule: 'dual-axis-warning',
  status: 'warning',
  note: 'Dual axes are used only with a visible warning and per-axis titles — two units on one axis would mislead.',
};

// Axis breaks (a truncated value axis) only with an explicit marker.
export const AXIS_BREAK: GuardrailNote = {
  rule: 'axis-break-marker',
  status: 'warning',
  note: 'If a value axis is ever truncated, the break carries an explicit marker — never a silent break.',
};

// Collect the guardrail notes that fire for a given profile + chart id.
export function guardrailNotes(profile: DataProfile, chartId: string): GuardrailNote[] {
  const notes: GuardrailNote[] = [];
  const barFamily =
    chartId.startsWith('bar') || chartId === 'waterfall' || chartId === 'pictorial-bar';
  if (barFamily) notes.push(barsStartAtZero(profile));
  if (chartId === 'area' || chartId === 'bar-stacked' || chartId === 'bar-stacked-100' || chartId === 'theme-river') {
    notes.push({
      rule: 'stacking-additive-only',
      status: 'enforced',
      note: 'Stacking is limited to components declared additive (component-sum validated) — never stacked by default.',
    });
  }
  if (chartId === 'pie' || chartId === 'doughnut' || chartId === 'nightingale') {
    notes.push({
      rule: 'pie-constraints',
      status: 'warning',
      note: 'Pie family only for parts summing to 100% with ≤6 slices — and never auto-selected.',
    });
  }
  const split = axisSplit(profile);
  if (split) notes.push(split);
  if (profile.temporal) notes.push(discretePeriods(profile));
  const unresolved = unresolvedFlagging(profile);
  if (unresolved) notes.push(unresolved);
  const cap = seriesCap(profile);
  if (cap) notes.push(cap);
  notes.push(derivationLegend());
  notes.push(NO_FORECAST);
  return notes;
}
