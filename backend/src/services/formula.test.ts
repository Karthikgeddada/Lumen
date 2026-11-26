// Formula sandbox tests — spec C2: allowed surface evaluates exactly, every
// injection attempt is rejected before evaluation.
import { describe, expect, it } from 'vitest';
import { evaluateFormula, FORMULA_MAX_LENGTH } from './formula';

const scope = { debt: 100, cash: 20, ebitda: 40, a: 4, b: 2, c: 8 };

describe('allowed formulas evaluate correctly', () => {
  it('arithmetic and precedence', () => {
    expect(evaluateFormula('(debt - cash) / ebitda', scope)).toEqual({ ok: true, value: 2 });
    expect(evaluateFormula('a + b * c', scope)).toEqual({ ok: true, value: 20 });
    expect(evaluateFormula('a ^ 2 + 1', scope)).toEqual({ ok: true, value: 17 });
    expect(evaluateFormula('1e-3 * 1000', {})).toEqual({ ok: true, value: 1 });
  });

  it('unary minus and plus', () => {
    expect(evaluateFormula('-debt + cash', scope)).toEqual({ ok: true, value: -80 });
    expect(evaluateFormula('+a', scope)).toEqual({ ok: true, value: 4 });
  });

  it('whitelisted functions', () => {
    expect(evaluateFormula('min(a, b)', scope)).toEqual({ ok: true, value: 2 });
    expect(evaluateFormula('max(a, b, c)', scope)).toEqual({ ok: true, value: 8 });
    expect(evaluateFormula('abs(0 - a)', scope)).toEqual({ ok: true, value: 4 });
    expect(evaluateFormula('sum(a, b, c)', scope)).toEqual({ ok: true, value: 14 });
    expect(evaluateFormula('round(3.14159, 2)', scope)).toEqual({ ok: true, value: 3.14 });
    expect(evaluateFormula('max(a, min(b, c))', scope)).toEqual({ ok: true, value: 4 });
  });

  it('division by zero is rejected (finite guard)', () => {
    expect(evaluateFormula('a / (b - 2)', scope).ok).toBe(false);
  });
});

describe('injection attempts are rejected', () => {
  const rejects = (f: string, s: Record<string, number> = scope) => {
    const r = evaluateFormula(f, s);
    expect(r.ok).toBe(false);
  };

  it('assignment and mutation', () => {
    rejects('a = 1');
    rejects('debt = debt * 10');
    rejects('scope.debt = 5');
  });

  it('function definitions and imports', () => {
    rejects('f(x) = x * 2');
    rejects('import("fs")');
    rejects('createUnit(x, y) = x * y');
  });

  it('non-whitelisted operators and functions', () => {
    rejects('a == b');
    rejects('a < b');
    rejects('a and b');
    rejects('a ? b : c');
    rejects('range(1, 5)');
    rejects('sqrt(a)');
    rejects('evaluate("debt = 999")');
    rejects('parse("a", {})');
  });

  it('matrix / indexing / object escapes', () => {
    rejects('a[1]');
    rejects('[1, 2, 3]');
    rejects('{x: 1}');
    rejects('a.toString');
    rejects('toString.constructor');
  });

  it('multiple statements (block smuggling)', () => {
    rejects('a; b');
    rejects('a, b');
  });

  it('unknown variables', () => {
    rejects('debt + ebitda2', scope);
    rejects('globalThis.debt', scope);
  });
});

describe('limits', () => {
  it('rejects over-length formulas', () => {
    const tooLong = 'a' + ' + a'.repeat(200); // > 500 chars, only allowed ops
    expect(tooLong.length).toBeGreaterThan(FORMULA_MAX_LENGTH);
    expect(evaluateFormula(tooLong, scope).ok).toBe(false);
  });

  it('rejects node-count bombs', () => {
    const bomb = 'min(' + 'a,'.repeat(150) + 'a)'; // 152 nodes > MAX_NODES(100), within length limits
    expect(evaluateFormula(bomb, scope).ok).toBe(false);
  });

  it('empty and non-string formulas', () => {
    expect(evaluateFormula('', scope).ok).toBe(false);
    expect(evaluateFormula('   ', scope).ok).toBe(false);
  });
});
