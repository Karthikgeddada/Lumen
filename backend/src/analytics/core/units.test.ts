import { describe, expect, it } from 'vitest';
import {
  parseUnit,
  isUnitUnresolved,
  normalizeValue,
  canAggregateUnits,
  chooseDisplayUnit,
} from './units';

describe('parseUnit — every unit variant in the seed and extraction/covenant templates', () => {
  it('seed units', () => {
    expect(parseUnit('USD billions')).toEqual({
      dimension: 'currency', currency: 'USD', scale: 1e9, unitUnresolved: false, label: 'USD billions',
    });
    expect(parseUnit('USD millions')).toEqual({
      dimension: 'currency', currency: 'USD', scale: 1e6, unitUnresolved: false, label: 'USD millions',
    });
    expect(parseUnit('%')).toMatchObject({ dimension: 'percent', unitUnresolved: false, label: 'percent' });
  });

  it('covenant units (x, %, USD, days)', () => {
    expect(parseUnit('x')).toMatchObject({ dimension: 'multiple', unitUnresolved: false });
    expect(parseUnit('USD')).toEqual({
      dimension: 'currency', currency: 'USD', scale: null, unitUnresolved: false, label: 'USD',
    });
    expect(parseUnit('days')).toMatchObject({ dimension: 'count', unitUnresolved: false, label: 'days' });
  });

  it('scale-header notations from scale.ts', () => {
    expect(parseUnit('$ in 000')).toMatchObject({ dimension: 'currency', currency: 'USD', scale: 1e3 });
    expect(parseUnit('in 000s')).toMatchObject({ dimension: 'currency', currency: null, scale: 1e3 });
    expect(parseUnit('000s')).toMatchObject({ scale: 1e3 });
    expect(parseUnit('$ millions')).toMatchObject({ dimension: 'currency', currency: 'USD', scale: 1e6 });
    expect(parseUnit('usd bn')).toMatchObject({ dimension: 'currency', currency: 'USD', scale: 1e9 });
    expect(parseUnit('$m')).toMatchObject({ dimension: 'currency', currency: 'USD', scale: 1e6 });
    expect(parseUnit('$k')).toMatchObject({ dimension: 'currency', currency: 'USD', scale: 1e3 });
  });

  it('other currencies', () => {
    expect(parseUnit('EUR millions')).toMatchObject({ currency: 'EUR', scale: 1e6 });
    expect(parseUnit('€')).toMatchObject({ currency: 'EUR', scale: null });
    expect(parseUnit('GBP')).toMatchObject({ currency: 'GBP' });
  });

  it('percent/multiple/count word forms', () => {
    expect(parseUnit('percent')).toMatchObject({ dimension: 'percent' });
    expect(parseUnit('pct')).toMatchObject({ dimension: 'percent' });
    expect(parseUnit('percentage')).toMatchObject({ dimension: 'percent' });
    expect(parseUnit('×')).toMatchObject({ dimension: 'multiple' });
    expect(parseUnit('times')).toMatchObject({ dimension: 'multiple' });
    expect(parseUnit('employees')).toMatchObject({ dimension: 'count' });
    expect(parseUnit('customers')).toMatchObject({ dimension: 'count' });
  });

  it('scale word without currency marker parses but cannot mix with named currencies', () => {
    const millions = parseUnit('millions');
    expect(millions).toMatchObject({ dimension: 'currency', currency: null, scale: 1e6, unitUnresolved: false });
    expect(canAggregateUnits(millions, parseUnit('USD millions'))).toBe(false);
  });
});

describe('unit resolution (TRUST RULE)', () => {
  it('unknowns are flagged, never guessed', () => {
    for (const bad of ['', '   ', null, undefined, 'foo', 'widgets', 'kpi', 'ratio 42', 'USD %']) {
      expect(parseUnit(bad).unitUnresolved, `${JSON.stringify(bad)} should be unresolved`).toBe(true);
      if (bad != null && String(bad).trim()) expect(parseUnit(bad).dimension).toBe('unknown');
    }
    expect(isUnitUnresolved('')).toBe(true);
    expect(isUnitUnresolved('USD millions')).toBe(false);
  });

  it('normalizeValue scales currency to base units, leaves others', () => {
    expect(normalizeValue(4.82, 'USD billions')).toEqual({
      value: 4_820_000_000,
      unit: expect.objectContaining({ dimension: 'currency', currency: 'USD', scale: 1e9 }),
    });
    expect(normalizeValue(4.82, 'USD millions').value).toBe(4_820_000);
    expect(normalizeValue(4_820, '$ in 000').value).toBe(4_820_000);
    expect(normalizeValue(23.5, '%').value).toBe(23.5);
    expect(normalizeValue(3.2, 'x').value).toBe(3.2);
    expect(normalizeValue(90, 'days').value).toBe(90);
  });

  it('unresolved values pass through untouched and flagged', () => {
    const r = normalizeValue(123, '???');
    expect(r).toEqual({ value: 123, unit: expect.objectContaining({ unitUnresolved: true }) });
  });
});

describe('cross-metric aggregation', () => {
  it('only same dimension + same named currency aggregate', () => {
    const usdM = parseUnit('USD millions');
    const usdB = parseUnit('USD billions');
    const pct = parseUnit('%');
    const x = parseUnit('x');
    const days = parseUnit('days');
    const eurM = parseUnit('EUR millions');
    const unknown = parseUnit('mystery');

    expect(canAggregateUnits(usdM, usdB)).toBe(true); // scales normalize away
    expect(canAggregateUnits(usdM, eurM)).toBe(false); // different currency
    expect(canAggregateUnits(usdM, pct)).toBe(false); // different dimension
    expect(canAggregateUnits(pct, pct)).toBe(true);
    expect(canAggregateUnits(x, x)).toBe(true);
    expect(canAggregateUnits(days, parseUnit('days'))).toBe(true);
    expect(canAggregateUnits(usdM, unknown)).toBe(false); // TRUST RULE
    expect(canAggregateUnits(unknown, unknown)).toBe(false);
  });

  it('mixed scales normalize to comparable base values', () => {
    const a = normalizeValue(2, 'USD billions');
    const b = normalizeValue(1_500, 'USD millions');
    expect(a.value).toBe(2e9);
    expect(b.value).toBe(1.5e9);
    expect(a.value).toBeGreaterThan(b.value);
  });
});

describe('chooseDisplayUnit', () => {
  it('picks friendly magnitudes for currency', () => {
    const usd = parseUnit('USD millions');
    expect(chooseDisplayUnit(usd, 4.82e9)).toEqual({ label: 'USD billions', divideBy: 1e9 });
    expect(chooseDisplayUnit(usd, 4.82e6)).toEqual({ label: 'USD millions', divideBy: 1e6 });
    expect(chooseDisplayUnit(usd, 4_820)).toEqual({ label: 'USD thousands', divideBy: 1e3 });
    expect(chooseDisplayUnit(usd, 482)).toEqual({ label: 'USD', divideBy: 1 });
    expect(chooseDisplayUnit(usd, 0)).toEqual({ label: 'USD', divideBy: 1 });
  });

  it('leaves non-currency and unresolved units alone', () => {
    expect(chooseDisplayUnit(parseUnit('%'), 99)).toEqual({ label: 'percent', divideBy: 1 });
    expect(chooseDisplayUnit(parseUnit('x'), 99)).toEqual({ label: 'multiple', divideBy: 1 });
    expect(chooseDisplayUnit(parseUnit('???'), 99)).toEqual({ label: '—', divideBy: 1 });
  });
});
