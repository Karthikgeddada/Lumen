import { prisma } from '../prisma';
import { parseNumericValue } from './normalizer';
import { runCovenantTests } from './covenants';

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
export async function ingestFromExtraction(workspaceId: string, taskId: string): Promise<number> {
  const task = await prisma.extractionTask.findUnique({
    where: { id: taskId },
    include: {
      results: {
        where: { status: 'VERIFIED' },
        include: { field: true, document: { select: { id: true, name: true } } },
      },
    },
  });
  if (!task) return 0;

  const entity = await prisma.entity.findFirst({ where: { workspaceId, name: task.name } });
  if (!entity) return 0;

  let created = 0;
  const affectedPeriods = new Set<string>();
  for (const r of task.results) {
    // Real parsing: "4.82 billion" → 4.82e9, "(1,234)" → -1234 — not naive digit-stripping.
    const numeric = parseNumericValue(r.value, r.unit);
    if (numeric == null || !r.document) continue;

    const period = r.document.name.match(/(Q[1-4]\s?\d{4}|\d{4})/i)?.[0]?.replace(/\s/, ' ') ?? null;
    if (!period) continue;

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
        extractionResultId: r.id,
      },
      update: {
        value: numeric,
        confidence: r.confidence,
        sourceDocumentId: r.documentId,
        sourcePage: r.page,
        sourceExcerpt: r.excerpt,
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
  return created;
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
