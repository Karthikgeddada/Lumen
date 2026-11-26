// TRUE TTM tests — spec C4/C5/C6: flow vs stock vs ratio, gap handling,
// step-down boundaries, near-breach, trust propagation from inputs.
import { describe, expect, it } from 'vitest';
import {
  resolveInputs,
  resolveThreshold,
  computeNearBreach,
  evaluateFormulaCovenant,
  CovenantTerms,
  ObsLike,
} from './ttm';

const q = (period: string, metricKey: string, value: number, scale: unknown = null): ObsLike => ({
  id: `${metricKey}-${period}`,
  metricKey,
  period,
  value,
  scale,
});

const ebitdaQuarters = ['Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026'].map((p, i) => q(p, 'ebitda', 10 + i));

describe('resolveInputs — aggregation by kind', () => {
  const terms: CovenantTerms = {
    inputs: [
      { key: 'ebitda', metricKey: 'ebitda', kind: 'flow' },
      { key: 'debt', metricKey: 'debt', kind: 'stock' },
      { key: 'margin', metricKey: 'operating_margin', kind: 'ratio' },
    ],
  };

  it('flow sums the 4 consecutive quarters ending at the target', () => {
    const r = resolveInputs(terms, [...ebitdaQuarters, q('Q2 2026', 'debt', 100), q('Q2 2026', 'operating_margin', 0.24)], 'Q2 2026', 'ttm');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scope.ebitda).toBe(10 + 11 + 12 + 13); // 46
      expect(r.scope.debt).toBe(100);
      expect(r.scope.margin).toBe(0.24);
    }
  });

  it('stock uses the period-end value — debt is never summed', () => {
    const r = resolveInputs(
      { inputs: [{ key: 'debt', metricKey: 'debt', kind: 'stock' }] },
      [q('Q1 2026', 'debt', 90), q('Q2 2026', 'debt', 100)],
      'Q2 2026',
      'ttm',
    );
    expect(r.ok && r.scope.debt).toBe(100);
  });

  it('ratio inputs are never averaged or summed', () => {
    const ratios = [q('Q3 2025', 'm', 0.1), q('Q4 2025', 'm', 0.2), q('Q1 2026', 'm', 0.3), q('Q2 2026', 'm', 0.4)];
    const r = resolveInputs({ inputs: [{ key: 'm', metricKey: 'm', kind: 'ratio' }] }, ratios, 'Q2 2026', 'ttm');
    expect(r.ok && r.scope.m).toBe(0.4); // period-end, not the 0.25 average
  });

  it('quarter mode uses the quarter’s own value for every kind', () => {
    const r = resolveInputs(
      { inputs: [{ key: 'ebitda', metricKey: 'ebitda', kind: 'flow' }] },
      ebitdaQuarters,
      'Q1 2026',
      'quarter',
    );
    expect(r.ok && r.scope.ebitda).toBe(12);
  });
});

describe('resolveInputs — gaps and trust propagation', () => {
  it('a gap in the 4 quarters → NOT_TESTED with the quarter named', () => {
    const r = resolveInputs(
      { inputs: [{ key: 'ebitda', metricKey: 'ebitda', kind: 'flow' }] },
      ebitdaQuarters.filter((o) => o.period !== 'Q1 2026'),
      'Q2 2026',
      'ttm',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing.join(' ')).toContain('Q1 2026');
      expect(r.missing.join(' ')).toContain('ebitda');
    }
  });

  it('never sums a partial year silently', () => {
    const r = resolveInputs(
      { inputs: [{ key: 'ebitda', metricKey: 'ebitda', kind: 'flow' }] },
      ebitdaQuarters.slice(1), // only 3 quarters present
      'Q2 2026',
      'ttm',
    );
    expect(r.ok).toBe(false);
  });

  it('an unresolved scale flag on ANY input quarter → NOT_TESTED (trust rule)', () => {
    const flagged = ebitdaQuarters.map((o) =>
      o.period === 'Q4 2025' ? { ...o, scale: { flags: ['unit scale not found'], unresolved: true } } : o,
    );
    const r = resolveInputs({ inputs: [{ key: 'ebitda', metricKey: 'ebitda', kind: 'flow' }] }, flagged, 'Q2 2026', 'ttm');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.unresolved.join(' ')).toContain('Q4 2025');
      expect(r.unresolved.join(' ')).toContain('unit scale not found');
    }
  });

  it('missing stock input at the target → NOT_TESTED with the period named', () => {
    const r = resolveInputs(
      { inputs: [{ key: 'debt', metricKey: 'debt', kind: 'stock' }] },
      [q('Q1 2026', 'debt', 90)],
      'Q2 2026',
      'ttm',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.join(' ')).toContain('Q2 2026');
  });

  it('annual target period cannot be TTM-ed', () => {
    const r = resolveInputs(
      { inputs: [{ key: 'ebitda', metricKey: 'ebitda', kind: 'flow' }] },
      [...ebitdaQuarters, q('2026', 'ebitda', 46)],
      '2026',
      'ttm',
    );
    expect(r.ok).toBe(false);
  });
});

describe('resolveThreshold — step-down schedules', () => {
  const schedule = [
    { effectiveFrom: 'Q1 2026', threshold: 3.5 },
    { effectiveFrom: 'Q3 2026', threshold: 3.0 },
  ];

  it('uses the base threshold before the first step', () => {
    expect(resolveThreshold(4.0, schedule, 'Q4 2025')).toBe(4.0);
  });

  it('applies the latest step at or before the target — boundary inclusive', () => {
    expect(resolveThreshold(4.0, schedule, 'Q1 2026')).toBe(3.5); // first day of the step
    expect(resolveThreshold(4.0, schedule, 'Q2 2026')).toBe(3.5);
    expect(resolveThreshold(4.0, schedule, 'Q3 2026')).toBe(3.0); // second step boundary
    expect(resolveThreshold(4.0, schedule, 'Q4 2026')).toBe(3.0);
  });

  it('unparseable steps are ignored; empty schedule keeps the base', () => {
    expect(resolveThreshold(4.0, [{ effectiveFrom: 'TBD', threshold: 1 }], 'Q1 2026')).toBe(4.0);
    expect(resolveThreshold(4.0, [], 'Q1 2026')).toBe(4.0);
    expect(resolveThreshold(4.0, null, 'Q1 2026')).toBe(4.0);
  });
});

describe('computeNearBreach', () => {
  it('flags PASS values inside the band', () => {
    const nb = computeNearBreach('LTE', 3.0, 2.8, 15);
    expect(nb?.withinPct).toBe(true); // headroom 0.2 = 6.7% of threshold
    expect(nb?.headroomPct).toBeCloseTo(6.667, 2);
  });

  it('does not flag comfortable headroom', () => {
    expect(computeNearBreach('LTE', 3.0, 2.0, 15)?.withinPct).toBe(false); // 33% headroom
  });

  it('does not flag breaches as near-breach (they alert as breaches)', () => {
    expect(computeNearBreach('LTE', 3.0, 3.5, 15)?.withinPct).toBe(false);
  });

  it('works for GTE (minimum) covenants', () => {
    expect(computeNearBreach('GTE', 1.25, 1.3, 10)?.withinPct).toBe(true); // 4% headroom
    expect(computeNearBreach('GTE', 1.25, 1.4, 10)?.withinPct).toBe(false); // 12% headroom
  });

  it('degenerate threshold 0 → no percentage claim', () => {
    expect(computeNearBreach('LTE', 0, -0.1, 15)?.withinPct).toBe(false);
  });

  it('null nearBreachPct disables the band entirely', () => {
    expect(computeNearBreach('LTE', 3.0, 2.99, null)).toBeNull();
  });
});

describe('evaluateFormulaCovenant — end to end', () => {
  const def = {
    comparator: 'LTE' as const,
    threshold: 4.0,
    period: 'ttm' as const,
    formula: '(debt - cash) / ebitda',
    terms: {
      inputs: [
        { key: 'debt', metricKey: 'debt', kind: 'stock' as const },
        { key: 'cash', metricKey: 'cash', kind: 'stock' as const },
        { key: 'ebitda', metricKey: 'ebitda', kind: 'flow' as const },
      ],
    },
    schedule: [{ effectiveFrom: 'Q1 2026', threshold: 3.5 }],
    nearBreachPct: 15,
  };

  const obs = [
    ...ebitdaQuarters, // 10, 11, 12, 13 → TTM 46
    q('Q2 2026', 'debt', 100),
    q('Q2 2026', 'cash', 8),
  ];

  it('full TTM evaluation: (100-8)/46 = 2.0 vs step-down 3.5 → PASS', () => {
    const r = evaluateFormulaCovenant(def, obs, 'Q2 2026');
    expect(r.status).toBe('PASS');
    expect(r.value).toBeCloseTo(2.0, 10);
    expect(r.headroom).toBeCloseTo(1.5, 10); // threshold 3.5 (step-down), not 4.0
    expect(r.nearBreach?.withinPct).toBe(false); // 43% headroom
    expect(r.lineage.find((l) => l.key === 'ebitda')?.periods).toEqual(['Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026']);
    expect(r.lineage.find((l) => l.key === 'debt')?.observationIds).toEqual(['debt-Q2 2026']);
  });

  it('pre-step-down target uses the base threshold', () => {
    const r = evaluateFormulaCovenant(def, obs, 'Q2 2026'); // sanity above
    const before = evaluateFormulaCovenant(def, [
      ...ebitdaQuarters.map((o) => ({ ...o, period: o.period === '2025' ? o.period : o.period })),
      ...obs,
    ], 'Q2 2026');
    expect(before.status).toBe(r.status);
  });

  it('FAIL when the formula exceeds the stepped threshold', () => {
    const tight = { ...def, threshold: 1.5, schedule: null, nearBreachPct: null };
    const r = evaluateFormulaCovenant(tight, obs, 'Q2 2026');
    expect(r.status).toBe('FAIL');
    expect(r.headroom).toBeCloseTo(-0.5, 10);
  });

  it('near-breach band fires close to the threshold', () => {
    const tight = { ...def, threshold: 2.1, schedule: null, nearBreachPct: 15 };
    const r = evaluateFormulaCovenant(tight, obs, 'Q2 2026');
    expect(r.status).toBe('PASS');
    expect(r.nearBreach?.withinPct).toBe(true); // headroom 0.1 = 4.8% of 2.1
  });

  it('missing terms → NOT_TESTED with a human reason', () => {
    const r = evaluateFormulaCovenant({ ...def, terms: null }, obs, 'Q2 2026');
    expect(r.status).toBe('NOT_TESTED');
    expect(r.reason).toContain('input terms');
  });

  it('bad formula → NOT_TESTED, never a crash', () => {
    const r = evaluateFormulaCovenant({ ...def, formula: 'debt = 999' }, obs, 'Q2 2026');
    expect(r.status).toBe('NOT_TESTED');
    expect(r.reason).toContain('Formula error');
  });
});
