// TRUE TTM, schedule step-downs and near-breach — pure logic, no I/O.
//
// Aggregation rules (spec C4):
//   flow  — sum of the 4 CONSECUTIVE quarters ending at the target period.
//           Any missing quarter → NOT_TESTED with the gaps named — never a
//           partial-year sum presented as TTM.
//   stock — the period-end value at the target period (debt doesn't sum).
//   ratio — a pre-computed ratio observed at the target period; ratios are
//           never averaged or summed. (Ratios computed FROM inputs happen in
//           the formula itself, after flow/stock inputs are aggregated.)
// Gaps and trust flags propagate: any unresolved input scale flag makes the
// result NOT_TESTED (inherits untrust), and the lineage of every input is
// kept so the calculated observation can cite its sources.
// Everything here is unit-tested in ttm.test.ts.

import { evaluateFormula } from './formula';
import { comparePeriods, parsePeriod, trailingFourQuarters } from './periods';
import { scaleUnresolved, scaleFlags } from './trust';

export type TermKind = 'flow' | 'stock' | 'ratio';

export type CovenantTerm = { key: string; metricKey: string; kind: TermKind };

export type CovenantTerms = {
  inputs: CovenantTerm[];
  where?: string | null; // clause reference — display provenance only
};

export type ScheduleStep = { effectiveFrom: string; threshold: number }; // e.g. step-downs

export type CureEvent = { at: string; by: string; byName?: string | null; period?: string | null; note?: string | null };

// DB-agnostic observation shape (satisfied by Prisma MetricObservation rows).
export type ObsLike = { id?: string; metricKey: string; period: string; value: number; scale: unknown };

export type InputLineage = {
  key: string;
  metricKey: string;
  kind: TermKind;
  periods: string[]; // the exact periods that fed this input
  observationIds: (string | null)[];
  value: number | null;
};

export type ResolvedInputs =
  | { ok: true; scope: Record<string, number>; lineage: InputLineage[] }
  | { ok: false; missing: string[]; unresolved: string[]; lineage: InputLineage[] };

// Resolve every formula input to a number for the target period.
// defPeriod 'ttm' applies the aggregation rules above; 'quarter' uses each
// input's value at the target period directly (no aggregation).
export function resolveInputs(
  terms: CovenantTerms,
  observations: ObsLike[],
  targetPeriod: string,
  defPeriod: 'quarter' | 'ttm',
): ResolvedInputs {
  const byKeyPeriod = new Map<string, ObsLike>();
  for (const o of observations) byKeyPeriod.set(`${o.metricKey}||${o.period}`, o);

  const missing: string[] = [];
  const unresolved: string[] = [];
  const scope: Record<string, number> = {};
  const lineage: InputLineage[] = [];

  for (const input of terms.inputs) {
    const kind: TermKind =
      defPeriod === 'quarter' ? 'stock' : input.kind; // quarterly tests use the quarter's value as-is

    if (kind === 'flow') {
      const quarters = trailingFourQuarters(targetPeriod) ?? [];
      if (!quarters.length) {
        missing.push(`${input.metricKey}: TTM needs a quarterly target period ("${targetPeriod}" is not)`);
        lineage.push({ ...input, kind, periods: [], observationIds: [], value: null });
        continue;
      }
      const used: ObsLike[] = [];
      const gaps: string[] = [];
      for (const q of quarters) {
        const o = byKeyPeriod.get(`${input.metricKey}||${q}`);
        if (!o) gaps.push(q);
        else used.push(o);
      }
      if (gaps.length) {
        missing.push(`${input.metricKey}: no observation for ${gaps.join(', ')}`);
        lineage.push({ ...input, kind, periods: quarters, observationIds: [], value: null });
        continue;
      }
      for (const o of used) {
        if (scaleUnresolved(o.scale))
          unresolved.push(`${input.metricKey} ${o.period} (${scaleFlags(o.scale).join('; ') || 'unresolved scale'})`);
      }
      const sum = used.reduce((a, o) => a + o.value, 0);
      scope[input.key] = sum;
      lineage.push({ ...input, kind, periods: quarters, observationIds: used.map((o) => o.id ?? null), value: sum });
    } else {
      // stock | ratio — the period-end observation at the target
      const o = byKeyPeriod.get(`${input.metricKey}||${targetPeriod}`);
      if (!o) {
        missing.push(`${input.metricKey}: no observation for ${targetPeriod}`);
        lineage.push({ ...input, kind, periods: [targetPeriod], observationIds: [], value: null });
        continue;
      }
      if (scaleUnresolved(o.scale))
        unresolved.push(`${input.metricKey} ${o.period} (${scaleFlags(o.scale).join('; ') || 'unresolved scale'})`);
      scope[input.key] = o.value;
      lineage.push({ ...input, kind, periods: [targetPeriod], observationIds: [o.id ?? null], value: o.value });
    }
  }

  if (missing.length || unresolved.length) return { ok: false, missing, unresolved, lineage };
  return { ok: true, scope, lineage };
}

// Step-down schedule: the LATEST step whose effectiveFrom ≤ the target period
// wins; before the first step the definition's base threshold applies.
export function resolveThreshold(
  baseThreshold: number,
  schedule: ScheduleStep[] | null | undefined,
  targetPeriod: string,
): number {
  if (!Array.isArray(schedule) || schedule.length === 0) return baseThreshold;
  const steps = [...schedule]
    .filter((s) => parsePeriod(s.effectiveFrom) != null && Number.isFinite(s.threshold))
    .sort((a, b) => comparePeriods(a.effectiveFrom, b.effectiveFrom));
  for (let i = steps.length - 1; i >= 0; i--) {
    if (comparePeriods(steps[i].effectiveFrom, targetPeriod) <= 0) return steps[i].threshold;
  }
  return baseThreshold;
}

export type NearBreachInfo = { withinPct: boolean; headroomPct: number | null; nearBreachPct: number };

// Near-breach on the compliant side: PASS with headroom ≤ nearBreachPct of the
// threshold. Headroom percentage is always computed when possible (useful for
// trend analytics even when not near-breach); null when threshold is 0.
export function computeNearBreach(
  comparator: 'LTE' | 'GTE',
  threshold: number,
  value: number,
  nearBreachPct: number | null | undefined,
): NearBreachInfo | null {
  if (nearBreachPct == null || !Number.isFinite(nearBreachPct)) return null;
  const headroom = comparator === 'LTE' ? threshold - value : value - threshold;
  const headroomPct = threshold !== 0 ? (Math.abs(headroom) / Math.abs(threshold)) * 100 : null;
  return { withinPct: headroom >= 0 && headroomPct != null && headroomPct <= nearBreachPct, headroomPct, nearBreachPct };
}

// A formula covenant evaluated for one period. Mirrors evaluateCovenant's
// result shape (trust.ts) plus formula lineage + near-breach.
export function evaluateFormulaCovenant(
  def: {
    comparator: 'LTE' | 'GTE';
    threshold: number;
    period: 'quarter' | 'ttm';
    formula: string;
    terms: CovenantTerms | null;
    schedule?: ScheduleStep[] | null;
    nearBreachPct?: number | null;
    unit?: string;
  },
  observations: ObsLike[],
  targetPeriod: string,
): {
  status: 'PASS' | 'FAIL' | 'NOT_TESTED';
  value: number | null;
  headroom: number | null;
  reason: string | null;
  nearBreach: NearBreachInfo | null;
  lineage: InputLineage[];
  scope: Record<string, number> | null;
} {
  const terms = def.terms;
  if (!terms || !terms.inputs?.length) {
    return { status: 'NOT_TESTED', value: null, headroom: null, nearBreach: null, lineage: [], scope: null,
      reason: 'Formula covenant has no input terms — define inputs before testing.' };
  }

  const resolved = resolveInputs(terms, observations, targetPeriod, def.period);
  if (!resolved.ok) {
    const reason = [
      resolved.missing.length ? `Missing inputs: ${resolved.missing.join('; ')}.` : null,
      resolved.unresolved.length ? `Unresolved scale flags (trust rule): ${resolved.unresolved.join('; ')}.` : null,
    ].filter(Boolean).join(' ');
    return { status: 'NOT_TESTED', value: null, headroom: null, nearBreach: null,
      lineage: resolved.lineage, scope: null, reason };
  }

  const formulaResult = evaluateFormula(def.formula, resolved.scope);
  if (!formulaResult.ok) {
    return { status: 'NOT_TESTED', value: null, headroom: null, nearBreach: null,
      lineage: resolved.lineage, scope: resolved.scope,
      reason: `Formula error: ${formulaResult.error}` };
  }

  const value = formulaResult.value;
  const threshold = resolveThreshold(def.threshold, def.schedule, targetPeriod);
  const headroom = def.comparator === 'LTE' ? threshold - value : value - threshold;
  return {
    status: headroom >= 0 ? 'PASS' : 'FAIL',
    value,
    headroom,
    reason: null,
    nearBreach: computeNearBreach(def.comparator, threshold, value, def.nearBreachPct),
    lineage: resolved.lineage,
    scope: resolved.scope,
  };
}
