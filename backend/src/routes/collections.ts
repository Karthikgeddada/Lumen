import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { audit } from '../utils';

const router = Router();

// Collections group documents (e.g. “Earnings 2026”, “Vendor contracts”).

router.get(
  '/',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const collections = await prisma.collection.findMany({
      where: { workspaceId: req.ws!.id, deletedAt: null },
      select: {
        id: true, name: true, description: true, createdAt: true,
        _count: { select: { documents: { where: { deletedAt: null } } } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ collections });
  }),
);

router.post(
  '/',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(60), description: z.string().trim().max(200).optional() })
      .parse(req.body);
    const collection = await prisma.collection.create({
      data: { workspaceId: req.ws!.id, name: body.name, description: body.description, createdById: req.auth!.userId },
    });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'collection.created', targetType: 'collection', targetId: collection.id });
    res.status(201).json({ collection });
  }),
);

router.patch(
  '/:collectionId',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(60).optional(), description: z.string().trim().max(200).optional() })
      .parse(req.body);
    const existing = await prisma.collection.findFirst({
      where: { id: req.params.collectionId, workspaceId: req.ws!.id, deletedAt: null },
    });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Collection not found.');
    const collection = await prisma.collection.update({ where: { id: existing.id }, data: body });
    res.json({ collection });
  }),
);

router.delete(
  '/:collectionId',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const existing = await prisma.collection.findFirst({
      where: { id: req.params.collectionId, workspaceId: req.ws!.id, deletedAt: null },
    });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Collection not found.');
    // Documents survive — they just move out of the deleted collection.
    await prisma.$transaction([
      prisma.document.updateMany({ where: { collectionId: existing.id }, data: { collectionId: null } }),
      prisma.collection.update({ where: { id: existing.id }, data: { deletedAt: new Date() } }),
    ]);
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'collection.deleted', targetType: 'collection', targetId: existing.id });
    res.json({ ok: true });
  }),
);

export default router;
