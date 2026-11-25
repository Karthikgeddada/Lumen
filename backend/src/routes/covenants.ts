import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { audit } from '../utils';
import { extractCovenantDefinitions, runCovenantTests } from '../services/covenants';

const router = Router();

// List covenants for a workspace (optionally one entity), with full result
// history, the entity, and the source document for each definition.
router.get(
  '/workspaces/:workspaceId/covenants',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const { entityId } = z.object({ entityId: z.string().optional() }).parse(req.query);

    const definitions = await prisma.covenantDefinition.findMany({
      where: {
        workspaceId: req.ws!.id,
        deletedAt: null,
        ...(entityId ? { entityId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: {
        entity: { select: { id: true, name: true } },
        document: { select: { id: true, name: true } },
        results: { orderBy: { computedAt: 'desc' } },
      },
    });

    // Periods the analytics module has observed for the first entity — used
    // by the UI to offer meaningful "test against…" choices.
    let periods: string[] = [];
    if (definitions.length > 0 || entityId) {
      const targetEntityId = entityId ?? definitions[0]?.entityId;
      if (targetEntityId) {
        const obs = await prisma.metricObservation.findMany({
          where: { entityId: targetEntityId },
          distinct: ['period'],
          orderBy: { period: 'asc' },
          select: { period: true },
        });
        periods = obs.map((o) => o.period);
      }
    }

    res.json({ definitions, periods });
  }),
);

// Manually define a covenant (no AI involved).
router.post(
  '/workspaces/:workspaceId/covenants',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        entityId: z.string(),
        key: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, 'key must be snake_case'),
        label: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000).optional(),
        metricKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9_]+$/, 'metricKey must be snake_case'),
        comparator: z.enum(['LTE', 'GTE']),
        threshold: z.number().finite(),
        unit: z.string().trim().max(20).default('x'),
        period: z.enum(['quarter', 'ttm']).default('quarter'),
        documentId: z.string().optional(),
      })
      .parse(req.body);

    const entity = await prisma.entity.findFirst({ where: { id: body.entityId, workspaceId: req.ws!.id } });
    if (!entity) throw new ApiError(404, 'NOT_FOUND', 'Entity not found.');

    const definition = await prisma.covenantDefinition.create({
      data: { ...body, workspaceId: req.ws!.id, status: 'REVIEWED', createdById: req.auth!.userId },
      include: { entity: { select: { id: true, name: true } }, results: true },
    });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'covenant.created', targetType: 'covenant', targetId: definition.id });
    res.status(201).json({ definition });
  }),
);

// Extract covenant definitions from an uploaded credit agreement with AI.
router.post(
  '/workspaces/:workspaceId/covenants/extract',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z.object({ documentId: z.string(), entityId: z.string() }).parse(req.body);
    const outcome = await extractCovenantDefinitions(req.ws!.id, body.documentId, body.entityId, req.auth!.userId);
    res.status(201).json(outcome);
  }),
);

// Run all of an entity's covenants against a period (defaults to latest observed).
router.post(
  '/workspaces/:workspaceId/covenants/test',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({ entityId: z.string(), period: z.string().trim().max(12).optional() })
      .parse(req.body ?? {});
    const outcome = await runCovenantTests(req.ws!.id, body.entityId, body.period);
    res.json(outcome);
  }),
);

// Definition detail with its full result history.
router.get(
  '/covenants/:definitionId',
  requireAuth,
  asyncH(async (req, res) => {
    const definition = await prisma.covenantDefinition.findFirst({
      where: { id: req.params.definitionId, deletedAt: null },
      include: {
        entity: { select: { id: true, name: true } },
        document: { select: { id: true, name: true } },
        results: { orderBy: { computedAt: 'desc' } },
      },
    });
    if (!definition) throw new ApiError(404, 'NOT_FOUND', 'Covenant not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: definition.workspaceId, userId: req.auth!.userId, deletedAt: null },
    });
    if (!membership) throw new ApiError(404, 'NOT_FOUND', 'Covenant not found.');
    res.json({ definition });
  }),
);

// Review / edit a definition. Reviewing marks it REVIEWED (human confirmed).
router.patch(
  '/covenants/:definitionId',
  requireAuth,
  asyncH(async (req, res) => {
    const definition = await prisma.covenantDefinition.findFirst({ where: { id: req.params.definitionId, deletedAt: null } });
    if (!definition) throw new ApiError(404, 'NOT_FOUND', 'Covenant not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: definition.workspaceId, userId: req.auth!.userId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'EDITOR'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }

    const body = z
      .object({
        label: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        metricKey: z.string().trim().regex(/^[a-z0-9_]+$/).max(80).optional(),
        comparator: z.enum(['LTE', 'GTE']).optional(),
        threshold: z.number().finite().optional(),
        unit: z.string().trim().max(20).optional(),
        period: z.enum(['quarter', 'ttm']).optional(),
        status: z.enum(['AI_INFERRED', 'REVIEWED']).optional(),
      })
      .parse(req.body);

    const updated = await prisma.covenantDefinition.update({
      where: { id: definition.id },
      data: {
        ...body,
        ...(body.status === 'REVIEWED'
          ? { reviewedById: req.auth!.userId, reviewedAt: new Date() }
          : {}),
      },
      include: { entity: { select: { id: true, name: true } }, results: { orderBy: { computedAt: 'desc' } } },
    });
    await audit({ workspaceId: definition.workspaceId, actorId: req.auth!.userId, action: 'covenant.reviewed', targetType: 'covenant', targetId: definition.id });
    res.json({ definition: updated });
  }),
);

// Soft-delete a definition (history preserved).
router.delete(
  '/covenants/:definitionId',
  requireAuth,
  asyncH(async (req, res) => {
    const definition = await prisma.covenantDefinition.findFirst({ where: { id: req.params.definitionId, deletedAt: null } });
    if (!definition) throw new ApiError(404, 'NOT_FOUND', 'Covenant not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: definition.workspaceId, userId: req.auth!.userId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'EDITOR'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    await prisma.covenantDefinition.update({ where: { id: definition.id }, data: { deletedAt: new Date() } });
    res.json({ ok: true });
  }),
);

export default router;
