// Strict-sandboxed covenant/metric formulas — pure logic, no I/O.
//
// SECURITY MODEL: a covenant formula comes from a workspace EDITOR (or worse,
// an AI extraction), so it is untrusted input. We never eval() a string.
// mathjs `parse()` builds an AST; we walk every node and reject anything that
// is not on this whitelist:
//   operators  +  -  *  /  ^   (incl. unary minus/plus)
//   parens      ( )
//   numbers    3  3.5  1e-3
//   symbols    ebitda, net_debt… (must resolve in the numeric scope)
//   functions  min  max  abs  sum  round   (mathjs built-ins, pure)
// Everything else — assignment (`a = 1`), function definitions, imports,
// matrix indexing, ranges, conditionals — is rejected before any evaluation.
// Length ≤ 500 chars, ≤ 100 nodes, ≤ 20 function calls. Injection attempts
// (all of the above, obfuscations via comments/unicode) are unit-tested in
// formula.test.ts.

import { parse, type MathNode } from 'mathjs';

export const FORMULA_MAX_LENGTH = 500;
const MAX_NODES = 100;
const MAX_CALLS = 20;

const ALLOWED_BINARY = new Set(['+', '-', '*', '/', '^']);
const ALLOWED_FUNCTIONS = new Set(['min', 'max', 'abs', 'sum', 'round']);

export type FormulaResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

let nodeCount = 0;
let callCount = 0;

/** Validate one AST node (recursive). Returns an error string or null. */
function checkNode(node: MathNode, scope: Record<string, number>): string | null {
  if (++nodeCount > MAX_NODES) return `Formula exceeds ${MAX_NODES} nodes.`;
  const n = node as unknown as {
    type: string;
    fn?: unknown;
    op?: string;
    name?: string;
    value?: unknown;
    args?: MathNode[];
  };

  switch (n.type) {
    case 'OperatorNode': {
      const op = n.op ?? '';
      const arity = (n.args ?? []).length;
      if (arity === 1) {
        // unary only as -x / +x
        if (op !== '-' && op !== '+') return `Unary operator "${op}" is not allowed.`;
      } else if (!ALLOWED_BINARY.has(op)) {
        return `Operator "${op}" is not allowed (allowed: + - * / ^).`;
      }
      break;
    }
    case 'ParenthesisNode':
      break; // transparent
    case 'ConstantNode':
      if (typeof n.value !== 'number' || !Number.isFinite(n.value))
        return 'Constants must be finite numbers.';
      break;
    case 'SymbolNode': {
      const name = n.name ?? '';
      if (!(name in scope))
        return `Unknown variable "${name}" — not a declared formula input.`;
      if (typeof scope[name] !== 'number' || !Number.isFinite(scope[name]))
        return `Input "${name}" is not a finite number.`;
      break;
    }
    case 'FunctionNode': {
      // mathjs >=13 stores fn as a plain string; older versions as a
      // SymbolNode. Handle both.
      const fnRaw: unknown = n.fn;
      const name = typeof fnRaw === 'string' ? fnRaw : ((fnRaw as { name?: string } | null)?.name ?? '');
      if (!ALLOWED_FUNCTIONS.has(name))
        return `Function "${name}" is not allowed (allowed: ${[...ALLOWED_FUNCTIONS].join(', ')}).`;
      if (++callCount > MAX_CALLS) return `Formula exceeds ${MAX_CALLS} function calls.`;
      break;
    }
    default:
      // AssignmentNode, BlockNode, ConditionalNode, IndexNode, RangeNode,
      // FunctionAssignmentNode, ArrayNode, ObjectNode, ImportNode … all land here.
      return `Node type "${n.type}" is not allowed in formulas.`;
  }

  let childError: string | null = null;
  node.forEach((child: MathNode, path: string) => {
    if (childError) return;
    // A FunctionNode's `fn` child is the function-name symbol — validated at
    // the node itself; walking it would misread it as an unknown variable.
    if (path === 'fn') return;
    childError = checkNode(child, scope);
  });
  return childError;
}

/** Parse + validate + evaluate a formula against a numeric scope. */
export function evaluateFormula(
  formula: string,
  scope: Record<string, number>,
): FormulaResult {
  nodeCount = 0;
  callCount = 0;
  if (typeof formula !== 'string' || !formula.trim())
    return { ok: false, error: 'Formula is empty.' };
  if (formula.length > FORMULA_MAX_LENGTH)
    return { ok: false, error: `Formula exceeds ${FORMULA_MAX_LENGTH} characters.` };

  let tree: MathNode;
  try {
    tree = parse(formula);
  } catch (e) {
    return { ok: false, error: `Formula does not parse: ${String((e as Error).message ?? e)}` };
  }

  const error = checkNode(tree, scope);
  if (error) return { ok: false, error };

  try {
    const value = tree.evaluate({ ...scope });
    if (typeof value !== 'number' || !Number.isFinite(value))
      return { ok: false, error: 'Formula did not produce a finite number.' };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: `Formula failed to evaluate: ${String((e as Error).message ?? e)}` };
  }
}

/** Validate formula syntax + scope keys without a numeric scope (API use). */
export function validateFormula(
  formula: string,
  inputKeys: string[],
): { ok: boolean; error?: string } {
  const probe: Record<string, number> = {};
  for (const k of inputKeys) probe[k] = 1;
  const r = evaluateFormula(formula, probe);
  // "input is not a finite number" can't happen (all 1s); remaining errors are
  // structural or unknown-variable errors, exactly what validation wants.
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
