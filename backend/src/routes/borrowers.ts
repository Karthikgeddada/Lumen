// Borrower (entity) company pages — one borrower end to end for quarterly
// monitoring: package status per quarter (expected vs received), documents,
// covenant standing, and the metric trend. Land here from Portfolio or the
// Data Room; never a sidebar item.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { audit } from '../utils';
import { computePackage, lastNQuarters, seedPackageItems } from '../services/borrowers';
import { entityOverview } from '../services/analytics';

const router = Router();

async function entityInWorkspace(entityId: string, workspaceId: string) {
  const entity = await prisma.entity.findFirst({ where: { id: entityId, workspaceId } });
  if (!entity) throw new ApiError(404, 'NOT_FOUND', 'Borrower not found.');
  return entity;
}

async function packageItemInWorkspace(itemId: string, workspaceId: string) {
  const item = await prisma.packageItem.findFirst({
    where: { id: itemId, entity: { workspaceId } },
  });
  if (!item) throw new ApiError(404, 'NOT_FOUND', 'Package item not found.');
  return item;
}

// Full company page payload.
router.get(
  '/:workspaceId/borrowers/:entityId',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const entity = await entityInWorkspace(req.params.entityId, req.ws!.id);
    await seedPackageItems(entity.id); // lazy default backfill, like inboundEmail

    const [defs, docs, overview] = await Promise.all([
      prisma.covenantDefinition.findMany({
        where: { entityId: entity.id, deletedAt: null },
        include: { results: { orderBy: { computedAt: 'desc' } } },
      }),
      prisma.document.findMany({
        where: { entityId: entity.id, deletedAt: null },
        orderBy: { uploadedAt: 'desc' },
        take: 25,
        select: { id: true, name: true, fileType: true, status: true, source: true, uploadedAt: true, pageCount: true },
      }),
      entityOverview(entity.id, 4),
    ]);

    const latestResults = defs.map((d) => d.results[0]).filter(Boolean);
    const covenants = {
      total: defs.length,
      passes: latestResults.filter((r) => r!.status === 'PASS').length,
      fails: latestResults.filter((r) => r!.status === 'FAIL').length,
      nearBreaches: latestResults.filter((r) => {
        const nb = r!.nearBreach as { withinPct?: boolean } | null;
        return Boolean(nb?.withinPct);
      }).length,
      pendingReview: defs.filter((d) => d.status === 'AI_INFERRED').length,
      latestPeriod: latestResults[0]?.period ?? null,
    };

    res.json({
      entity: { id: entity.id, name: entity.name, createdAt: entity.createdAt },
      package: await computePackage(entity.id, lastNQuarters(4)),
      covenants,
      trend: overview, // { entity, metrics, segments, dataNotice }
      documents: docs,
    });
  }),
);

// Add an expected package item (what should arrive each quarter).
router.post(
  '/:workspaceId/borrowers/:entityId/package',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        label: z.string().trim().min(1).max(120),
        keywords: z.string().trim().min(1).max(500),
        required: z.boolean().default(true),
      })
      .parse(req.body);
    const entity = await entityInWorkspace(req.params.entityId, req.ws!.id);
    const item = await prisma.packageItem.create({
      data: { entityId: entity.id, label: body.label, keywords: body.keywords, required: body.required },
    });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'package.item_added', targetType: 'entity', targetId: entity.id, meta: { label: body.label } });
    res.status(201).json({ item });
  }),
);

// Edit an item's label / keywords / required flag.
router.patch(
  '/:workspaceId/borrowers/package/:itemId',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        label: z.string().trim().min(1).max(120).optional(),
        keywords: z.string().trim().min(1).max(500).optional(),
        required: z.boolean().optional(),
      })
      .parse(req.body);
    await packageItemInWorkspace(req.params.itemId, req.ws!.id);
    const item = await prisma.packageItem.update({ where: { id: req.params.itemId }, data: body });
    res.json({ item });
  }),
);

router.delete(
  '/:workspaceId/borrowers/package/:itemId',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const item = await packageItemInWorkspace(req.params.itemId, req.ws!.id);
    await prisma.packageItem.delete({ where: { id: item.id } });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'package.item_removed', targetType: 'entity', targetId: item.entityId, meta: { label: item.label } });
    res.json({ ok: true });
  }),
);

// Tag (or untag) a Data Room document to a borrower.
router.post(
  '/:workspaceId/borrowers/tag-document',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z.object({ documentId: z.string(), entityId: z.string().nullable() }).parse(req.body);
    const doc = await prisma.document.findFirst({
      where: { id: body.documentId, workspaceId: req.ws!.id, deletedAt: null },
    });
    if (!doc) throw new ApiError(404, 'NOT_FOUND', 'Document not found.');
    if (body.entityId) await entityInWorkspace(body.entityId, req.ws!.id);

    await prisma.document.update({ where: { id: doc.id }, data: { entityId: body.entityId } });
    await audit({
      workspaceId: req.ws!.id,
      actorId: req.auth!.userId,
      action: body.entityId ? 'document.tagged' : 'document.untagged',
      targetType: 'document',
      targetId: doc.id,
      meta: { entityId: body.entityId, name: doc.name },
    });
    res.json({ ok: true });
  }),
);

export default router;
