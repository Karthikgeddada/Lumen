import { describe, it, expect } from 'vitest';
import { parseNumericValue, parseNumericValueDetailed } from './normalizer';

// The 25-case canonical normalizer suite (previously run ad-hoc, now committed).
// Every case mirrors a real-world financial-document form.
describe('parseNumericValue — 25 canonical cases', () => {
  const cases: { raw: string; unit?: string | null; expected: number | null; name: string }[] = [
    { name: 'spelled-out billion with currency', raw: '$4.82 billion', expected: 4.82e9 },
    { name: 'abbreviated attached suffix', raw: '4.82B', expected: 4.82e9 },
    { name: 'lowercase attached million', raw: '1.5m', expected: 1.5e6 },
    { name: 'mn attached', raw: '2,148mn', expected: 2.148e9 },
    { name: 'word after number', raw: '4,820 million', expected: 4.82e9 },
    { name: 'word after number, billions', raw: '1.2 billion', expected: 1.2e9 },
    { name: 'unit field carries scale', raw: '4,820', unit: 'millions USD', expected: 4.82e9 },
    { name: 'unit field single word', raw: '4820', unit: 'billions', expected: 4.82e12 },
    { name: 'trillion with symbol', raw: '$1.2 trillion', expected: 1.2e12 },
    { name: 'plain US grouping', raw: '1,234', expected: 1234 },
    { name: 'US grouping multiple groups', raw: '1,234,567', expected: 1234567 },
    { name: 'accounting parentheses negative', raw: '(1,234)', expected: -1234 },
    { name: 'accounting parentheses negative, decimal', raw: '(2,148.50)', expected: -2148.5 },
    { name: 'leading minus negative', raw: '-48.2', expected: -48.2 },
    { name: 'EU decimal comma', raw: '4,82', expected: 4.82 },
    { name: 'EU full format', raw: '1.234,56', expected: 1234.56 },
    { name: 'mixed EU with word scale', raw: '4,82 billion', expected: 4.82e9 },
    { name: 'ratio passes through', raw: '4.50x', expected: 4.5 },
    { name: 'percentage passes through', raw: '38.2%', expected: 38.2 },
    { name: 'percentage with word', raw: '38.2 percent', expected: 38.2 },
    { name: 'bare number no unit', raw: '4820', expected: 4820 },
    { name: 'decimal', raw: '48.2', expected: 48.2 },
    { name: 'nbsp digit grouping', raw: '1\u00a0234', expected: 1234 },
    { name: 'bn word after number', raw: '2.5bn', expected: 2.5e9 },
    { name: 'non-numeric text', raw: 'not disclosed', expected: null },
  ];

  it.each(cases)('$name', ({ raw, unit, expected }) => {
    expect(parseNumericValue(raw, unit)).toBe(expected);
  });

  it('covers all 25 cases', () => {
    expect(cases.length).toBe(25);
  });
});

describe('parseNumericValueDetailed — scale precedence plumbing', () => {
  it('reports suffixApplied for "4.82 billion"', () => {
    const d = parseNumericValueDetailed('4.82 billion', 'USD')!;
    expect(d.suffixApplied).toBe(true);
    expect(d.unitApplied).toBe(false);
    expect(d.value).toBe(4.82e9);
  });

  it('reports unitApplied when only the unit carries scale', () => {
    const d = parseNumericValueDetailed('4820', 'millions USD')!;
    expect(d.suffixApplied).toBe(false);
    expect(d.unitApplied).toBe(true);
    expect(d.value).toBe(4.82e9);
  });

  it('reports neither when the value is bare', () => {
    const d = parseNumericValueDetailed('4,820', 'USD')!;
    expect(d.suffixApplied).toBe(false);
    expect(d.unitApplied).toBe(false);
    expect(d.value).toBe(4820);
  });

  it('flags ratios as non-scalable', () => {
    const d = parseNumericValueDetailed('4.50x', 'x')!;
    expect(d.nonScalable).toBe(true);
    expect(d.nonScalableReason).toBe('multiple/ratio');
    expect(d.value).toBe(4.5);
  });

  it('flags percentages as non-scalable', () => {
    const d = parseNumericValueDetailed('38.2%', '%')!;
    expect(d.nonScalable).toBe(true);
    expect(d.value).toBe(38.2);
  });

  it('flags per-share figures as non-scalable', () => {
    const d = parseNumericValueDetailed('2.14', 'USD per share')!;
    expect(d.nonScalable).toBe(true);
    expect(d.nonScalableReason).toBe('per-share');
    expect(d.value).toBe(2.14);
  });
});