// TRUST RULE — pure decision logic, no I/O.
//
// A figure with unresolved unit-scale flags (scale not found, conflicting
// scales) must never silently become a verified number, a metric observation,
// or a covenant PASS/FAIL. Someone must explicitly own the resolution.
// Shared by the extraction review route, analytics ingest, and covenant runs;
// every path is unit-tested in trust.test.ts.

export type ScaleResolutionInfo = {
  by: string; // userId of the analyst who resolved it
  at: string; // ISO timestamp
  multiplier: number | null; // the chosen multiplier (null = confirmed as-is)
  label?: string | null;
  note?: string | null;
};

export type ScaleInfo = {
  multiplier?: number | null;
  appliedFrom?: string | null;
  flags?: string[];
  nonScalable?: boolean;
  provenance?: { label: string | null; headerText: string | null; from: string } | null;
  resolution?: ScaleResolutionInfo | null;
  unresolved?: boolean;
};

// True when the figure carries scale flags no analyst has resolved.
// Rows written before the resolution era (flags, no `resolution` key, no
// explicit `unresolved`) count as unresolved — the rule protects them too.
export function scaleUnresolved(scale: unknown): boolean {
  if (!scale || typeof scale !== 'object') return false;
  const s = scale as ScaleInfo;
  if (typeof s.unresolved === 'boolean') return s.unresolved;
  return Array.isArray(s.flags) && s.flags.length > 0 && !s.resolution;
}

export function scaleFlags(scale: unknown): string[] {
  if (!scale || typeof scale !== 'object') return [];
  const f = (scale as ScaleInfo).flags;
  return Array.isArray(f) ? f : [];
}

// Analyst resolution applied to the stored scale JSON.
//   {confirm: true}          — "the figure as shown is correct": the existing
//                              multiplier (or none) stays, flags stay as the
//                              audit trail, and the resolution is recorded.
//   {multiplier, label?}     — the analyst supplies the correct scale; it
//                              replaces the multiplier applied at ingest.
// Never drops the original flags — what was detected remains visible.
export type ScaleResolution =
  | { confirm: true; note?: string }
  | { multiplier: number; label?: string; note?: string };

export function applyScaleResolution(
  scale: unknown,
  resolution: ScaleResolution,
  userId: string,
): ScaleInfo {
  const base: ScaleInfo = scale && typeof scale === 'object' ? { ...(scale as ScaleInfo) } : {};
  const chosen: number | null = 'multiplier' in resolution ? resolution.multiplier : null;
  const label: string | null = (resolution as { label?: string }).label ?? null;
  const note: string | null = (resolution as { note?: string }).note ?? null;
  return {
    ...base,
    multiplier: chosen ?? (base.multiplier ?? null),
    resolution: { by: userId, at: new Date().toISOString(), multiplier: chosen, label, note },
    unresolved: false,
  };
}

// Evaluate one covenant against the period's observation, enforcing the trust
// rule: an observation with unresolved scale flags is NOT_TESTED with a
// human-readable reason — never a PASS or FAIL built on an untrusted figure.
export function evaluateCovenant(
  def: { comparator: 'LTE' | 'GTE'; threshold: number; metricKey: string },
  obs: { value: number; scale: unknown } | null | undefined,
): {
  status: 'PASS' | 'FAIL' | 'NOT_TESTED';
  value: number | null;
  headroom: number | null;
  reason: string | null;
} {
  if (!obs) {
    return {
      status: 'NOT_TESTED',
      value: null,
      headroom: null,
      reason: `No verified observation for "${def.metricKey}" in this period.`,
    };
  }
  if (scaleUnresolved(obs.scale)) {
    const flags = scaleFlags(obs.scale);
    return {
      status: 'NOT_TESTED',
      value: null,
      headroom: null,
      reason:
        `Metric "${def.metricKey}" for this period carries unresolved scale flags` +
        (flags.length ? ` (${flags.join('; ')})` : '') +
        ' — resolve the figure in Data Extraction before this covenant can be tested.',
    };
  }
  const headroom = def.comparator === 'LTE' ? def.threshold - obs.value : obs.value - def.threshold;
  return { status: headroom >= 0 ? 'PASS' : 'FAIL', value: obs.value, headroom, reason: null };
}

// ── Ingest overwrite guard (Item 0.5) ──────────────────────────────
// Extraction ingest must never silently overwrite a stored observation that
// already carries a different figure — the same value refreshes metadata, a
// different value is a conflict a human must resolve.

export function sameNumber(a: number, b: number): boolean {
  // Floats from different parse paths can differ in their last bits; values
  // that agree to one part in a billion are the same figure.
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

export type IngestConflict = {
  entity: string;
  metric: string;
  period: string;
  existingValue: number;
  existingDerivation: string;
  existingSourceDocumentId: string | null;
  newValue: number;
  newSourceDocumentId: string | null;
};

export function ingestConflict(
  entity: string,
  metric: string,
  period: string,
  existing: { value: number; derivation: string; sourceDocumentId: string | null },
  incoming: { value: number; sourceDocumentId: string | null },
): IngestConflict {
  return {
    entity,
    metric,
    period,
    existingValue: existing.value,
    existingDerivation: existing.derivation,
    existingSourceDocumentId: existing.sourceDocumentId,
    newValue: incoming.value,
    newSourceDocumentId: incoming.sourceDocumentId,
  };
}

// ── Covenant breach freshness (Item 0.5) ───────────────────────
// A NOT_TESTED result can mask the last real status (unresolved scale,
// missing observation). A FAIL -> NOT_TESTED -> FAIL sequence is the same
// known breach re-appearing — it must not alert as if it were new.
export function isFreshBreach(
  previous: { status: string; previousStatus?: string | null } | null | undefined,
): boolean {
  if (!previous) return true;
  if (previous.status === 'FAIL') return false;
  if (previous.status === 'NOT_TESTED' && previous.previousStatus === 'FAIL') return false;
  return true;
}
