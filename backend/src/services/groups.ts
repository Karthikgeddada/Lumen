import { prisma } from '../prisma';
import type { Prisma } from '@prisma/client';

// ── Group consolidation ─────────────────────────────────────────────────
// Roll subsidiary figures up onto the group (parent) entity, per metric and
// period. The group's own figures always win — a parent observation that was
// not itself written by an earlier consolidation is never overwritten.
// Consolidated rows carry scale.groupRollup so re-runs can refresh them, and
// every real value change leaves an ObservationRevision (source CONSOLIDATE)
// for the Data Quality revision history.

const MAX_GROUP_DEPTH = 3; // matches the Data Room structure limit

// Ratio-like figures cannot be summed — %, multiples (x), margins, coverage.
const RATIO_LIKE = /%|\bx\b|ratio|margin|coverage/i;

export interface ConsolidateResult {
  consolidated: number; // rows newly written
  refreshed: number; // existing roll-up rows whose value changed
  skipped: { metricKey: string; period: string; reason: string }[];
  contributors: string[]; // subsidiary names that fed the sums
}

export async function consolidateGroup(entityId: string, actorId: string | null): Promise<ConsolidateResult> {
  const group = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!group) throw new Error('Entity not found.');

  // All descendants, breadth-first, bounded by the structure limit.
  const contributors: { id: string; name: string }[] = [];
  let frontier = [group.id];
  const seen = new Set([group.id]);
  for (let depth = 0; depth < MAX_GROUP_DEPTH && frontier.length; depth++) {
    const children = await prisma.entity.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true, name: true },
    });
    frontier = [];
    for (const c of children) {
      if (seen.has(c.id)) continue; // cycle guard
      seen.add(c.id);
      contributors.push(c);
      frontier.push(c.id);
    }
  }

  const result: ConsolidateResult = {
    consolidated: 0,
    refreshed: 0,
    skipped: [],
    contributors: contributors.map((c) => c.name),
  };
  if (!contributors.length) return result; // nothing sits below the group

  const childObs = await prisma.metricObservation.findMany({
    where: { entityId: { in: contributors.map((c) => c.id) } },
    orderBy: { period: 'asc' },
  });

  // Sum by metric × period; ratio-like metrics are skipped once each.
  const sums = new Map<
    string,
    { metricKey: string; period: string; label: string; unit: string; total: number; byChild: Map<string, number> }
  >();
  const ratioSkipped = new Set<string>();
  for (const o of childObs) {
    if (RATIO_LIKE.test(`${o.unit} ${o.label} ${o.metricKey}`)) {
      if (!ratioSkipped.has(o.metricKey)) {
        ratioSkipped.add(o.metricKey);
        result.skipped.push({ metricKey: o.metricKey, period: '—', reason: 'Ratio-like metric — not summable across companies.' });
      }
      continue;
    }
    const key = `${o.metricKey}|${o.period}`;
    const s = sums.get(key) ?? { metricKey: o.metricKey, period: o.period, label: o.label, unit: o.unit, total: 0, byChild: new Map() };
    s.total += o.value;
    s.byChild.set(o.entityId, (s.byChild.get(o.entityId) ?? 0) + o.value);
    sums.set(key, s);
  }

  const entityName = new Map(contributors.map((c) => [c.id, c.name]));
  for (const s of sums.values()) {
    const lineage = {
      contributors: [...s.byChild.entries()].map(([id, v]) => ({ entity: entityName.get(id) ?? id, value: v })),
    };

    // The group's own figure wins unless it was itself a roll-up.
    const existing = await prisma.metricObservation.findUnique({
      where: { entityId_metricKey_period: { entityId: group.id, metricKey: s.metricKey, period: s.period } },
    });
    if (existing) {
      const isRollup = (existing.scale as { groupRollup?: boolean } | null)?.groupRollup === true;
      if (!isRollup) {
        result.skipped.push({ metricKey: s.metricKey, period: s.period, reason: 'Group already has its own figure for this period.' });
        continue;
      }
      if (existing.value === s.total) continue; // unchanged — nothing to do
      await prisma.metricObservation.update({
        where: { id: existing.id },
        data: {
          value: s.total,
          label: s.label,
          unit: s.unit,
          derivation: 'CALCULATED',
          scale: { calculated: true, groupRollup: true } as unknown as Prisma.InputJsonValue,
          inputs: lineage as unknown as Prisma.InputJsonValue,
        },
      });
      await prisma.observationRevision
        .create({
          data: {
            workspaceId: group.workspaceId,
            observationId: existing.id,
            entityId: group.id,
            metricKey: s.metricKey,
            period: s.period,
            oldValue: existing.value,
            newValue: s.total,
            oldDerivation: existing.derivation,
            newDerivation: 'CALCULATED',
            source: 'CONSOLIDATE',
            actorId,
          },
        })
        .catch(() => {}); // history must never break the consolidation
      result.refreshed++;
      continue;
    }

    await prisma.metricObservation.create({
      data: {
        entityId: group.id,
        metricKey: s.metricKey,
        label: s.label,
        period: s.period,
        value: s.total,
        unit: s.unit,
        derivation: 'CALCULATED',
        scale: { calculated: true, groupRollup: true } as unknown as Prisma.InputJsonValue,
        inputs: lineage as unknown as Prisma.InputJsonValue,
      },
    });
    result.consolidated++;
  }

  return result;
}
