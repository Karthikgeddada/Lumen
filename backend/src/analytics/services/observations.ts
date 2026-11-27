// The SINGLE writer of MetricObservation. Every path that lands a number —
// the manual observations endpoint, ingest-from-extraction, and the
// calculated-metric recompute inside covenant runs — goes through
// writeObservation, which owns three invariants:
//
//   1. Upsert semantics on (entityId, metricKey, period) — preserved from
//      the three call sites it replaced.
//   2. The overwrite guard: with guard 'overwrite' (ingest), an existing
//      figure that differs is NEVER silently replaced — the change is
//      refused and reported as a conflict for a human.
//   3. History: every update appends an ObservationRevision capturing the
//      PREVIOUS state (value, unit, derivation, scale, source). Append-only,
//      never rewritten.
//
// The automatic covenant re-test after a landed number also lives here
// (fire-and-forget — a write must never fail because of the retest), except
// for bulk ingest, which passes triggerRetest:false and batches one retest
// per affected period itself.

import { Prisma, MetricObservation } from '@prisma/client';
import { prisma } from '../../prisma';
import { runCovenantTests } from '../../services/covenants';
import { IngestConflict, ingestConflict, sameNumber } from '../core/trust';

export type WriteReason = 'manual entry' | 'ingest from extraction' | 'calculated recompute';

export type WriteObservationInput = {
  workspaceId: string;
  entityId: string;
  entityName?: string; // for conflict reports (ingest)
  metricKey: string;
  label: string;
  period: string; // normalized single-space form, e.g. 'Q3 2026'
  value: number;
  unit: string;
  derivation: 'REPORTED' | 'CALCULATED' | 'AI_INFERRED';
  confidence?: number | null;
  sourceDocumentId?: string | null;
  sourcePage?: number | null;
  sourceExcerpt?: string | null;
  scale?: Prisma.InputJsonValue | null;
  inputs?: Prisma.InputJsonValue | null;
  extractionResultId?: string | null;
  changedById?: string | null;
  reason: WriteReason;
  // Update the label too? Manual edits do; ingest and recompute keep the
  // stored label on update (their source of truth is the template at CREATE
  // time) — matching the three call sites this writer replaced.
  updateLabel?: boolean;
  // 'overwrite' refuses to replace a differing stored figure (ingest);
  // 'allow' overwrites (manual edits, recomputed calculated metrics).
  guard?: 'overwrite' | 'allow';
  triggerRetest?: boolean; // default true
};

export type WriteOutcome =
  | { outcome: 'created'; observation: MetricObservation }
  | { outcome: 'updated'; observation: MetricObservation }
  | { outcome: 'conflict'; conflict: IngestConflict; existing: MetricObservation };

export async function writeObservation(input: WriteObservationInput): Promise<WriteOutcome> {
  const { entityId, metricKey, period, value } = input;

  const existing = await prisma.metricObservation.findUnique({
    where: { entityId_metricKey_period: { entityId, metricKey, period } },
  });

  // OVERWRITE GUARD (TRUST RULE): a differing stored figure is never
  // silently replaced — refuse and report for a human.
  if (existing && input.guard === 'overwrite' && !sameNumber(existing.value, value)) {
    return {
      outcome: 'conflict',
      conflict: ingestConflict(
        input.entityName ?? '',
        metricKey,
        period,
        {
          value: existing.value,
          derivation: existing.derivation,
          sourceDocumentId: existing.sourceDocumentId,
        },
        { value, sourceDocumentId: input.sourceDocumentId ?? null },
      ),
      existing,
    };
  }

  const triggerRetest = input.triggerRetest ?? true;
  const retest = () => {
    void runCovenantTests(input.workspaceId, entityId, period).catch(() => {});
  };

  if (!existing) {
    const observation = await prisma.metricObservation.create({
      data: {
        entityId,
        metricKey,
        label: input.label,
        period,
        value,
        unit: input.unit,
        derivation: input.derivation,
        confidence: input.confidence ?? null,
        sourceDocumentId: input.sourceDocumentId ?? null,
        sourcePage: input.sourcePage ?? null,
        sourceExcerpt: input.sourceExcerpt ?? null,
        scale: input.scale == null ? Prisma.JsonNull : (input.scale as Prisma.InputJsonValue),
        inputs: input.inputs == null ? Prisma.JsonNull : (input.inputs as Prisma.InputJsonValue),
        extractionResultId: input.extractionResultId ?? null,
      },
    });
    if (triggerRetest) retest();
    return { outcome: 'created', observation };
  }

  // Update + append-only revision capturing the PREVIOUS state.
  const data: Prisma.MetricObservationUncheckedUpdateInput = {
    value,
    unit: input.unit,
    derivation: input.derivation,
  };
  // Optional fields: undefined = leave untouched; explicit null = clear.
  // (This preserves the exact field-by-field semantics of the three paths.)
  if (input.label !== undefined && input.updateLabel) data.label = input.label;
  if (input.confidence !== undefined) data.confidence = input.confidence;
  if (input.sourceDocumentId !== undefined) data.sourceDocumentId = input.sourceDocumentId;
  if (input.sourcePage !== undefined) data.sourcePage = input.sourcePage;
  if (input.sourceExcerpt !== undefined) data.sourceExcerpt = input.sourceExcerpt;
  if (input.scale !== undefined)
    data.scale = input.scale === null ? Prisma.JsonNull : (input.scale as Prisma.InputJsonValue);
  if (input.inputs !== undefined)
    data.inputs = input.inputs === null ? Prisma.JsonNull : (input.inputs as Prisma.InputJsonValue);
  if (input.extractionResultId !== undefined) data.extractionResultId = input.extractionResultId;

  const [observation] = await prisma.$transaction([
    prisma.metricObservation.update({ where: { id: existing.id }, data }),
    prisma.observationRevision.create({
      data: {
        observationId: existing.id,
        previousValue: existing.value,
        previousUnit: existing.unit,
        previousDerivation: existing.derivation,
        previousScale: existing.scale === null ? Prisma.JsonNull : (existing.scale as Prisma.InputJsonValue),
        previousSourceDocumentId: existing.sourceDocumentId,
        previousSourcePage: existing.sourcePage,
        previousSourceExcerpt: existing.sourceExcerpt,
        changedById: input.changedById ?? null,
        reason: input.reason,
      },
    }),
  ]);
  if (triggerRetest) retest();
  return { outcome: 'updated', observation };
}
