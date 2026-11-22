import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../prisma';
import { config, hasStorage } from '../config';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace, assertDocAccess } from '../middleware/auth';
import { audit, paginate, pageMeta } from '../utils';
import { putObject, presignedDownloadUrl, storageKey } from '../services/storage';
import { enqueue } from '../services/queue';
import { SUPPORTED_EXTENSIONS, extOf } from '../services/parsers';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 20 },
});

// Upload — multipart/form-data with one or more `files`, optional `collectionId`.
// Files go straight to object storage; processing runs on the worker.
router.post(
  '/',
  requireAuth,
  requireWorkspace('EDITOR'),
  upload.array('files', 20),
  asyncH(async (req, res) => {
    if (!hasStorage()) {
      throw new ApiError(503, 'STORAGE_UNCONFIGURED', 'Object storage is not configured on this deployment. Set the STORAGE_* environment variables.');
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new ApiError(400, 'NO_FILES', 'No files were uploaded.');

    const collectionId = (req.body.collectionId as string | undefined) || null;
    if (collectionId) {
      const collection = await prisma.collection.findFirst({
        where: { id: collectionId, workspaceId: req.ws!.id, deletedAt: null },
      });
      if (!collection) throw new ApiError(404, 'NOT_FOUND', 'Collection not found.');
    }

    const created = [];
    const rejected: { file: string; reason: string }[] = [];

    for (const file of files) {
      const ext = extOf(file.originalname);
      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        rejected.push({ file: file.originalname, reason: `Unsupported format .${ext}. Supported: PDF, DOC, DOCX, XLS, XLSX, CSV, TXT.` });
        continue;
      }

      const doc = await prisma.document.create({
        data: {
          workspaceId: req.ws!.id,
          collectionId,
          name: file.originalname,
          fileType: ext,
          mimeType: file.mimetype || 'application/octet-stream',
          sizeBytes: file.size,
          status: 'UPLOADING',
          storageKey: 'pending',
          ownerId: req.auth!.userId,
        },
      });

      const key = storageKey(req.ws!.id, doc.id, ext);
      await putObject(key, file.buffer, file.mimetype || 'application/octet-stream');

      await prisma.$transaction([
        prisma.document.update({ where: { id: doc.id }, data: { storageKey: key, status: 'QUEUED' } }),
        prisma.workspace.update({
          where: { id: req.ws!.id },
          data: { storageUsedBytes: { increment: file.size } },
        }),
      ]);
      await enqueue('PROCESS_DOCUMENT', { documentId: doc.id });
      await audit({
        workspaceId: req.ws!.id,
        actorId: req.auth!.userId,
        action: 'document.uploaded',
        targetType: 'document',
        targetId: doc.id,
        meta: { name: doc.name, sizeBytes: file.size },
        ip: req.ip,
      });

      created.push(await prisma.document.findUnique({ where: { id: doc.id } }));
    }

    if (!created.length) throw new ApiError(400, 'ALL_REJECTED', 'None of the files could be accepted.', { rejected });
    res.status(201).json({ documents: created, rejected });
  }),
);

// Library listing with search / filter / sort / pagination.
router.get(
  '/',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const { skip, take, page, limit } = paginate(req.query as Record<string, unknown>);
    const q = (req.query.q as string | undefined)?.trim();
    const collectionId = req.query.collectionId as string | undefined;
    const status = req.query.status as string | undefined;
    const sort = (req.query.sort as 'name' | 'uploadedAt' | 'sizeBytes' | undefined) ?? 'uploadedAt';
    const order = (req.query.order as 'asc' | 'desc' | undefined) ?? 'desc';

    const where = {
      workspaceId: req.ws!.id,
      deletedAt: null,
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      ...(collectionId ? { collectionId } : {}),
      ...(status ? { status: status as never } : {}),
    };

    const [total, documents] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where,
        orderBy: { [sort]: order },
        skip,
        take,
        select: {
          id: true, name: true, fileType: true, sizeBytes: true, pageCount: true,
          status: true, error: true, isDemo: true, uploadedAt: true, updatedAt: true, processedAt: true,
          collection: { select: { id: true, name: true } },
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);
    res.json({ documents, meta: pageMeta(total, page, limit) });
  }),
);

// Document detail — full extracted structure for the viewer.
router.get(
  '/:documentId',
  requireAuth,
  asyncH(async (req, res) => {
    const { workspaceId } = await assertDocAccess(req, req.params.documentId);
    const doc = await prisma.document.findFirst({
      where: { id: req.params.documentId, workspaceId, deletedAt: null },
      include: {
        collection: { select: { id: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
        summary: true,
        sections: { orderBy: { order: 'asc' }, take: 4000 },
        tables: { orderBy: { order: 'asc' }, include: { rows: { orderBy: { rowIndex: 'asc' }, take: 200 } } },
        _count: { select: { chunks: true, tables: true, sections: true } },
      },
    });
    if (!doc) throw new ApiError(404, 'NOT_FOUND', 'Document not found.');
    res.json({ document: doc });
  }),
);

// Rename / move to collection.
router.patch(
  '/:documentId',
  requireAuth,
  asyncH(async (req, res) => {
    await assertDocAccess(req, req.params.documentId, 'EDITOR');
    const body = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        collectionId: z.string().nullable().optional(),
      })
      .parse(req.body);
    if (body.collectionId) {
      const collection = await prisma.collection.findFirst({ where: { id: body.collectionId, deletedAt: null } });
      if (!collection) throw new ApiError(404, 'NOT_FOUND', 'Collection not found.');
    }
    const document = await prisma.document.update({ where: { id: req.params.documentId }, data: body });
    await audit({ workspaceId: document.workspaceId, actorId: req.auth!.userId, action: 'document.updated', targetType: 'document', targetId: document.id });
    res.json({ document });
  }),
);

// Soft delete (recoverable; file stays in object storage).
router.delete(
  '/:documentId',
  requireAuth,
  asyncH(async (req, res) => {
    const { workspaceId } = await assertDocAccess(req, req.params.documentId, 'EDITOR');
    const doc = await prisma.document.update({
      where: { id: req.params.documentId },
      data: { deletedAt: new Date() },
    });
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { storageUsedBytes: { decrement: doc.sizeBytes } },
    });
    await audit({ workspaceId, actorId: req.auth!.userId, action: 'document.deleted', targetType: 'document', targetId: doc.id });
    res.json({ ok: true });
  }),
);

// Retry failed processing.
router.post(
  '/:documentId/retry',
  requireAuth,
  asyncH(async (req, res) => {
    const { workspaceId } = await assertDocAccess(req, req.params.documentId, 'EDITOR');
    const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
    if (doc?.isDemo) throw new ApiError(409, 'DEMO_DOCUMENT', 'Demo documents cannot be reprocessed.');
    if (!hasStorage()) throw new ApiError(503, 'STORAGE_UNCONFIGURED', 'Object storage is not configured on this deployment.');
    await prisma.document.update({
      where: { id: req.params.documentId },
      data: { status: 'QUEUED', error: null, deletedAt: null },
    });
    await enqueue('PROCESS_DOCUMENT', { documentId: req.params.documentId });
    await audit({ workspaceId, actorId: req.auth!.userId, action: 'document.retry', targetType: 'document', targetId: req.params.documentId });
    res.json({ ok: true });
  }),
);

// Secure download — time-limited presigned URL, audit-logged.
router.get(
  '/:documentId/download',
  requireAuth,
  asyncH(async (req, res) => {
    const { workspaceId } = await assertDocAccess(req, req.params.documentId);
    const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
    if (!doc || doc.deletedAt) throw new ApiError(404, 'NOT_FOUND', 'Document not found.');
    if (doc.isDemo || doc.storageKey === 'demo/placeholder' || doc.storageKey === 'pending') {
      throw new ApiError(404, 'NO_FILE', 'Demo documents have no original file to download.');
    }
    const url = await presignedDownloadUrl(doc.storageKey, doc.name);
    await audit({ workspaceId, actorId: req.auth!.userId, action: 'document.download', targetType: 'document', targetId: doc.id });
    res.json({ url, expiresInSeconds: 300 });
  }),
);

export default router;
