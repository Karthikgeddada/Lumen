import { Router } from 'express';
import { createHash } from 'crypto';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../prisma';
import { config, hasStorage } from '../config';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace, assertDocAccess } from '../middleware/auth';
import { audit, paginate, pageMeta } from '../utils';
import { putObject, presignedDownloadUrl, storageKey, storageMode, dbGetObject, verifyFileToken } from '../services/storage';
import { enqueue } from '../services/queue';
import { SUPPORTED_EXTENSIONS, extOf } from '../services/parsers';

const router = Router({ mergeParams: true }); // inherit :workspaceId from the app.use mount — routers do not merge parent params by default

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
    if (storageMode() === 's3' && !hasStorage()) {
      throw new ApiError(503, 'STORAGE_UNCONFIGURED', 'S3 storage is selected (STORAGE_DRIVER=s3) but not configured. Set the STORAGE_* environment variables, or remove STORAGE_DRIVER to store files in the database.');
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

      // Duplicate detection: identical bytes already in this workspace → skip
      // with a pointer to the existing document, never a silent second copy.
      const contentHash = createHash('sha256').update(file.buffer).digest('hex');
      const duplicate = await prisma.document.findFirst({
        where: { workspaceId: req.ws!.id, contentHash, deletedAt: null },
        select: { id: true, name: true },
      });
      if (duplicate) {
        rejected.push({ file: file.originalname, reason: `Duplicate of “${duplicate.name}” — already uploaded to this workspace.` });
        await audit({
          workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'document.duplicate_rejected',
          targetType: 'document', targetId: duplicate.id, meta: { name: file.originalname, sizeBytes: file.size },
          ip: req.ip,
        });
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
          contentHash,
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
    // entityId=none lists unassigned documents (the Data Room “Unassigned” inbox);
    // any other value filters to that company/subsidiary.
    const entityIdRaw = req.query.entityId as string | undefined;
    const status = req.query.status as string | undefined;
    const sort = (req.query.sort as 'name' | 'uploadedAt' | 'sizeBytes' | undefined) ?? 'uploadedAt';
    const order = (req.query.order as 'asc' | 'desc' | undefined) ?? 'desc';

    const where = {
      workspaceId: req.ws!.id,
      deletedAt: null,
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      ...(collectionId ? { collectionId } : {}),
      ...(entityIdRaw ? { entityId: entityIdRaw === 'none' ? null : entityIdRaw } : {}),
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
          source: true, emailFrom: true, emailSubject: true, assignmentStatus: true,
          collection: { select: { id: true, name: true } },
          entity: { select: { id: true, name: true } },
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
        // Triage only supports dismissing the confirmation prompt today;
        // confirming goes through /borrowers/tag-document so package and audit
        // stay in sync.
        assignmentStatus: z.enum(['DISMISSED']).optional(),
      })
      .parse(req.body);
    if (body.collectionId) {
      // Tenancy: the target folder must belong to the document's own workspace.
      const document0 = await prisma.document.findUnique({ where: { id: req.params.documentId }, select: { workspaceId: true } });
      const collection = await prisma.collection.findFirst({
        where: { id: body.collectionId, workspaceId: document0?.workspaceId, deletedAt: null },
      });
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
    if (storageMode() === 's3' && !hasStorage()) throw new ApiError(503, 'STORAGE_UNCONFIGURED', 'S3 storage is selected but not configured. Set the STORAGE_* environment variables, or remove STORAGE_DRIVER to store files in the database.');
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

// DB-storage streaming — ?t= is HMAC-signed and time-limited (same trust
// model as an S3 presigned URL; no session required).
router.get(
  '/:documentId/file',
  asyncH(async (req, res) => {
    if (!verifyFileToken(req.params.documentId, typeof req.query.t === 'string' ? req.query.t : undefined)) {
      throw new ApiError(403, 'FILE_LINK_EXPIRED', 'This download link has expired. Request a new one.');
    }
    const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
    if (!doc || doc.deletedAt || !doc.storageKey || doc.storageKey === 'pending' || doc.storageKey === 'demo/placeholder') {
      throw new ApiError(404, 'NOT_FOUND', 'Document file not found.');
    }
    const obj = await dbGetObject(doc.storageKey);
    if (!obj) throw new ApiError(404, 'NOT_FOUND', 'Document file not found.');
    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.name.replace(/["\\]/g, '')}"`);
    res.setHeader('Content-Length', String(obj.data.length));
    res.send(obj.data);
  }),
);

export default router;
