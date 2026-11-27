// Finance formatter tests — the single source every page's figures flow
// through. Pure module → plain node tests.
import { describe, expect, it } from 'vitest';
import {
  compactNumber,
  formatCount,
  formatDeltaPct,
  formatHeadroom,
  formatNumber,
  formatValue,
  unitSuffix,
} from './format';

describe('formatValue', () => {
  it('renders unit suffixes', () => {
    expect(formatValue(456, 'USD millions')).toBe('$456M');
    expect(formatValue(4.23, '%')).toBe('4.2%');
    expect(formatValue(0.71, 'x')).toBe('0.71x');
    expect(formatValue(12, 'persons')).toBe('12');
  });

  it('parenthesizes negatives by finance convention', () => {
    expect(formatValue(-1234.5, null)).toBe('(1,235)');
    expect(formatValue(-1234.5, null, { parentheses: false })).toBe('-1,235');
    expect(formatValue(-4.2, '%')).toBe('(4.2%)');
  });

  it('signs deltas only when asked', () => {
    expect(formatValue(2.79, 'x', { signed: true })).toBe('+2.79x');
    expect(formatValue(2.79, 'x', { signed: false })).toBe('2.79x');
  });

  it('renders missing values as an em dash', () => {
    expect(formatValue(null, 'USD millions')).toBe('—');
    expect(formatValue(undefined, null)).toBe('—');
    expect(formatValue(Number.NaN, null)).toBe('—');
  });

  it('compacts without double magnitude suffixes', () => {
    expect(formatValue(1234567, null, { compact: true })).toBe('1.2M');
    expect(formatValue(4.2, '%', { compact: true })).toBe('4.2%');
    expect(formatValue(0.71, 'x', { compact: true })).toBe('0.71x');
  });

  it('groups thousands', () => {
    expect(formatNumber(1234567, 0)).toBe('1,234,567');
    expect(formatNumber(1234.5, 1)).toBe('1,234.5');
  });
});

describe('compactNumber', () => {
  it('keeps small values plain', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(999)).toBe('999');
    expect(compactNumber(-42)).toBe('-42');
  });

  it('compacts magnitudes', () => {
    expect(compactNumber(1234)).toBe('1.2K');
    expect(compactNumber(150000)).toBe('150K');
    expect(compactNumber(2500000000)).toBe('2.5B');
    expect(compactNumber(1e12)).toBe('1.0T');
  });
});

describe('unitSuffix', () => {
  it('maps stated units to suffixes', () => {
    expect(unitSuffix('%')).toBe('%');
    expect(unitSuffix('percentage points')).toBe('%');
    expect(unitSuffix('pp change')).toBe('%');
    expect(unitSuffix('net leverage / x')).toBe('x');
    expect(unitSuffix('coverage ratio')).toBe('x');
    expect(unitSuffix('USD millions')).toBe('M');
    expect(unitSuffix('USD thousands')).toBe('K');
    expect(unitSuffix('USD billions')).toBe('B');
    expect(unitSuffix('persons')).toBe('');
    expect(unitSuffix(null)).toBe('');
  });
});

describe('finance helpers', () => {
  it('formatHeadroom signs explicitly without parentheses', () => {
    expect(formatHeadroom(2.79, 'x')).toBe('+2.79x');
    expect(formatHeadroom(-0.1, 'x')).toBe('-0.10x');
    expect(formatHeadroom(null, 'x')).toBe('—');
  });

  it('formatDeltaPct signs percent changes', () => {
    expect(formatDeltaPct(4.23)).toBe('+4.2%');
    expect(formatDeltaPct(-1.14)).toBe('-1.1%');
    expect(formatDeltaPct(null)).toBe('—');
  });

  it('formatCount renders grouped integers', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).toBe('—');
  });
});
