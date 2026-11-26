import { describe, expect, it } from 'vitest';
import { applyScaleResolution, evaluateCovenant, ingestConflict, isFreshBreach, sameNumber, scaleFlags, scaleUnresolved } from './trust';

// TRUST RULE: a figure with unresolved scale flags must never be verifiable,
// ingestible, or testable against a covenant — at any layer.

describe('scaleUnresolved (review + ingest gate)', () => {
  it('no scale at all is not unresolved', () => {
    expect(scaleUnresolved(null)).toBe(false);
    expect(scaleUnresolved(undefined)).toBe(false);
  });

  it('scale without flags is not unresolved', () => {
    expect(scaleUnresolved({ multiplier: 1000, appliedFrom: 'table_header' })).toBe(false);
  });

  it('empty flags are not unresolved', () => {
    expect(scaleUnresolved({ multiplier: null, flags: [] })).toBe(false);
  });

  it('flags without resolution are unresolved (scale not found)', () => {
    expect(scaleUnresolved({ multiplier: null, flags: ['scale not found'] })).toBe(true);
  });

  it('conflicting-scales flags are unresolved', () => {
    expect(scaleUnresolved({ multiplier: 1000, flags: ['conflicting scales: table says thousands, page says millions'] })).toBe(true);
  });

  it('flags with an analyst resolution are resolved', () => {
    expect(
      scaleUnresolved({
        multiplier: 1000,
        flags: ['scale not found'],
        resolution: { by: 'user-1', at: '2026-11-26T00:00:00Z', multiplier: 1000 },
      }),
    ).toBe(false);
  });

  it('explicit unresolved=true wins over empty flags', () => {
    expect(scaleUnresolved({ flags: [], unresolved: true })).toBe(true);
  });

  it('explicit unresolved=false overrides legacy flags (post-resolution shape)', () => {
    expect(scaleUnresolved({ flags: ['scale not found'], unresolved: false, resolution: null })).toBe(false);
  });

  it('non-object scale is not unresolved', () => {
    expect(scaleUnresolved('millions')).toBe(false);
    expect(scaleUnresolved(1000)).toBe(false);
  });

  it('scaleFlags lists the detected flags for the 422 response', () => {
    expect(scaleFlags({ flags: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(scaleFlags(null)).toEqual([]);
    expect(scaleFlags({ flags: 'nope' })).toEqual([]);
  });
});

describe('applyScaleResolution (review gate resolution)', () => {
  it('confirm keeps the existing multiplier and records the analyst', () => {
    const out = applyScaleResolution(
      { multiplier: 1000, appliedFrom: 'table_header', flags: ['scale not found'] },
      { confirm: true },
      'user-1',
    );
    expect(out.multiplier).toBe(1000);
    expect(out.appliedFrom).toBe('table_header');
    expect(out.flags).toEqual(['scale not found']); // audit trail stays
    expect(out.resolution?.by).toBe('user-1');
    expect(out.resolution?.multiplier).toBeNull(); // nothing new applied
    expect(out.unresolved).toBe(false);
    expect(scaleUnresolved(out)).toBe(false);
  });

  it('confirm on a null multiplier keeps null (figure as shown, no rescaling)', () => {
    const out = applyScaleResolution({ multiplier: null, flags: ['scale not found'] }, { confirm: true }, 'u');
    expect(out.multiplier).toBeNull();
    expect(scaleUnresolved(out)).toBe(false);
  });

  it('a supplied multiplier overrides and is stored as the chosen scale', () => {
    const out = applyScaleResolution(
      { multiplier: null, flags: ['scale not found'] },
      { multiplier: 1000, label: 'thousands' },
      'user-2',
    );
    expect(out.multiplier).toBe(1000); // ingest will apply 4,820 x 1000
    expect(out.resolution?.multiplier).toBe(1000);
    expect(out.resolution?.label).toBe('thousands');
    expect(scaleUnresolved(out)).toBe(false);
  });

  it('a supplied multiplier can correct a wrong header scale', () => {
    const out = applyScaleResolution({ multiplier: 1e6, flags: ['conflicting scales'] }, { multiplier: 1000 }, 'u');
    expect(out.multiplier).toBe(1000);
    expect(out.resolution?.multiplier).toBe(1000);
  });

  it('works on a result that has no scale object yet', () => {
    const out = applyScaleResolution(null, { multiplier: 1e6, note: 'annual report states $ in millions' }, 'u');
    expect(out.multiplier).toBe(1e6);
    expect(out.resolution?.by).toBe('u');
    expect(out.resolution?.note).toBe('annual report states $ in millions');
    expect(scaleUnresolved(out)).toBe(false);
  });

  it('records the resolution timestamp', () => {
    const out = applyScaleResolution({ flags: ['scale not found'] }, { confirm: true }, 'u');
    expect(new Date(out.resolution!.at).getTime()).not.toBeNaN();
  });
});

describe('evaluateCovenant (covenant gate)', () => {
  const def = { metricKey: 'net_leverage', comparator: 'LTE' as const, threshold: 4.5 };

  it('PASS with correct headroom (LTE)', () => {
    const r = evaluateCovenant(def, { value: 4.0, scale: null });
    expect(r).toEqual({ status: 'PASS', value: 4.0, headroom: 0.5, reason: null });
  });

  it('FAIL with negative headroom (LTE)', () => {
    const r = evaluateCovenant(def, { value: 4.82, scale: { multiplier: 1 } });
    expect(r.status).toBe('FAIL');
    expect(r.headroom).toBeCloseTo(-0.32);
    expect(r.reason).toBeNull();
  });

  it('GTE passes when the value is above the threshold', () => {
    const r = evaluateCovenant({ metricKey: 'liquidity_usd', comparator: 'GTE' as const, threshold: 10 }, { value: 12, scale: null });
    expect(r.status).toBe('PASS');
    expect(r.headroom).toBe(2);
  });

  it('no observation -> NOT_TESTED with a reason naming the metric', () => {
    const r = evaluateCovenant(def, null);
    expect(r.status).toBe('NOT_TESTED');
    expect(r.value).toBeNull();
    expect(r.headroom).toBeNull();
    expect(r.reason).toContain('net_leverage');
  });

  it('TRUST RULE: unresolved scale on the observation -> NOT_TESTED, flags in the reason, no value stored', () => {
    const r = evaluateCovenant(def, {
      value: 4.0,
      scale: { multiplier: null, flags: ['scale not found', 'conflicting scales: page says millions'] },
    });
    expect(r.status).toBe('NOT_TESTED');
    expect(r.value).toBeNull();
    expect(r.headroom).toBeNull();
    expect(r.reason).toContain('scale not found');
    expect(r.reason).toContain('conflicting scales: page says millions');
    expect(r.reason).toContain('net_leverage');
  });

  it('a resolved-flagged observation is tested normally', () => {
    const r = evaluateCovenant(def, {
      value: 4.0,
      scale: { multiplier: 1000, flags: ['scale not found'], resolution: { by: 'u', at: 't', multiplier: 1000 } },
    });
    expect(r.status).toBe('PASS');
    expect(r.value).toBe(4.0);
  });

  it('legacy flagged observation (pre-resolution era, no unresolved key) is NOT_TESTED', () => {
    const r = evaluateCovenant(def, { value: 3.0, scale: { multiplier: null, flags: ['scale not found'] } });
    expect(r.status).toBe('NOT_TESTED');
    expect(r.reason).toContain('unresolved scale flags');
  });

  it('a resolved-flagged observation passing a wrong value still FAILs honestly (no trust escape hatch)', () => {
    const r = evaluateCovenant(def, {
      value: 5.2,
      scale: { multiplier: null, flags: ['scale not found'], resolution: { by: 'u', at: 't', multiplier: null } },
    });
    expect(r.status).toBe('FAIL');
  });
});

describe('ingest gate refuses exactly what scaleUnresolved rejects', () => {
  it('unresolved flagged result is refused; resolved, clean and null scale pass', () => {
    const refused = (scale: unknown) => scaleUnresolved(scale);
    expect(refused({ multiplier: null, flags: ['scale not found'] })).toBe(true); // refused
    expect(
      refused({ flags: ['scale not found'], resolution: { by: 'u', at: 't', multiplier: null } }),
    ).toBe(false); // resolved -> ingested
    expect(refused(null)).toBe(false); // no flags -> ingested
    expect(refused({ multiplier: 1000, appliedFrom: 'table_header' })).toBe(false); // clean header scale -> ingested
  });
});

describe('sameNumber + ingestConflict (ingest overwrite guard)', () => {
  it('exactly equal values are the same figure', () => {
    expect(sameNumber(4820000, 4820000)).toBe(true);
    expect(sameNumber(1.31, 1.31)).toBe(true);
  });

  it('float parse noise within one part in a billion is the same figure', () => {
    expect(sameNumber(4820000, 4820000 + 1e-6)).toBe(true); // tolerance ≈ 4.8e-3 at this magnitude
  });

  it('materially different values are a conflict — never overwritten silently', () => {
    expect(sameNumber(4820000, 9860)).toBe(false);
    expect(sameNumber(4820000, 4820001)).toBe(false);
  });

  it('ingestConflict reports entity, metric, period, existing vs new', () => {
    const c = ingestConflict(
      'Halden Industrial', 'revenue', 'Q3 2026',
      { value: 461000000, derivation: 'REPORTED', sourceDocumentId: 'doc-old' },
      { value: 4820000, sourceDocumentId: 'doc-new' },
    );
    expect(c).toEqual({
      entity: 'Halden Industrial',
      metric: 'revenue',
      period: 'Q3 2026',
      existingValue: 461000000,
      existingDerivation: 'REPORTED',
      existingSourceDocumentId: 'doc-old',
      newValue: 4820000,
      newSourceDocumentId: 'doc-new',
    });
  });
});

describe('isFreshBreach (NOT_TESTED must not mask a known breach)', () => {
  it('no previous result is a fresh breach', () => {
    expect(isFreshBreach(null)).toBe(true);
  });

  it('previous FAIL is a known breach — not fresh', () => {
    expect(isFreshBreach({ status: 'FAIL' })).toBe(false);
  });

  it('FAIL -> NOT_TESTED -> FAIL is the same known breach — not fresh', () => {
    expect(isFreshBreach({ status: 'NOT_TESTED', previousStatus: 'FAIL' })).toBe(false);
  });

  it('PASS -> NOT_TESTED -> FAIL IS fresh (last real status was PASS)', () => {
    expect(isFreshBreach({ status: 'NOT_TESTED', previousStatus: 'PASS' })).toBe(true);
  });

  it('NOT_TESTED with no recorded previous status is fresh', () => {
    expect(isFreshBreach({ status: 'NOT_TESTED', previousStatus: null })).toBe(true);
  });

  it('WAIVED -> FAIL is fresh', () => {
    expect(isFreshBreach({ status: 'WAIVED', previousStatus: 'FAIL' })).toBe(true);
  });
});
