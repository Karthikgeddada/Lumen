// Data profiler — PURE. Given whitelisted dataset rows, compute the shape
// facts the selector needs: how many series, how many periods, granularity,
// gaps, unit dimensions, unresolved points, negative values. Deterministic:
// same rows in, same profile out.

// Period facts arrive precomputed on each row (periodOrdinal/periodKind,
// canonical ordinals from core/periods — the service attaches them). The
// chart brain stays import-pure: it never reaches outside its directory.

export type DataProfile = {
  rowCount: number;
  seriesCount: number; // distinct entity × metric (or covenant) series
  entityCount: number;
  metricCount: number;
  periodCount: number; // distinct periods
  granularity: 'quarter' | 'annual' | 'mixed' | 'none';
  hasGaps: boolean; // a quarterly series missing intermediate quarters
  unitDimensions: string[]; // distinct parsed unit dimensions
  unresolvedCount: number; // rows with unresolved scale/unit flags
  valueMin: number | null;
  valueMax: number | null;
  hasNegativeValues: boolean;
  statuses: string[]; // present covenant statuses, if any
  temporal: boolean; // dataset rows carry a temporal field with ≥2 periods
};

// Minimal row contract: profiler works on any whitelisted dataset's rows —
// observations, covenant_results, matrix, revisions share these optional keys.
export type ProfileRow = {
  [key: string]: unknown; // datasets vary (funnel: stage; lineage: node/parent; matrix: status)
  entity?: string;
  metric?: string;
  covenant?: string;
  period?: string | null;
  periodOrdinal?: number; // canonical ordinal: quarter = year*4+(q-1); year = year*4
  periodKind?: 'quarter' | 'year';
  value?: number | null;
  normalizedValue?: number | null;
  unitDimension?: string;
  unresolved?: boolean;
  status?: string;
};

export function profileRows(rows: ProfileRow[]): DataProfile {
  const series = new Set<string>();
  const entities = new Set<string>();
  const metrics = new Set<string>();
  const covenants = new Set<string>();
  const periods = new Set<string>();
  const dims = new Set<string>();
  const statuses = new Set<string>();
  let unresolved = 0;
  let min: number | null = null;
  let max: number | null = null;
  let negative = false;
  let hasQuarter = false;
  let hasYear = false;
  const quarterOrdinalsBySeries = new Map<string, Set<number>>();

  for (const r of rows) {
    if (r.metric) series.add(`${r.entity ?? ''}|${r.metric}`);
    else if (r.covenant) series.add(`${r.entity ?? ''}|${r.covenant}`);
    else if (r.entity) series.add(`${r.entity}|value`);
    if (r.entity) entities.add(r.entity);
    if (r.metric) metrics.add(r.metric);
    if (r.covenant) covenants.add(r.covenant);
    if (r.period) periods.add(r.period);
    if (r.unitDimension) dims.add(r.unitDimension);
    if (r.unresolved) unresolved++;
    if (r.status) statuses.add(r.status);
    if (r.periodKind === 'quarter') {
      hasQuarter = true;
      if (typeof r.periodOrdinal === 'number') {
        const key = r.metric
          ? `${r.entity ?? ''}|${r.metric}`
          : `${r.entity ?? ''}|${r.covenant ?? 'value'}`;
        let set = quarterOrdinalsBySeries.get(key);
        if (!set) quarterOrdinalsBySeries.set(key, (set = new Set()));
        set.add(r.periodOrdinal);
      }
    } else if (r.periodKind === 'year') {
      hasYear = true;
    }

    const v = r.normalizedValue ?? r.value ?? null;
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (min === null || v < min) min = v;
      if (max === null || v > max) max = v;
      if (v < 0) negative = true;
    }
  }

  const periodList = Array.from(periods);
  let granularity: DataProfile['granularity'] = 'none';
  if (hasQuarter && hasYear) granularity = 'mixed';
  else if (hasQuarter) granularity = 'quarter';
  else if (hasYear) granularity = 'annual';

  // A gap = any quarterly series missing intermediate quarters between its
  // first and last observed period (per-series check — the honest one).
  // Consecutive canonical ordinals differ by exactly 1; anything else is a
  // real gap that must stay visible in the chart.
  let hasGaps = false;
  for (const ordinals of quarterOrdinalsBySeries.values()) {
    const sorted = Array.from(ordinals).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] !== 1) {
        hasGaps = true;
        break;
      }
    }
    if (hasGaps) break;
  }

  return {
    rowCount: rows.length,
    seriesCount: series.size,
    entityCount: entities.size,
    metricCount: metrics.size + covenants.size,
    periodCount: periodList.length,
    granularity,
    hasGaps,
    unitDimensions: Array.from(dims),
    unresolvedCount: unresolved,
    valueMin: min,
    valueMax: max,
    hasNegativeValues: negative,
    statuses: Array.from(statuses).sort(),
    temporal: periodList.length >= 2,
  };
}
