import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { parseNumericValueDetailed } from '../../services/normalizer';
import { runCovenantTests } from '../../services/covenants';
import { ingestConflict, IngestConflict, sameNumber, scaleUnresolved } from '../core/trust';

// Analytics are derived from actual stored data — extraction results and
// metric observations — and every value keeps its derivation (REPORTED /
// CALCULATED / AI_INFERRED) and, where available, its source document.

export type MetricSeries = {
  metricKey: string;
  label: string;
  unit: string;
  points: {
    period: string;
    value: number;
    derivation: string;
    confidence: number | null;
    sourceDocumentId: string | null;
  }[];
  deltaPct: number | null; // latest vs prior-year period, when present
  deltaNote: string | null;
};

function priorYear(period: string): string | null {
  const m = period.match(/^(\d{4})/);
  if (!m) return null;
  const year = parseInt(m[1], 10) - 1;
  return period.replace(/^\d{4}/, String(year));
}

export async function entityOverview(entityId: string, quarters = 4) {
  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    include: { observations: { orderBy: { period: 'desc' } } },
  });
  if (!entity) return null;

  const byMetric = new Map<string, typeof entity.observations>();
  for (const obs of entity.observations) {
    const list = byMetric.get(obs.metricKey) ?? [];
    list.push(obs);
    byMetric.set(obs.metricKey, list);
  }

  const series: MetricSeries[] = [];
  for (const [metricKey, all] of byMetric) {
    // dedupe by period, newest first, then take the requested window
    const seen = new Set<string>();
    const points = all.filter((o) => {
      if (seen.has(o.period)) return false;
      seen.add(o.period);
      return true;
    });

    const window = points.slice(0, quarters);
    const latest = window[0];
    const yoy = latest ? points.find((p) => p.period === priorYear(latest.period)) : undefined;

    series.push({
      metricKey,
      label: latest?.label ?? metricKey,
      unit: latest?.unit ?? '',
      points: window.map((o) => ({
        period: o.period,
        value: o.value,
        derivation: o.derivation,
        confidence: o.confidence,
        sourceDocumentId: o.sourceDocumentId,
      })).reverse(),
      deltaPct:
        latest && yoy && yoy.value !== 0
          ? ((latest.value - yoy.value) / Math.abs(yoy.value)) * 100
          : null,
      deltaNote:
        latest && yoy
          ? `vs ${yoy.period}`
          : 'No prior-year observation stored — comparison not available.',
    });
  }

  const core = series.filter((s) => !s.metricKey.startsWith('segment:'));
  const segments = series.filter((s) => s.metricKey.startsWith('segment:'));
  return {
    entity: { id: entity.id, name: entity.name },
    metrics: core,
    segments,
    dataNotice:
      'Metrics derive from documents in this workspace. Values are labelled Reported (quoted in a document), Calculated (computed from reported values) or AI-inferred (extracted with AI, pending verification).',
  };
}

// Derive metric observations from VERIFIED extraction results. These are
// AI-inferred until a reviewer has verified the underlying extraction.
export async function ingestFromExtraction(
  workspaceId: string,
  taskId: string,
): Promise<{ created: number; refused: number; conflicts: IngestConflict[] }> {
  const task = await prisma.extractionTask.findUnique({
    where: { id: taskId },
    include: {
      results: {
        where: { status: 'VERIFIED' },
        include: { field: true, document: { select: { id: true, name: true } } },
      },
    },
  });
  if (!task) return { created: 0, refused: 0, conflicts: [] };

  const entity = await prisma.entity.findFirst({ where: { workspaceId, name: task.name } });
  if (!entity) return { created: 0, refused: 0, conflicts: [] };

  let created = 0;
  let refused = 0; // TRUST RULE: VERIFIED results whose scale is still unresolved
  const conflicts: IngestConflict[] = []; // OVERWRITE GUARD: existing figures that differ
  const affectedPeriods = new Set<string>();
  for (const r of task.results) {
    // Scale-aware parsing: parseNumericValueDetailed reports whether the value
    // itself ("4.82 billion") or the unit ("millions") already carried scale;
    // the reviewed result's scale decision (from enrichment) supplies any
    // header scale (table > page > document), applied exactly once.
    const detail = parseNumericValueDetailed(r.value, r.unit);
    if (!detail || !r.document) continue;
    const scaleInfo =
      (r.scale as {
        multiplier: number | null;
        appliedFrom: string | null;
        flags: string[];
        provenance: { label: string | null; headerText: string | null; from: string } | null;
        resolution?: { by: string; at: string; multiplier: number | null; label?: string | null; note?: string | null } | null;
        unresolved?: boolean;
      } | null) ?? null;
    // TRUST RULE: an unresolved flagged figure never becomes an observation,
    // no matter who verified it — resolution must be explicit.
    if (scaleUnresolved(scaleInfo)) {
      refused++;
      continue;
    }
    const numeric = scaleInfo?.multiplier != null ? detail.value * scaleInfo.multiplier : detail.value;
    if (!Number.isFinite(numeric)) continue;

    const period = r.document.name.match(/(Q[1-4]\s?\d{4}|\d{4})/i)?.[0]?.replace(/\s/, ' ') ?? null;
    if (!period) continue;

    // Overwrite guard: never silently replace a stored observation that
    // already carries a different figure. Same value -> refresh metadata;
    // different value -> skip and report the conflict for a human.
    const existing = await prisma.metricObservation.findUnique({
      where: { entityId_metricKey_period: { entityId: entity.id, metricKey: r.field.key, period } },
    });
    if (existing && !sameNumber(existing.value, numeric)) {
      conflicts.push(
        ingestConflict(
          entity.name,
          r.field.key,
          period,
          { value: existing.value, derivation: existing.derivation, sourceDocumentId: existing.sourceDocumentId },
          { value: numeric, sourceDocumentId: r.documentId },
        ),
      );
      continue;
    }

    await prisma.metricObservation.upsert({
      where: {
        entityId_metricKey_period: {
          entityId: entity.id,
          metricKey: r.field.key,
          period,
        },
      },
      create: {
        entityId: entity.id,
        metricKey: r.field.key,
        label: r.field.label,
        period,
        value: numeric,
        unit: r.unit ?? '',
        derivation: 'AI_INFERRED',
        confidence: r.confidence,
        sourceDocumentId: r.documentId,
        sourcePage: r.page,
        sourceExcerpt: r.excerpt,
        scale: (scaleInfo ? { ...scaleInfo, unresolved: false } : null) ?? Prisma.JsonNull,
        extractionResultId: r.id,
      },
      update: {
        value: numeric,
        unit: r.unit ?? '',
        derivation: 'AI_INFERRED', // the figure now comes from extraction — set it on update too
        confidence: r.confidence,
        sourceDocumentId: r.documentId,
        sourcePage: r.page,
        sourceExcerpt: r.excerpt,
        scale: (scaleInfo ? { ...scaleInfo, unresolved: false } : null) ?? Prisma.JsonNull,
        extractionResultId: r.id,
      },
    });
    affectedPeriods.add(period);
    created++;
  }

  // Automatic compliance: re-test covenants for every period that received
  // numbers. Fire-and-forget — ingest must never fail because of the retest.
  for (const period of affectedPeriods) {
    void runCovenantTests(workspaceId, entity.id, period).catch(() => {});
  }
  return { created, refused, conflicts };
}

// Scheduled reports support simple recurring cadences: daily | weekly | monthly.
export async function dueReports(): Promise<string[]> {
  const now = Date.now();
  const reports = await prisma.report.findMany({
    where: { schedule: { not: null } },
    select: { id: true, schedule: true, lastRunAt: true },
  });
  const ms = { daily: 86400e3, weekly: 7 * 86400e3, monthly: 30 * 86400e3 } as Record<string, number>;
  return reports
    .filter((r) => {
      const interval = ms[r.schedule!];
      if (!interval) return false;
      return !r.lastRunAt || now - r.lastRunAt.getTime() >= interval;
    })
    .map((r) => r.id);
}

export async function runReport(reportId: string): Promise<void> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { entity: true },
  });
  if (!report || !report.entity) return;

  const overview = await entityOverview(report.entity.id, 8);
  await prisma.report.update({
    where: { id: reportId },
    data: {
      lastRunAt: new Date(),
      content: (overview ?? {}) as unknown as object,
    },
  });
}
