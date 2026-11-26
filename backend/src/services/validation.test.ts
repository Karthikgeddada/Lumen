// Post-extraction validation tests — spec C1: component sums, balance-sheet
// identity, unit/scale consistency, QoQ outliers.
import { describe, expect, it } from 'vitest';
import { validateFigures, Figure, ValidationConfig } from './validation';

const f = (fieldKey: string, value: number | null, extra: Partial<Figure> = {}): Figure => ({
  fieldKey,
  value,
  unit: 'USD',
  scaleMultiplier: null,
  period: 'Q2 2026',
  ...extra,
});

const noPrev = () => null;

describe('component sums', () => {
  const config: ValidationConfig = {
    componentSums: [{ label: 'Segments', total: 'revenue', components: ['seg_a', 'seg_b'] }],
  };

  it('flags the total and each component when the sum is off', () => {
    const flags = validateFigures(config, [f('revenue', 100), f('seg_a', 40), f('seg_b', 50)], noPrev);
    expect(flags.get('revenue')?.[0]).toContain('Segments');
    expect(flags.get('revenue')?.[0]).toContain('90');
    expect(flags.get('seg_a')?.length).toBe(1);
    expect(flags.get('seg_b')?.length).toBe(1);
  });

  it('within tolerance (default 0.5%) → no flag', () => {
    // 40 + 60.3 = 100.3 vs 100 → 0.3% off, inside the default 0.5% band
    const flags = validateFigures(config, [f('revenue', 100), f('seg_a', 40), f('seg_b', 60.3)], noPrev);
    expect(flags.size).toBe(0);
  });

  it('custom tolerance respected', () => {
    // 40 + 60.06 = 100.06 vs 100 → 0.06% off — fine at the default 0.5%, but
    // a strict 0.01% tolerance must flag it
    const strict: ValidationConfig = {
      componentSums: [{ total: 'revenue', components: ['seg_a', 'seg_b'], tolerancePct: 0.01 }],
    };
    expect(validateFigures(strict, [f('revenue', 100), f('seg_a', 40), f('seg_b', 60.06)], noPrev).size).toBe(3);
  });

  it('missing fields → check skipped, never a false flag', () => {
    const flags = validateFigures(config, [f('revenue', 100), f('seg_a', 40)], noPrev);
    expect(flags.size).toBe(0);
  });

  it('null-valued figures are ignored', () => {
    const flags = validateFigures(config, [f('revenue', 100), f('seg_a', 40), f('seg_b', null)], noPrev);
    expect(flags.size).toBe(0);
  });
});

describe('balance-sheet identity', () => {
  const config: ValidationConfig = {
    balanceSheets: [{ assets: 'total_assets', liabilities: ['debt', 'payables'], equity: ['equity'] }],
  };

  it('flags when assets ≠ liabilities + equity', () => {
    const flags = validateFigures(
      config,
      [f('total_assets', 100), f('debt', 60), f('payables', 20), f('equity', 15)],
      noPrev,
    );
    expect(flags.get('total_assets')?.[0]).toContain('does not balance');
    expect(flags.get('debt')?.length).toBe(1);
    expect(flags.get('payables')?.length).toBe(1);
    expect(flags.get('equity')?.length).toBe(1);
  });

  it('balanced → no flag', () => {
    const flags = validateFigures(
      config,
      [f('total_assets', 100.2), f('debt', 60), f('payables', 20), f('equity', 20)],
      noPrev,
    );
    expect(flags.size).toBe(0);
  });
});

describe('unit / scale consistency', () => {
  it('same field with different units → flagged', () => {
    const flags = validateFigures(
      {},
      [f('revenue', 100, { unit: 'USD' }), f('revenue', 4.8, { unit: 'EUR', period: 'Q1 2026' })],
      noPrev,
    );
    expect(flags.get('revenue')?.[0]).toContain('Unit inconsistent');
  });

  it('same unit but different scale multiplier → flagged', () => {
    const flags = validateFigures(
      {},
      [f('revenue', 100, { scaleMultiplier: 1000 }), f('revenue', 4.8, { scaleMultiplier: 1000000, period: 'Q1 2026' })],
      noPrev,
    );
    expect(flags.get('revenue')?.[0]).toContain('Scale multiplier inconsistent');
  });

  it('same unit and multiplier across periods → no flag', () => {
    const flags = validateFigures(
      {},
      [f('revenue', 100), f('revenue', 110, { period: 'Q1 2026' })],
      noPrev,
    );
    expect(flags.size).toBe(0);
  });
});

describe('QoQ outliers', () => {
  it('flags changes beyond the configured %', () => {
    const flags = validateFigures(
      { qoqOutlierPct: 50 },
      [f('revenue', 180, { period: 'Q2 2026' })],
      () => 100, // previous quarter stored as 100
    );
    expect(flags.get('revenue')?.[0]).toContain('QoQ change of 80.0%');
  });

  it('real-but-large growth inside the band → no flag', () => {
    expect(validateFigures({ qoqOutlierPct: 50 }, [f('revenue', 140)], () => 100).size).toBe(0);
  });

  it('unconfigured → the check is off (defaults matter: growth is real)', () => {
    expect(validateFigures({}, [f('revenue', 500)], () => 100).size).toBe(0);
  });

  it('previous value of exactly 0 → skipped (division by zero)', () => {
    expect(validateFigures({ qoqOutlierPct: 50 }, [f('revenue', 500)], () => 0).size).toBe(0);
  });

  it('annual periods have no previous quarter → skipped', () => {
    expect(validateFigures({ qoqOutlierPct: 1 }, [f('revenue', 500, { period: '2026' })], () => 100).size).toBe(0);
  });
});
