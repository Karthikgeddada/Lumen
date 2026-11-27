// Chart brain tests: spec validation (whitelist + injection caps), profiler
// shapes, deterministic selector decisions with reasons per intent, and
// every guardrail. All PURE — no Prisma, no Express, no env.

import { describe, expect, it } from 'vitest';
import { makeChartSpecSchema, validateChartSpec } from './spec';
import { profileRows, ProfileRow } from './profiler';
import { selectChart } from './selector';
import { pieConstraints, stackable, guardrailNotes, DERIVATION_ENCODING } from './guardrails';

// ── Spec validation ────────────────────────────────────────────────

describe('ChartSpec validation', () => {
  const schema = makeChartSpecSchema(false);

  it('accepts a minimal valid spec', () => {
    const r = validateChartSpec({ dataset: 'observations' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.dataset).toBe('observations');
  });

  it('rejects unknown datasets, intents, and charts with actionable reasons', () => {
    for (const bad of [
      { dataset: 'secret_table' },
      { dataset: 'observations', intent: 'predict-the-future' },
      { dataset: 'observations', chart: 'hologram' },
    ]) {
      const r = validateChartSpec(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/catalog|whitelist|Unknown/);
    }
  });

  it('rejects filters the dataset does not whitelist (no arbitrary fields)', () => {
    const r = validateChartSpec({ dataset: 'pipeline_funnel', filters: { entities: ['e1'] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/does not support filter 'entities'/);
  });

  it('rejects unknown filter keys outright (strict object)', () => {
    const r = validateChartSpec({ dataset: 'observations', filters: { sql: ['SELECT 1'] } });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown top-level keys (strict spec)', () => {
    const r = validateChartSpec({ dataset: 'observations', evil: 'payload' });
    expect(r.ok).toBe(false);
  });

  it('T3 charts are rejected with the flag off and accepted with it on', () => {
    expect(schema.safeParse({ dataset: 'observations', chart: 'map' }).success).toBe(false);
    const on = makeChartSpecSchema(true);
    const parsed = on.safeParse({ dataset: 'observations', chart: 'map' });
    expect(parsed.success).toBe(true);
  });

  it('caps filter lists (50 ids) and id length (64) — bounded inputs only', () => {
    const many = Array.from({ length: 51 }, (_, i) => 'e' + i);
    expect(schema.safeParse({ dataset: 'observations', filters: { entities: many } }).success).toBe(false);
    const long = ['x'.repeat(65)];
    expect(schema.safeParse({ dataset: 'observations', filters: { entities: long } }).success).toBe(false);
  });

  it('values are plain strings — never objects or arrays (injection-shaped)', () => {
    const r = schema.safeParse({ dataset: 'observations', filters: { entities: [{}] as never } });
    expect(r.success).toBe(false);
  });
});

// ── Profiler ───────────────────────────────────────────────────────

  // Attach canonical period facts the way the service does (the brain stays
  // import-pure; ordinals come from core/periods at the service layer).
  const obs = (entity: string, metric: string, period: string, value: number, extra: Partial<ProfileRow> = {}): ProfileRow => {
    const q = period.match(/^Q([1-4])\s+(\d{4})$/);
    const y = period.match(/^(\d{4})$/);
    return {
      entity,
      metric,
      period,
      value,
      periodKind: q ? ('quarter' as const) : y ? ('year' as const) : undefined,
      periodOrdinal: q ? Number(q[2]) * 4 + (Number(q[1]) - 1) : y ? Number(y[1]) * 4 : undefined,
      ...extra,
    };
  };

  it('empty rows → zeroed profile, no granularity', () => {
    const p = profileRows([]);
    expect(p.rowCount).toBe(0);
    expect(p.granularity).toBe('none');
    expect(p.temporal).toBe(false);
  });

describe('profiler shapes', () => {


  it('single point → one series, not temporal', () => {
    const p = profileRows([obs('e1', 'revenue', 'Q1 2026', 5)]);
    expect(p.seriesCount).toBe(1);
    expect(p.temporal).toBe(false);
  });

  it('quarterly series with a missing quarter → hasGaps true', () => {
    const rows = [obs('e1', 'revenue', 'Q1 2026', 1), obs('e1', 'revenue', 'Q4 2026', 2)];
    const p = profileRows(rows);
    expect(p.granularity).toBe('quarter');
    expect(p.hasGaps).toBe(true);
    expect(p.periodCount).toBe(2);
  });

  it('mixed quarterly + annual → granularity mixed (never one axis)', () => {
    const rows = [obs('e1', 'revenue', 'Q1 2026', 1), obs('e1', 'revenue', '2026', 10)];
    expect(profileRows(rows).granularity).toBe('mixed');
  });

  it('counts unresolved rows, unit dimensions, negatives, and value range', () => {
    const p = profileRows([
      obs('e1', 'revenue', 'Q1 2026', -5, { unitDimension: 'currency', unresolved: true }),
      obs('e1', 'revenue', 'Q2 2026', 10, { unitDimension: 'currency' }),
      obs('e1', 'margin', 'Q1 2026', 23, { unitDimension: 'percent' }),
    ]);
    expect(p.unresolvedCount).toBe(1);
    expect(p.unitDimensions.sort()).toEqual(['currency', 'percent']);
    expect(p.hasNegativeValues).toBe(true);
    expect(p.valueMin).toBe(-5);
    expect(p.valueMax).toBe(23);
    expect(p.seriesCount).toBe(2);
  });
});

// ── Selector ───────────────────────────────────────────────────────

describe('selector decisions (deterministic, one-line reasons)', () => {
  const trendProfile = profileRows([
    { entity: 'e1', metric: 'revenue', period: 'Q1 2026', value: 1, normalizedValue: 1 },
    { entity: 'e1', metric: 'revenue', period: 'Q2 2026', value: 2, normalizedValue: 2 },
  ]);

  it('observations trend → line (T1), alternatives carry reasons', () => {
    const s = selectChart('observations', 'trend', trendProfile);
    expect(s.recommended?.chartId).toBe('line');
    expect(s.recommended?.tier).toBe('T1');
    expect(s.recommended?.reason).toMatch(/time series/i);
    expect(s.choices.length).toBeGreaterThan(1);
    for (const c of s.choices) expect(c.reason.length).toBeGreaterThan(0);
    const selected = s.choices.find((c) => c.selected);
    expect(selected?.chartId).toBe('line');
  });

  it('is deterministic — same input, identical output (deep equal)', () => {
    const a = selectChart('observations', 'auto', trendProfile);
    const b = selectChart('observations', 'auto', trendProfile);
    expect(a).toEqual(b);
  });

  it('status-matrix dataset → heatmap; pipeline funnel → funnel; lineage → tree', () => {
    const matrixProfile = profileRows([
      { entity: 'e1', covenant: 'lev', status: 'PASS' },
      { entity: 'e2', covenant: 'lev', status: 'FAIL' },
    ]);
    expect(selectChart('covenant_status_matrix', 'auto', matrixProfile).recommended?.chartId).toBe('heatmap');

    const funnelProfile = profileRows([{ stage: 'documents', value: 5 }, { stage: 'extracted', value: 4 }]);
    expect(selectChart('pipeline_funnel', 'auto', funnelProfile).recommended?.chartId).toBe('funnel');

    const lineageProfile = profileRows([{ node: 'n1', parent: null, label: 'ebitda' }]);
    expect(selectChart('lineage', 'auto', lineageProfile).recommended?.chartId).toBe('tree');
  });

  it('revisions → timeline is T2-only: recommended carries the caution, line is the alternative', () => {
    const revProfile = profileRows([
      { metric: 'revenue', period: 'Q1 2026', value: 1 },
      { metric: 'revenue', period: 'Q2 2026', value: 2 },
    ]);
    const s = selectChart('revisions', 'auto', revProfile);
    expect(s.recommended?.chartId).toBe('line'); // T1 fit wins over the T2 timeline
    const timeline = s.choices.find((c) => c.chartId === 'timeline');
    expect(timeline?.tier).toBe('T2');
    expect(timeline?.caution).toBeTruthy();
  });

  it('composition with a whole and many parts → bar-stacked/treemap, NEVER pie', () => {
    const parts = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map((m, i) => ({
      entity: 'e1', metric: m, period: 'Q1 2026', value: i + 1, normalizedValue: i + 1,
    }));
    const p = profileRows(parts);
    const s = selectChart('observations', 'composition', p);
    expect(s.recommended?.chartId).not.toBe('pie');
    expect(s.recommended?.chartId).toBe('bar-stacked');
    const pie = s.choices.find((c) => c.chartId === 'pie');
    expect(pie?.tier).toBe('T2');
  });

  it('>12 series on a line → heatmap recommendation with the reason', () => {
    const many: ProfileRow[] = [];
    for (let i = 0; i < 14; i++) {
      many.push({ entity: 'e' + i, metric: 'revenue', period: 'Q1 2026', value: 1, normalizedValue: 1 });
      many.push({ entity: 'e' + i, metric: 'revenue', period: 'Q2 2026', value: 2, normalizedValue: 2 });
    }
    const s = selectChart('observations', 'trend', profileRows(many));
    expect(s.recommended?.chartId).toBe('heatmap');
    expect(s.recommended?.reason).toMatch(/>12 series/);
  });

  it('empty data → table fallback with the reason, no recommendation', () => {
    const s = selectChart('observations', 'trend', profileRows([]));
    expect(s.recommended).toBeNull();
    expect(s.fallbackTable?.reason).toMatch(/empty state|No rows/i);
  });

  it('blocked alternatives say why (line on funnel dataset)', () => {
    const funnelProfile = profileRows([{ stage: 'documents', value: 5 }, { stage: 'extracted', value: 4 }]);
    const s = selectChart('pipeline_funnel', 'flow', funnelProfile);
    const sankey = s.choices.find((c) => c.chartId === 'sankey');
    expect(sankey?.compatible).toBe(false);
    expect(sankey?.reason).toMatch(/needs source/);
  });

  it('T3 charts never appear unless the flag is on', () => {
    const covProfile = profileRows([{ entity: 'e1', metric: 'revenue', period: 'Q1 2026', value: 1 }]);
    const off = selectChart('observations', 'relationship', profileRows([
      { entity: 'e1', metric: 'a', period: 'Q1 2026', value: 1 },
      { entity: 'e1', metric: 'a', period: 'Q2 2026', value: 2 },
    ]), { chartsExperimental: false });
    expect(off.choices.some((c) => c.tier === 'T3')).toBe(false);
  });
});

// ── Guardrails ─────────────────────────────────────────────────────

describe('guardrails', () => {
  it('pie constraints: ≤6 slices and parts summing to a whole', () => {
    const ok = pieConstraints([
      { label: 'a', value: 50 }, { label: 'b', value: 30 }, { label: 'c', value: 20 },
    ]);
    expect(ok.ok).toBe(true);
    const tooMany = pieConstraints(Array.from({ length: 7 }, (_, i) => ({ label: 's' + i, value: 10 })));
    expect(tooMany.ok).toBe(false);
    expect(tooMany.reasons.join(' ')).toMatch(/7 slices/);
    const notWhole = pieConstraints([{ label: 'a', value: 40 }, { label: 'b', value: 20 }]);
    expect(notWhole.ok).toBe(false);
    expect(notWhole.reasons.join(' ')).toMatch(/not 100%/);
  });

  it('stacking only for declared additive sets', () => {
    const additive = new Set(['seg:a', 'seg:b', 'seg:c']);
    expect(stackable(['seg:a', 'seg:b', 'seg:c'], [additive]).ok).toBe(true);
    expect(stackable(['seg:a', 'revenue', 'seg:c'], [additive]).ok).toBe(false);
    expect(stackable(['x'], [additive]).ok).toBe(false);
  });

  it('guardrailNotes: bar family → zero baseline; stacked family → additive-only; pie → slice rules', () => {
    const p = profileRows([{ entity: 'e1', metric: 'revenue', period: 'Q1 2026', value: 1 }]);
    expect(guardrailNotes(p, 'bar').some((n) => n.rule === 'bars-start-at-zero')).toBe(true);
    expect(guardrailNotes(p, 'waterfall').some((n) => n.rule === 'bars-start-at-zero')).toBe(true);
    expect(guardrailNotes(p, 'bar-stacked').some((n) => n.rule === 'stacking-additive-only')).toBe(true);
    expect(guardrailNotes(p, 'area').some((n) => n.rule === 'stacking-additive-only')).toBe(true);
    expect(guardrailNotes(p, 'pie').some((n) => n.rule === 'pie-constraints')).toBe(true);
  });

  it('mixed granularity → quarterly-annual split note', () => {
    const p = profileRows([
      obs('e1', 'r', 'Q1 2026', 1),
      obs('e1', 'r', '2026', 9),
    ]);
    expect(guardrailNotes(p, 'line').some((n) => n.rule === 'quarterly-annual-split')).toBe(true);
    const pure = profileRows([
      obs('e1', 'r', 'Q1 2026', 1),
      obs('e1', 'r', 'Q2 2026', 2),
    ]);
    expect(guardrailNotes(pure, 'line').some((n) => n.rule === 'quarterly-annual-split')).toBe(false);
  });

  it('gaps → gaps-stay-gaps note; clean temporal → discrete-periods note', () => {
    const gappy = profileRows([
      obs('e1', 'r', 'Q1 2026', 1),
      obs('e1', 'r', 'Q4 2026', 4),
    ]);
    expect(guardrailNotes(gappy, 'line').some((n) => n.rule === 'gaps-stay-gaps')).toBe(true);
    const clean = profileRows([
      obs('e1', 'r', 'Q1 2026', 1),
      obs('e1', 'r', 'Q2 2026', 2),
    ]);
    expect(guardrailNotes(clean, 'line').some((n) => n.rule === 'discrete-periods')).toBe(true);
  });

  it('unresolved points → warning note; >12 series → series-cap note', () => {
    const p = profileRows([
      { entity: 'e1', metric: 'r', period: 'Q1 2026', value: 1, unresolved: true },
    ]);
    expect(guardrailNotes(p, 'line').some((n) => n.rule === 'unresolved-flagged')).toBe(true);
    const many = Array.from({ length: 13 }, (_, i) => ({ entity: 'e' + i, metric: 'm' + i, period: 'Q1 2026', value: 1 }));
    expect(guardrailNotes(profileRows(many), 'line').some((n) => n.rule === 'series-cap')).toBe(true);
  });

  it('derivation encoding is explained (REPORTED/CALCULATED/AI_INFERRED/unresolved)', () => {
    expect(DERIVATION_ENCODING.REPORTED).toMatch(/solid/);
    expect(DERIVATION_ENCODING.CALCULATED).toMatch(/dashed/);
    expect(DERIVATION_ENCODING.AI_INFERRED).toMatch(/hollow|lighter/);
    expect(DERIVATION_ENCODING.UNRESOLVED).toMatch(/warning/);
    const p = profileRows([{ entity: 'e1', metric: 'r', period: 'Q1 2026', value: 1 }]);
    expect(guardrailNotes(p, 'line').some((n) => n.rule === 'derivation-encoding')).toBe(true);
    expect(guardrailNotes(p, 'line').some((n) => n.rule === 'no-forecasts')).toBe(true);
  });
});
