// DB orchestration for post-extraction validation (spec C1) — the pure
// checks live in validation.ts (imported by unit tests without a database);
// this module loads the task's results, resolves QoQ context from stored
// observations, and persists flags onto the ExtractionResult rows.

import { prisma } from '../prisma';
import { parseNumericValueDetailed } from './normalizer';
import { previousQuarter } from './periods';
import { ValidationConfig, Figure, validateFigures } from './validation';

// ── Orchestration: run over a task's results and persist flags ─────────
export async function runPostExtractionValidation(
  workspaceId: string,
  taskId: string,
): Promise<{ flagged: number }> {
  const task = await prisma.extractionTask.findUnique({
    where: { id: taskId },
    include: {
      results: {
        include: { field: { select: { key: true } }, document: { select: { id: true, name: true } } },
      },
    },
  });
  if (!task) return { flagged: 0 };

  const setting = await prisma.workspaceSetting.findUnique({
    where: { workspaceId_key: { workspaceId, key: 'validation.rules' } },
  });
  const config: ValidationConfig =
    setting && setting.value && typeof setting.value === 'object'
      ? (setting.value as ValidationConfig)
      : {};

  // Figures: scale-applied numeric values + period from the document name
  // (same convention as ingest).
  const figures: Figure[] = [];
  const resultByKey = new Map<string, { id: string; note: string | null }[]>();
  for (const r of task.results) {
    const detail = r.value ? parseNumericValueDetailed(r.value, r.unit) : null;
    if (!detail || !r.document) continue;
    const scaleInfo = r.scale as { multiplier?: number | null } | null;
    const value = scaleInfo?.multiplier != null ? detail.value * scaleInfo.multiplier : detail.value;
    if (!Number.isFinite(value)) continue;
    const period = r.document.name.match(/(Q[1-4]\s?\d{4}|\d{4})/i)?.[0]?.replace(/\s/, ' ') ?? null;
    figures.push({
      fieldKey: r.field.key,
      value,
      unit: r.unit ?? null,
      scaleMultiplier: scaleInfo?.multiplier ?? null,
      period,
    });
    const list = resultByKey.get(r.field.key) ?? [];
    list.push({ id: r.id, note: r.note });
    resultByKey.set(r.field.key, list);
  }
  if (!figures.length) return { flagged: 0 };

  // QoQ context: previous quarter's stored observations for the same entity.
  // No entity yet (first upload) → no QoQ check, everything else still runs.
  const entity = await prisma.entity.findFirst({ where: { workspaceId, name: task.name } });
  const prevValues = new Map<string, number>();
  const prevUnits = new Map<string, { unit: string | null; multiplier: number | null }>();
  if (entity) {
    const metricKeys = [...new Set(figures.map((f) => f.fieldKey))];
    const priorPeriods = [...new Set(figures.map((f) => (f.period ? previousQuarter(f.period) : null)).filter(Boolean))] as string[];
    const obs = await prisma.metricObservation.findMany({
      where: { entityId: entity.id, metricKey: { in: metricKeys }, period: { in: priorPeriods } },
      select: { metricKey: true, period: true, value: true, unit: true, scale: true },
    });
    for (const f of figures) {
      if (!f.period) continue;
      const pq = previousQuarter(f.period);
      if (!pq) continue;
      const o = obs.find((x) => x.metricKey === f.fieldKey && x.period === pq);
      if (o) {
        prevValues.set(f.fieldKey, o.value);
        const s = o.scale as { multiplier?: number | null } | null;
        prevUnits.set(f.fieldKey, { unit: o.unit, multiplier: s?.multiplier ?? null });
      }
    }
  }

  // Stored-prior unit/multiplier mismatch (same metric, previous ingest) is
  // flagged explicitly here — validateFigures handles intra-task consistency.
  const priorMismatchFlags = new Map<string, string[]>();
  for (const f of figures) {
    const prior = prevUnits.get(f.fieldKey);
    if (!prior || f.value == null) continue;
    if ((prior.unit ?? null) !== (f.unit ?? null)) {
      priorMismatchFlags.set(f.fieldKey, [
        `Unit differs from the stored ${prior.unit ?? 'none'} for this metric (now ${f.unit ?? 'none'}) — confirm before ingest`,
      ]);
    } else if ((prior.multiplier ?? null) !== (f.scaleMultiplier ?? null)) {
      priorMismatchFlags.set(f.fieldKey, [
        `Scale multiplier differs from stored ${prior.multiplier ?? 'none'} (now ${f.scaleMultiplier ?? 'none'}) — confirm before ingest`,
      ]);
    }
  }

  const flags = validateFigures(config, figures, (k) => prevValues.get(k) ?? null);
  for (const [k, msgs] of priorMismatchFlags) {
    const list = flags.get(k) ?? [];
    flags.set(k, [...list, ...msgs]);
  }

  // Persist: append to note, set flagged (the trust rule takes it from here).
  let flagged = 0;
  for (const [key, msgs] of flags) {
    for (const r of resultByKey.get(key) ?? []) {
      const note = [r.note, ...msgs].filter(Boolean).join('; ') || null;
      await prisma.extractionResult.update({ where: { id: r.id }, data: { note, flagged: true } });
      flagged++;
    }
  }
  return { flagged };
}
