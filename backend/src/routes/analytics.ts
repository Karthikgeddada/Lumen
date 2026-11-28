import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { runCovenantTests } from '../services/covenants';
import { audit } from '../utils';
import { entityOverview } from '../services/analytics';
import { seedPackageItems } from '../services/borrowers';

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

    const observation = await prisma.metricObservation.upsert({
      where: { entityId_metricKey_period: { entityId: body.entityId, metricKey: body.metricKey, period: body.period.replace(/\s/, ' ') } },
      create: { ...body, period: body.period.replace(/\s/, ' ') },
      update: { ...body, period: body.period.replace(/\s/, ' ') },
    });
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

export default router;
