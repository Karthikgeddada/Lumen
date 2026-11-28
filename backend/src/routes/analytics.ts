import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { runCovenantTests } from '../services/covenants';
import { audit } from '../utils';
import { entityOverview } from '../services/analytics';
import { seedPackageItems, lastNQuarters } from '../services/borrowers';
import { consolidateGroup } from '../services/groups';

const router = Router();

// Group structure limits (Data Room phase 1): company → subsidiary → sub-subsidiary.
const MAX_ENTITY_DEPTH = 3;

// Depth of an entity in the group tree (top-level = 1). Walks up via parentId.
async function entityDepth(entityId: string): Promise<number> {
  let depth = 1;
  let cursor: string | null = entityId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const step: { parentId: string | null } | null = await prisma.entity.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!step) break;
    cursor = step.parentId;
    if (cursor) depth += 1;
  }
  return depth;
}

// Height of the subtree below an entity (1 for a leaf). Defensive against
// cycles; the authoritative cycle guard runs before any move is applied.
async function entityHeight(entityId: string): Promise<number> {
  const children = await prisma.entity.findMany({ where: { parentId: entityId }, select: { id: true } });
  let height = 1;
  for (const child of children) {
    height = Math.max(height, 1 + (await entityHeight(child.id)));
  }
  return height;
}

async function assertParentAllowed(parentId: string, workspaceId: string, entityId?: string) {
  if (entityId && parentId === entityId) {
    throw new ApiError(400, 'INVALID_PARENT', 'A company cannot be its own parent.');
  }
  const parent = await prisma.entity.findFirst({ where: { id: parentId, workspaceId } });
  if (!parent) throw new ApiError(404, 'NOT_FOUND', 'Parent company not found.');
  // Cycle guard: the proposed parent must not sit inside the entity's subtree.
  if (entityId) {
    let cursor: string | null = parent.id;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (cursor === entityId) throw new ApiError(400, 'INVALID_PARENT', 'Cannot nest a company inside its own subsidiary.');
      const step: { parentId: string | null } | null = await prisma.entity.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = step?.parentId ?? null;
    }
    // Depth guard: new-parent depth + subtree height must fit the limit.
    const parentDepth = await entityDepth(parent.id);
    const height = await entityHeight(entityId);
    if (parentDepth + height > MAX_ENTITY_DEPTH) {
      throw new ApiError(400, 'DEPTH_LIMIT', `Group structures can nest at most ${MAX_ENTITY_DEPTH} levels (company → subsidiary → sub-subsidiary).`);
    }
  } else {
    // Creating a new child: parent depth + 1 must fit.
    const parentDepth = await entityDepth(parent.id);
    if (parentDepth + 1 > MAX_ENTITY_DEPTH) {
      throw new ApiError(400, 'DEPTH_LIMIT', `Group structures can nest at most ${MAX_ENTITY_DEPTH} levels (company → subsidiary → sub-subsidiary).`);
    }
  }
  return parent;
}

// Entities (companies / funds / plants the analytics track)
router.get(
  '/:workspaceId/analytics/entities',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const entities = await prisma.entity.findMany({
      where: { workspaceId: req.ws!.id },
      include: { _count: { select: { observations: true, reports: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ entities });
  }),
);

router.post(
  '/:workspaceId/analytics/entities',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        // Optional parent — set when creating a subsidiary of an existing borrower.
        parentId: z.string().trim().optional(),
      })
      .parse(req.body);
    if (body.parentId) {
      await assertParentAllowed(body.parentId, req.ws!.id);
    }
    const entity = await prisma.entity.create({
      data: { workspaceId: req.ws!.id, name: body.name, parentId: body.parentId ?? null },
    });
    await seedPackageItems(entity.id); // default quarterly package for the new borrower
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'entity.created', targetType: 'entity', targetId: entity.id, meta: { name: entity.name, parentId: entity.parentId } });
    res.status(201).json({ entity });
  }),
);

// Set or clear an entity's parent (group structure editing).
router.patch(
  '/:workspaceId/analytics/entities/:entityId',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        // null clears the parent (promotes to top-level company).
        parentId: z.string().nullable().optional(),
      })
      .parse(req.body);
    const entity = await prisma.entity.findFirst({
      where: { id: req.params.entityId, workspaceId: req.ws!.id },
    });
    if (!entity) throw new ApiError(404, 'NOT_FOUND', 'Entity not found.');

    if (body.parentId) {
      await assertParentAllowed(body.parentId, req.ws!.id, entity.id);
    }
    const updated = await prisma.entity.update({
      where: { id: entity.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      },
    });
    if (body.parentId !== undefined) {
      await audit({
        workspaceId: req.ws!.id,
        actorId: req.auth!.userId,
        action: body.parentId ? 'entity.parent_set' : 'entity.parent_cleared',
        targetType: 'entity',
        targetId: entity.id,
        meta: { name: entity.name, parentId: body.parentId },
      });
    }
    res.json({ entity: updated });
  }),
);

// Consolidate the group: roll subsidiaries' figures up onto this entity, per
// metric and period. Ratio-like metrics are skipped (not summable), the
// group's own figures win, and consolidated rows refresh on re-run. The new
// group figures then flow everywhere — covenants, reports, Explore.
router.post(
  '/:workspaceId/analytics/entities/:entityId/consolidate',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const entity = await prisma.entity.findFirst({
      where: { id: req.params.entityId, workspaceId: req.ws!.id },
    });
    if (!entity) throw new ApiError(404, 'NOT_FOUND', 'Entity not found.');
    const result = await consolidateGroup(entity.id, req.auth!.userId);
    await audit({
      workspaceId: req.ws!.id,
      actorId: req.auth!.userId,
      action: 'group.consolidated',
      targetType: 'entity',
      targetId: entity.id,
      meta: {
        consolidated: result.consolidated,
        refreshed: result.refreshed,
        skipped: result.skipped.length,
        contributors: result.contributors.length,
      },
      ip: req.ip,
    });
    // Group figures may move covenants — retest, best-effort.
    runCovenantTests(req.ws!.id, entity.id).catch(() => {});
    res.json(result);
  }),
);

// Delete an entity (ADMIN-only, audit-logged — for cleaning up test entities).
// Removes its observations and covenant definitions/results (cascade);
// scheduled reports survive but are unlinked from the deleted entity.
router.delete(
  '/:workspaceId/analytics/entities/:entityId',
  requireAuth,
  requireWorkspace('ADMIN'),
  asyncH(async (req, res) => {
    const entity = await prisma.entity.findFirst({
      where: { id: req.params.entityId, workspaceId: req.ws!.id },
    });
    if (!entity) throw new ApiError(404, 'NOT_FOUND', 'Entity not found.');

    const [unlinked, observations] = await prisma.$transaction([
      prisma.report.updateMany({ where: { entityId: entity.id }, data: { entityId: null } }),
      prisma.metricObservation.deleteMany({ where: { entityId: entity.id } }),
    ]);
    await prisma.entity.delete({ where: { id: entity.id } }); // covenant definitions + results cascade
    await audit({
      workspaceId: req.ws!.id,
      actorId: req.auth!.userId,
      action: 'entity.deleted',
      targetType: 'entity',
      targetId: entity.id,
      meta: { name: entity.name, observations: observations.count, reportsUnlinked: unlinked.count },
    });
    res.json({ ok: true, deleted: entity.name, observations: observations.count, reportsUnlinked: unlinked.count });
  }),
);

// Overview — 4- or 8-quarter view with YoY deltas and segment series.
router.get(
  '/:workspaceId/analytics/overview',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const { entityId, quarters } = z
      .object({ entityId: z.string(), quarters: z.coerce.number().int().refine((n) => n === 4 || n === 8, 'quarters must be 4 or 8').default(4) })
      .parse(req.query);

    const entity = await prisma.entity.findFirst({ where: { id: entityId, workspaceId: req.ws!.id } });
    if (!entity) throw new ApiError(404, 'NOT_FOUND', 'Entity not found.');
    const overview = await entityOverview(entity.id, quarters);
    res.json({ overview });
  }),
);

// Add a reported observation manually (e.g. transcribing a reported figure).
router.post(
  '/:workspaceId/analytics/observations',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        entityId: z.string(),
        metricKey: z.string().trim().min(1).max(80),
        label: z.string().trim().min(1).max(120),
        period: z.string().trim().regex(/^(Q[1-4]\s?\d{4}|\d{4})$/, 'period must look like “Q3 2026” or “2026”'),
        value: z.number().finite(),
        unit: z.string().trim().max(20).default('USD'),
        derivation: z.enum(['REPORTED', 'CALCULATED', 'AI_INFERRED']).default('REPORTED'),
        sourceDocumentId: z.string().optional(),
        sourcePage: z.number().int().optional(),
        sourceExcerpt: z.string().max(2000).optional(),
      })
      .parse(req.body);

    const entity = await prisma.entity.findFirst({ where: { id: body.entityId, workspaceId: req.ws!.id } });
    if (!entity) throw new ApiError(404, 'NOT_FOUND', 'Entity not found.');

    const period = body.period.replace(/\s/, ' ');
    // Revision history: capture the prior row so a real overwrite is recorded.
    const prior = await prisma.metricObservation.findUnique({
      where: { entityId_metricKey_period: { entityId: body.entityId, metricKey: body.metricKey, period } },
    });

    const observation = await prisma.metricObservation.upsert({
      where: { entityId_metricKey_period: { entityId: body.entityId, metricKey: body.metricKey, period } },
      create: { ...body, period },
      update: { ...body, period },
    });
    if (prior && prior.value !== observation.value) {
      await prisma.observationRevision.create({
        data: {
          workspaceId: entity.workspaceId,
          observationId: observation.id,
          entityId: body.entityId,
          metricKey: body.metricKey,
          period,
          oldValue: prior.value,
          newValue: observation.value,
          oldDerivation: prior.derivation,
          newDerivation: observation.derivation,
          source: 'MANUAL',
          actorId: req.auth!.userId,
        },
      });
      await audit({
        workspaceId: entity.workspaceId,
        actorId: req.auth!.userId,
        action: 'observation.revised',
        targetType: 'metric_observation',
        targetId: observation.id,
        meta: { metricKey: body.metricKey, period, from: prior.value, to: observation.value },
        ip: req.ip,
      });
    }
    // Automatic compliance: re-test this entity's covenants for the affected
    // period whenever a number lands. Fire-and-forget — entry must never fail
    // because of the retest.
    void runCovenantTests(entity.workspaceId, entity.id, body.period.replace(/\s/, ' ')).catch(() => {});
    res.status(201).json({ observation });
  }),
);

// Reports (on-demand + scheduled)
router.get(
  '/:workspaceId/analytics/reports',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const reports = await prisma.report.findMany({
      where: { workspaceId: req.ws!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ reports });
  }),
);

router.post(
  '/:workspaceId/analytics/reports',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        title: z.string().trim().min(1).max(140),
        entityId: z.string(),
        type: z.enum(['quarterly', 'comparison']).default('quarterly'),
        schedule: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
      })
      .parse(req.body);
    const entity = await prisma.entity.findFirst({ where: { id: body.entityId, workspaceId: req.ws!.id } });
    if (!entity) throw new ApiError(404, 'NOT_FOUND', 'Entity not found.');
    const report = await prisma.report.create({
      data: {
        workspaceId: req.ws!.id,
        entityId: entity.id,
        title: body.title,
        type: body.type,
        schedule: body.schedule === 'none' ? null : body.schedule,
        createdById: req.auth!.userId,
      },
    });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'report.created', targetType: 'report', targetId: report.id });
    res.status(201).json({ report });
  }),
);

router.delete(
  '/analytics/reports/:reportId',
  requireAuth,
  asyncH(async (req, res) => {
    const report = await prisma.report.findFirst({ where: { id: req.params.reportId } });
    if (!report) throw new ApiError(404, 'NOT_FOUND', 'Report not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: report.workspaceId, userId: req.auth!.userId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'EDITOR'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    await prisma.report.delete({ where: { id: report.id } });
    res.json({ ok: true });
  }),
);

// ── Explore tab: dataset + filters, recommended chart, saved views ──────

// Explore dataset: one series per company × metric over the chosen window,
// plus the rule-based chart recommendation and its "why" — the reasoning
// ships with the chart instead of being hidden.
router.get(
  '/:workspaceId/analytics/explore',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const entityIds = String(req.query.entityIds ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
    if (!entityIds.length) throw new ApiError(400, 'BAD_REQUEST', 'Pick at least one company.');
    const metricKeys = String(req.query.metricKeys ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
    const quarters = Math.min(12, Math.max(1, parseInt(String(req.query.quarters ?? '4'), 10) || 4));

    const entities = await prisma.entity.findMany({
      where: { workspaceId: req.ws!.id, id: { in: entityIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (!entities.length) throw new ApiError(404, 'NOT_FOUND', 'Company not found.');
    const names = new Map(entities.map((e) => [e.id, e.name]));
    const ids = entities.map((e) => e.id);

    const periods = lastNQuarters(quarters); // oldest → newest
    const periodIndex = new Map(periods.map((p, i) => [p, i]));

    const [obs, available] = await Promise.all([
      prisma.metricObservation.findMany({
        where: {
          entityId: { in: ids },
          ...(metricKeys.length ? { metricKey: { in: metricKeys } } : {}),
          period: { in: periods },
        },
        select: {
          entityId: true, metricKey: true, label: true, unit: true,
          period: true, value: true, derivation: true, confidence: true,
        },
      }),
      // Every metric available for the picked companies (any period) so the
      // picker can offer more than the current window holds.
      prisma.metricObservation.findMany({
        where: { entityId: { in: ids } },
        select: { metricKey: true, label: true, unit: true },
        orderBy: { period: 'desc' },
        take: 2000,
      }),
    ]);

    const bySeries = new Map<
      string,
      { entityId: string; entityName: string; metricKey: string; label: string; unit: string; points: { period: string; value: number; derivation: string; confidence: number | null }[] }
    >();
    for (const o of obs) {
      const key = `${o.entityId}|${o.metricKey}`;
      const s = bySeries.get(key) ?? {
        entityId: o.entityId,
        entityName: names.get(o.entityId) ?? 'Unknown',
        metricKey: o.metricKey,
        label: o.label,
        unit: o.unit,
        points: [],
      };
      s.points.push({ period: o.period, value: o.value, derivation: o.derivation, confidence: o.confidence });
      bySeries.set(key, s);
    }
    const series = [...bySeries.values()].map((s) => ({
      ...s,
      points: s.points.sort((a, b) => (periodIndex.get(a.period) ?? 0) - (periodIndex.get(b.period) ?? 0)),
    }));

    // Distinct available metrics — newest label/unit wins.
    const metricsMap = new Map<string, { key: string; label: string; unit: string }>();
    for (const a of available) {
      if (!metricsMap.has(a.metricKey)) metricsMap.set(a.metricKey, { key: a.metricKey, label: a.label, unit: a.unit });
    }

    const metricCount = new Set(series.map((s) => s.metricKey)).size;
    const entityCount = new Set(series.map((s) => s.entityId)).size;
    const latest = periods[periods.length - 1];
    const recommendation =
      series.length === 0
        ? { type: 'NONE', why: 'No stored figures match this selection yet — widen the window, pick another company, or add reported figures.' }
        : metricCount > 1
          ? { type: 'INDEX', why: `Several metrics (${metricCount}) — each line is indexed to its first quarter (100), so different units share one scale. Hover for the real values.` }
          : quarters === 1
            ? { type: 'BAR', why: `One metric across ${entityCount} ${entityCount === 1 ? 'company' : 'companies'} for ${latest} — bars compare levels directly.` }
            : { type: 'LINE', why: "One metric over time — lines show each company's trajectory, and the shared unit keeps them comparable." };

    res.json({ series, periods, recommendation, metrics: [...metricsMap.values()] });
  }),
);

// Saved views — the dataset + filters of an Explore chart, reloadable in one
// click. The chart type is re-recommended on load, so views never go stale.
router.get(
  '/:workspaceId/analytics/views',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const views = await prisma.savedChartView.findMany({
      where: { workspaceId: req.ws!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ views });
  }),
);

const chartSpecSchema = z.object({
  entityIds: z.array(z.string()).min(1).max(10),
  metricKeys: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  quarters: z.number().int().min(1).max(12).default(4),
});

router.post(
  '/:workspaceId/analytics/views',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z.object({ title: z.string().trim().min(1).max(120), spec: chartSpecSchema }).parse(req.body);
    const entities = await prisma.entity.findMany({
      where: { workspaceId: req.ws!.id, id: { in: body.spec.entityIds } },
      select: { id: true },
    });
    if (entities.length !== body.spec.entityIds.length) {
      throw new ApiError(404, 'NOT_FOUND', 'Company not found.');
    }
    const view = await prisma.savedChartView.create({
      data: { workspaceId: req.ws!.id, title: body.title, spec: body.spec, createdById: req.auth!.userId },
    });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'view.saved', targetType: 'saved_chart_view', targetId: view.id, meta: { title: body.title } });
    res.status(201).json({ view });
  }),
);

router.delete(
  '/analytics/views/:viewId',
  requireAuth,
  asyncH(async (req, res) => {
    const view = await prisma.savedChartView.findFirst({ where: { id: req.params.viewId } });
    if (!view) throw new ApiError(404, 'NOT_FOUND', 'View not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: view.workspaceId, userId: req.auth!.userId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'EDITOR'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    await prisma.savedChartView.delete({ where: { id: view.id } });
    res.json({ ok: true });
  }),
);

export default router;
