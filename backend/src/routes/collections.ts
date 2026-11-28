import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { audit } from '../utils';

const router = Router({ mergeParams: true }); // inherit :workspaceId from the app.use mount — routers do not merge parent params by default

// Collections group documents (e.g. “Earnings 2026”, “Vendor contracts”).
// Data Room phase 1: folders can be scoped to a company/subsidiary (entity)
// and typed — PERIOD folders carry a periodKey ("Q3 2026"), CUSTOM are free-form.

const MAX_FOLDER_DEPTH = 5; // root folder = depth 1

// Depth the folder would sit at if placed under parentId (null = root = depth 1).
function depthUnderParent(parentId: string | null, _collectionId?: string): Promise<number> {
  if (!parentId) return Promise.resolve(1);
  return folderDepth(parentId).then((parentDepth) => parentDepth + 1);
}

// Walk from the folder up to its root; depth = number of folders on the path.
async function folderDepth(collectionId: string): Promise<number> {
  let depth = 1;
  let cursor: string | null = collectionId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const step: { parentId: string | null } | null = await prisma.collection.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!step) break;
    cursor = step.parentId;
    if (cursor) depth += 1;
  }
  return depth;
}

// Height of the folder's subtree (1 for a leaf). Defensive against cycles —
// the authoritative cycle guard lives in PATCH before moves are applied.
async function folderHeight(collectionId: string): Promise<number> {
  const children = await prisma.collection.findMany({
    where: { parentId: collectionId, deletedAt: null },
    select: { id: true },
  });
  let height = 1;
  for (const child of children) {
    height = Math.max(height, 1 + (await folderHeight(child.id)));
  }
  return height;
}

async function assertEntityInWorkspace(entityId: string, workspaceId: string) {
  const entity = await prisma.entity.findFirst({ where: { id: entityId, workspaceId } });
  if (!entity) throw new ApiError(404, 'NOT_FOUND', 'Company not found.');
  return entity;
}

// PERIOD folders are always entity-scoped and need a well-formed periodKey.
function validateFolderShape(input: { kind?: string; entityId?: string | null; periodKey?: string | null }): 'PERIOD' | 'CUSTOM' {
  const kind = input.kind ?? 'CUSTOM';
  if (kind !== 'PERIOD' && kind !== 'CUSTOM') {
    throw new ApiError(400, 'INVALID_KIND', 'Folder kind must be PERIOD or CUSTOM.');
  }
  if (kind === 'PERIOD') {
    if (!input.entityId) throw new ApiError(400, 'PERIOD_NEEDS_ENTITY', 'A period folder must belong to a company or subsidiary.');
    if (!input.periodKey || !/^Q[1-4]\s?\d{4}$/.test(input.periodKey)) {
      throw new ApiError(400, 'INVALID_PERIOD', 'A period folder needs a period like “Q3 2026”.');
    }
  }
  return kind;
}

router.get(
  '/',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const collections = await prisma.collection.findMany({
      where: { workspaceId: req.ws!.id, deletedAt: null },
      select: {
        id: true, name: true, description: true, parentId: true, createdAt: true,
        entityId: true, kind: true, periodKey: true,
        entity: { select: { id: true, name: true } },
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
        entityId: z.string().optional().nullable(),
        kind: z.string().optional(),
        periodKey: z.string().optional().nullable(),
      })
      .parse(req.body);
    if (body.parentId) {
      const parent = await prisma.collection.findFirst({
        where: { id: body.parentId, workspaceId: req.ws!.id, deletedAt: null },
      });
      if (!parent) throw new ApiError(404, 'NOT_FOUND', 'Parent folder not found.');
    }
    const kind = validateFolderShape({ kind: body.kind, entityId: body.entityId ?? null, periodKey: body.periodKey ?? null });
    if (body.entityId) await assertEntityInWorkspace(body.entityId, req.ws!.id);
    // Depth guard: the new folder sits one level below its parent.
    const depth = await depthUnderParent(body.parentId || null);
    if (depth > MAX_FOLDER_DEPTH) {
      throw new ApiError(400, 'DEPTH_LIMIT', `Folders can nest at most ${MAX_FOLDER_DEPTH} levels deep.`);
    }
    // PERIOD folders are unique per company per period.
    if (kind === 'PERIOD' && body.entityId && body.periodKey) {
      const existing = await prisma.collection.findFirst({
        where: { workspaceId: req.ws!.id, entityId: body.entityId, kind: 'PERIOD', periodKey: body.periodKey, deletedAt: null },
      });
      if (existing) throw new ApiError(400, 'PERIOD_EXISTS', `A “${body.periodKey}” folder already exists for this company.`);
    }
    const collection = await prisma.collection.create({
      data: {
        workspaceId: req.ws!.id, name: body.name, description: body.description,
        parentId: body.parentId || null, createdById: req.auth!.userId,
        entityId: body.entityId || null, kind, periodKey: kind === 'PERIOD' ? body.periodKey || null : null,
      },
    });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'collection.created', targetType: 'collection', targetId: collection.id, meta: { kind, entityId: body.entityId ?? null, periodKey: body.periodKey ?? null } });
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
        entityId: z.string().optional().nullable(),
      })
      .parse(req.body);
    const existing = await prisma.collection.findFirst({
      where: { id: req.params.collectionId, workspaceId: req.ws!.id, deletedAt: null },
    });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Collection not found.');
    if (body.entityId) await assertEntityInWorkspace(body.entityId, req.ws!.id);
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
      // Depth guard: parent depth + this subtree's height must fit the limit.
      const parentDepth = await folderDepth(parent.id);
      const height = await folderHeight(existing.id);
      if (parentDepth + height > MAX_FOLDER_DEPTH) {
        throw new ApiError(400, 'DEPTH_LIMIT', `Folders can nest at most ${MAX_FOLDER_DEPTH} levels deep.`);
      }
    }
    const collection = await prisma.collection.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId || null } : {}),
        ...(body.entityId !== undefined ? { entityId: body.entityId || null } : {}),
      },
    });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'collection.updated', targetType: 'collection', targetId: collection.id, meta: { parentId: body.parentId ?? undefined, entityId: body.entityId ?? undefined } });
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
