// Period model tests — spec C4: explicit parser, ordinal ordering, year
// boundaries ("Q4 2025" vs "Q1 2026"), TTM windows.
import { describe, expect, it } from 'vitest';
import {
  parsePeriod,
  periodLabel,
  comparePeriods,
  previousQuarter,
  trailingFourQuarters,
  isNextQuarter,
} from './periods';

describe('parsePeriod', () => {
  it('parses quarters and years', () => {
    expect(parsePeriod('Q1 2026')).toEqual({ kind: 'quarter', year: 2026, quarter: 1, ordinal: 2026 * 4 });
    expect(parsePeriod('Q3 2026')?.ordinal).toBe(2026 * 4 + 2);
    expect(parsePeriod('2026')).toEqual({ kind: 'year', year: 2026, ordinal: 2026 * 4 });
  });

  it('tolerates separators and case, rejects everything else', () => {
    expect(parsePeriod('q3-2026')).toMatchObject({ kind: 'quarter', quarter: 3 });
    expect(parsePeriod('  Q2 2026 ')).toMatchObject({ kind: 'quarter', quarter: 2 });
    expect(parsePeriod('Q5 2026')).toBeNull();
    expect(parsePeriod('Q1 26')).toBeNull();
    expect(parsePeriod("Q1'26")).toBeNull();
    expect(parsePeriod('Q1')).toBeNull();
    expect(parsePeriod('')).toBeNull();
    expect(parsePeriod(null)).toBeNull();
    expect(parsePeriod('TBD')).toBeNull();
  });

  it('rejects out-of-range years', () => {
    expect(parsePeriod('Q1 1899')).toBeNull();
    expect(parsePeriod('Q1 2101')).toBeNull();
    expect(parsePeriod('Q4 2100')).toMatchObject({ kind: 'quarter', quarter: 4 }); // boundary inclusive
  });
});

it('periodLabel round-trips', () => {
  expect(periodLabel(parsePeriod('Q3 2026')!)).toBe('Q3 2026');
  expect(periodLabel(parsePeriod('2026')!)).toBe('2026');
});

describe('ordering', () => {
  it('compares across year boundaries — the lexical-sort trap', () => {
    expect(comparePeriods('Q4 2025', 'Q1 2026')).toBeLessThan(0);
    expect(comparePeriods('Q1 2026', 'Q4 2025')).toBeGreaterThan(0);
    expect(comparePeriods('Q1 2026', 'Q1 2026')).toBe(0);
    // lexical string sort would claim "Q2 2026" < "Q4 2025"
    expect('Q2 2026' < 'Q4 2025').toBe(true);
    expect(comparePeriods('Q2 2026', 'Q4 2025')).toBeGreaterThan(0);
  });

  it('orders a fiscal year correctly', () => {
    const periods = ['Q2 2026', 'Q4 2025', 'Q1 2026', 'Q3 2025', 'Q3 2026'];
    expect([...periods].sort(comparePeriods)).toEqual(['Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026']);
  });

  it('years sort against quarters by their first quarter', () => {
    expect(comparePeriods('2026', 'Q4 2025')).toBeGreaterThan(0);
    expect(comparePeriods('2026', 'Q1 2026')).toBe(0);
    expect(comparePeriods('2026', 'Q2 2026')).toBeLessThan(0);
  });

  it('unparseable periods sort last, deterministically', () => {
    expect(comparePeriods('TBD', 'Q1 2026')).toBeGreaterThan(0);
    expect(comparePeriods('Q1 2026', 'TBD')).toBeLessThan(0);
    expect(comparePeriods('AAA', 'BBB')).toBeLessThan(0);
  });
});

describe('quarter arithmetic', () => {
  it('previousQuarter wraps the year', () => {
    expect(previousQuarter('Q1 2026')).toBe('Q4 2025');
    expect(previousQuarter('Q3 2026')).toBe('Q2 2026');
    expect(previousQuarter('2026')).toBeNull(); // annual has no previous quarter
    expect(previousQuarter('TBD')).toBeNull();
  });

  it('trailingFourQuarters is the TTM window, oldest first', () => {
    expect(trailingFourQuarters('Q2 2026')).toEqual(['Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026']);
    expect(trailingFourQuarters('Q1 2026')).toEqual(['Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026']);
    expect(trailingFourQuarters('2026')).toBeNull(); // TTM only defined on quarters
  });

  it('isNextQuarter detects consecutiveness', () => {
    expect(isNextQuarter('Q4 2025', 'Q1 2026')).toBe(true);
    expect(isNextQuarter('Q4 2025', 'Q2 2026')).toBe(false); // the gap case
    expect(isNextQuarter('Q1 2026', 'Q4 2025')).toBe(false);
    expect(isNextQuarter('2025', 'Q1 2026')).toBe(false);
  });
});
