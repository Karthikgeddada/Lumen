import { describe, it, expect } from 'vitest';
import { parseNumericValueDetailed } from './normalizer';
import { decideScale, detectScaleInText, ScaleCandidate } from './scale';

// Full pipeline: raw value + candidates → decision → final number, exactly as
// the ingest path applies it.
function finalValue(
  raw: string,
  unit: string | null,
  candidates: { table?: ScaleCandidate; page?: ScaleCandidate; document?: ScaleCandidate },
): { value: number | null; decision: ReturnType<typeof decideScale> } {
  const d = parseNumericValueDetailed(raw, unit);
  const decision = decideScale({
    raw,
    unit,
    suffixApplied: d?.suffixApplied ?? false,
    unitApplied: d?.unitApplied ?? false,
    nonScalable: d?.nonScalable ?? false,
    nonScalableReason: d?.nonScalableReason ?? null,
    ...candidates,
  });
  const parsed = d?.value ?? null;
  const value = parsed != null && decision.multiplier != null ? parsed * decision.multiplier : parsed;
  return { value, decision };
}

const table = (label: string, multiplier: number, headerText: string): ScaleCandidate => ({
  multiplier, label, headerText, from: 'table', page: 3, tableId: 't1', sheet: null,
});

describe('detectScaleInText — header patterns', () => {
  it.each([
    ['IN THOUSANDS', 1e3, 'thousands'],
    ['in thousands, except per share data', 1e3, 'thousands'],
    ['(in millions)', 1e6, 'millions'],
    ['$ millions', 1e6, 'millions'],
    ['in $ billions', 1e9, 'billions'],
    ['USD millions', 1e6, 'millions'],
    ["(000s)", 1e3, "'000s"],
    ['$ in 000', 1e3, "'000s"],
    ["£'000", 1e3, "'000s"],
    ['trillions of dollars', 1e12, 'trillions'],
  ])('%s → ×%s (%s)', (text, multiplier, label) => {
    const det = detectScaleInText(text)!;
    expect(det.multiplier).toBe(multiplier);
    expect(det.label).toBe(label);
  });

  it('never matches a plain number like 4,000 or 2000', () => {
    expect(detectScaleInText('Revenue 4,000 2000 582')).toBeNull();
    expect(detectScaleInText('1,234.56')).toBeNull();
  });

  it('returns null for text without a scale', () => {
    expect(detectScaleInText('Consolidated Statements of Operations')).toBeNull();
    expect(detectScaleInText('')).toBeNull();
    expect(detectScaleInText(null)).toBeNull();
  });
});

describe('decideScale — the 12 mandated scale cases', () => {
  const page = (label: string, multiplier: number, headerText: string): ScaleCandidate => ({
    multiplier, label, headerText, from: 'page', page: 3, tableId: null, sheet: null,
  });
  const doc = (label: string, multiplier: number, headerText: string): ScaleCandidate => ({
    multiplier, label, headerText, from: 'document', page: 1, tableId: null, sheet: null,
  });

  it('1. thousands header applies ×1,000 once', () => {
    const { value, decision } = finalValue('4,820', 'USD', { page: page('thousands', 1e3, 'In thousands') });
    expect(value).toBe(4.82e6);
    expect(decision.appliedFrom).toBe('page');
    expect(decision.provenance?.label).toBe('thousands');
  });

  it('2. millions header applies ×1,000,000 once', () => {
    const { value, decision } = finalValue('4,820', 'USD', { document: doc('millions', 1e6, '$ millions') });
    expect(value).toBe(4.82e9);
    expect(decision.appliedFrom).toBe('document');
  });

  it('3. billions header applies ×1,000,000,000 once', () => {
    const { value } = finalValue('2.5', 'USD', { page: page('billions', 1e9, 'in $ billions') });
    expect(value).toBe(2.5e9);
  });

  it('4. "000s" header applies ×1,000', () => {
    const { value, decision } = finalValue('2,148', 'USD', { table: table("'000s", 1e3, '(000s)') });
    expect(value).toBe(2.148e6);
    expect(decision.provenance?.from).toBe('table');
  });

  it('5. "$ in 000" header applies ×1,000', () => {
    const { value } = finalValue('482', 'USD', { page: page("'000s", 1e3, '$ in 000') });
    expect(value).toBe(482000);
  });

  it('6. mixed scale: table millions vs page thousands — table wins, flagged for review', () => {
    const { value, decision } = finalValue('4,820', 'USD', {
      table: table('millions', 1e6, 'in $ millions'),
      page: page('thousands', 1e3, 'In thousands'),
    });
    expect(value).toBe(4.82e9); // most specific level (table) is used
    expect(decision.flags).toHaveLength(1);
    expect(decision.flags[0]).toContain('scale conflict');
    expect(decision.flags[0]).toContain('table declares millions');
    expect(decision.flags[0]).toContain('page declares thousands');
  });

  it('7. per-share exception under "in thousands, except per share data"', () => {
    const { value, decision } = finalValue('2.14', 'USD per share', {
      page: page('thousands', 1e3, 'in thousands, except per share data'),
    });
    expect(value).toBe(2.14); // never scaled
    expect(decision.multiplier).toBeNull();
    expect(decision.provenance?.from).toBe('exempt');
    expect(decision.flags).toHaveLength(0);
  });

  it('8. double-scaling guard: "4.82 billion" + table "in millions" → 4.82e9, never 4.82e12', () => {
    const { value, decision } = finalValue('4.82 billion', 'USD', {
      table: table('millions', 1e6, 'in $ millions'),
      page: page('millions', 1e6, '$ millions'),
    });
    expect(value).toBe(4.82e9);
    expect(decision.appliedFrom).toBe('suffix');
    expect(decision.flags).toHaveLength(0);
  });

  it('9. missing scale: currency figure with no header — raw kept, flagged', () => {
    const { value, decision } = finalValue('4,820', 'USD', {});
    expect(value).toBe(4820); // units never assumed
    expect(decision.multiplier).toBeNull();
    expect(decision.flags[0]).toContain('scale not found');
  });

  it('10. conflicting page vs document scales — page wins, flagged', () => {
    const { value, decision } = finalValue('4,820', 'USD', {
      page: page('thousands', 1e3, 'In thousands'),
      document: doc('millions', 1e6, '$ millions'),
    });
    expect(value).toBe(4.82e6);
    expect(decision.flags).toHaveLength(1);
    expect(decision.flags[0]).toContain('page declares thousands');
    expect(decision.flags[0]).toContain('document declares millions');
  });

  it('11. unit field beats table header (precedence 2 over 3) — disagreement is flagged', () => {
    const { value, decision } = finalValue('4,820', 'millions USD', {
      table: table('thousands', 1e3, 'In thousands'),
    });
    expect(value).toBe(4.82e9); // unit's millions already applied by the normalizer
    expect(decision.appliedFrom).toBe('unit');
    // Item 0.5: the unit still wins by precedence, but the header's different
    // scale is a conflict — flagged, never silently guessed.
    expect(decision.flags).toHaveLength(1);
    expect(decision.flags[0]).toContain('scale conflict');
    expect(decision.flags[0]).toContain('unit says millions');
    expect(decision.flags[0]).toContain('table header says thousands');
  });

  it('12. ratios are never scaled even with a table header present', () => {
    const { value, decision } = finalValue('4.50x', 'x', {
      table: table('millions', 1e6, 'in $ millions'),
    });
    expect(value).toBe(4.5);
    expect(decision.provenance?.from).toBe('exempt');
  });
});

describe('decideScale — non-currency figures without scale', () => {
  it('dimensionless counts are not flagged as missing scale', () => {
    const { decision } = finalValue('1,234', 'employees', {});
    expect(decision.flags).toHaveLength(0);
    expect(decision.multiplier).toBeNull();
  });

  it('raw currency symbol without unit is still treated as currency', () => {
    const { decision } = finalValue('$4,820', null, {});
    expect(decision.flags[0]).toContain('scale not found');
  });
});

describe('decideScale — Item 0.5: header-only rule + unit-vs-header conflicts', () => {
  it('13. header "in thousands" with the extractor returning no unit — the table-header rule fires', () => {
    const { value, decision } = finalValue('4,820', null, { table: table('thousands', 1e3, 'In thousands') });
    expect(value).toBe(4.82e6);
    expect(decision.appliedFrom).toBe('table');
    expect(decision.provenance?.label).toBe('thousands');
    expect(decision.provenance?.headerText).toBe('In thousands');
    expect(decision.flags).toHaveLength(0);
  });

  it('14. unit-vs-header conflict is flagged, not guessed — unit still applies, a human must review', () => {
    const { value, decision } = finalValue('4,820', 'millions', { table: table('thousands', 1e3, 'In thousands') });
    expect(value).toBe(4.82e9); // the unit's scale was already applied by the parser
    expect(decision.appliedFrom).toBe('unit');
    expect(decision.flags).toHaveLength(1);
    expect(decision.flags[0]).toContain('scale conflict');
    expect(decision.flags[0]).toContain('extractor unit says millions');
    expect(decision.flags[0]).toContain('table header says thousands');
  });

  it('15. unit agreeing with the header is not a conflict', () => {
    const { value, decision } = finalValue('4,820', 'thousands', { table: table('thousands', 1e3, 'In thousands') });
    expect(value).toBe(4.82e6);
    expect(decision.flags).toHaveLength(0);
  });
});