import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { audit } from '../utils';

const router = Router({ mergeParams: true }); // inherit :workspaceId from the app.use mount — routers do not merge parent params by default

// Collections group documents (e.g. “Earnings 2026”, “Vendor contracts”).

router.get(
  '/',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const collections = await prisma.collection.findMany({
      where: { workspaceId: req.ws!.id, deletedAt: null },
      select: {
        id: true, name: true, description: true, parentId: true, createdAt: true,
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
      .object({
        name: z.string().trim().min(1).max(60),
        description: z.string().trim().max(200).optional(),
        parentId: z.string().optional().nullable(),
      })
      .parse(req.body);
    if (body.parentId) {
      const parent = await prisma.collection.findFirst({
        where: { id: body.parentId, workspaceId: req.ws!.id, deletedAt: null },
      });
      if (!parent) throw new ApiError(404, 'NOT_FOUND', 'Parent folder not found.');
    }
    const collection = await prisma.collection.create({
      data: {
        workspaceId: req.ws!.id, name: body.name, description: body.description,
        parentId: body.parentId || null, createdById: req.auth!.userId,
      },
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
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        description: z.string().trim().max(200).optional(),
        parentId: z.string().optional().nullable(),
      })
      .parse(req.body);
    const existing = await prisma.collection.findFirst({
      where: { id: req.params.collectionId, workspaceId: req.ws!.id, deletedAt: null },
    });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Collection not found.');
    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === existing.id) throw new ApiError(400, 'INVALID_MOVE', 'A folder cannot contain itself.');
      const parent = await prisma.collection.findFirst({
        where: { id: body.parentId, workspaceId: req.ws!.id, deletedAt: null },
      });
      if (!parent) throw new ApiError(404, 'NOT_FOUND', 'Parent folder not found.');
      // Cycle guard: the new parent must not be a descendant of the folder being moved.
      let cursor: string | null = parent.id;
      while (cursor) {
        if (cursor === existing.id) throw new ApiError(400, 'INVALID_MOVE', 'Cannot move a folder into its own subtree.');
        const step: { parentId: string | null } | null = await prisma.collection.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
        cursor = step?.parentId ?? null;
      }
    }
    const collection = await prisma.collection.update({
      where: { id: existing.id },
      data: { ...body, ...(body.parentId !== undefined ? { parentId: body.parentId || null } : {}) },
    });
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
    // Nothing is destroyed: documents move out of the folder, subfolders move to the root.
    await prisma.$transaction([
      prisma.document.updateMany({ where: { collectionId: existing.id }, data: { collectionId: null } }),
      prisma.collection.updateMany({ where: { parentId: existing.id }, data: { parentId: null } }),
      prisma.collection.update({ where: { id: existing.id }, data: { deletedAt: new Date() } }),
    ]);
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'collection.deleted', targetType: 'collection', targetId: existing.id });
    res.json({ ok: true });
  }),
);

export default router;
