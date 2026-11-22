import { Router } from 'express';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { audit } from '../utils';
import { enqueue } from '../services/queue';
import { runExtraction, suggestFields } from '../services/extract';
import { ingestFromExtraction } from '../services/analytics';

const router = Router();

// Templates (built-in + workspace custom)
router.get(
  '/workspaces/:workspaceId/extractions/templates',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const templates = await prisma.extractionTemplate.findMany({
      where: { OR: [{ workspaceId: null }, { workspaceId: req.ws!.id }] },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ templates });
  }),
);

router.post(
  '/workspaces/:workspaceId/extractions/templates',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(300).optional(),
        fields: z.array(z.object({
          key: z.string().trim().min(1).max(60),
          label: z.string().trim().min(1).max(120),
          type: z.enum(['text', 'number', 'currency', 'percent', 'date']).default('text'),
          description: z.string().trim().max(300).optional(),
        })).min(1).max(40),
      })
      .parse(req.body);
    const template = await prisma.extractionTemplate.create({
      data: { workspaceId: req.ws!.id, name: body.name, description: body.description, fields: body.fields },
    });
    res.status(201).json({ template });
  }),
);

// Task list
router.get(
  '/workspaces/:workspaceId/extractions',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const tasks = await prisma.extractionTask.findMany({
      where: { workspaceId: req.ws!.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, name: true, status: true, error: true, createdAt: true, completedAt: true,
        documentIds: true,
        _count: { select: { fields: true, results: { where: { status: 'NEEDS_REVIEW' } } } },
      },
    });
    res.json({ tasks });
  }),
);

// Create task + fields, enqueue the run.
router.post(
  '/workspaces/:workspaceId/extractions',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        templateId: z.string().optional().nullable(),
        documentIds: z.array(z.string()).min(1).max(20),
        fields: z.array(z.object({
          key: z.string().trim().min(1).max(60),
          label: z.string().trim().min(1).max(120),
          type: z.enum(['text', 'number', 'currency', 'percent', 'date']).default('text'),
          description: z.string().trim().max(300).optional(),
          isCustom: z.boolean().optional().default(false),
        })).min(1).max(40),
      })
      .parse(req.body);

    const validDocs = await prisma.document.findMany({
      where: { id: { in: body.documentIds }, workspaceId: req.ws!.id, deletedAt: null, status: 'COMPLETED' },
      select: { id: true },
    });
    if (!validDocs.length) throw new ApiError(400, 'NO_DOCUMENTS', 'Select at least one processed document.');

    const task = await prisma.extractionTask.create({
      data: {
        workspaceId: req.ws!.id,
        name: body.name,
        templateId: body.templateId ?? null,
        documentIds: validDocs.map((d) => d.id),
        createdById: req.auth!.userId,
        fields: {
          create: body.fields.map((f, i) => ({
            key: f.key, label: f.label, type: f.type, description: f.description, order: i, isCustom: f.isCustom ?? false,
          })),
        },
      },
      include: { fields: true },
    });
    await enqueue('RUN_EXTRACTION', { taskId: task.id });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'extraction.run', targetType: 'extraction_task', targetId: task.id, meta: { name: task.name } });
    res.status(201).json({ task });
  }),
);

// Task detail with fields + results (evidence included for the review panel)
router.get(
  '/extraction-tasks/:taskId',
  requireAuth,
  asyncH(async (req, res) => {
    const task = await prisma.extractionTask.findFirst({
      where: { id: req.params.taskId, deletedAt: null },
      include: {
        fields: { orderBy: { order: 'asc' } },
        results: {
          include: {
            field: { select: { key: true, label: true, type: true } },
            document: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Extraction task not found.');
    // Workspace isolation: caller must be a member of the owning workspace.
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: task.workspaceId, userId: req.auth!.userId, deletedAt: null },
    });
    if (!membership) throw new ApiError(404, 'NOT_FOUND', 'Extraction task not found.');
    res.json({ task });
  }),
);

router.patch(
  '/extraction-tasks/:taskId',
  requireAuth,
  asyncH(async (req, res) => {
    const task = await prisma.extractionTask.findFirst({ where: { id: req.params.taskId, deletedAt: null } });
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Extraction task not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: task.workspaceId, userId: req.auth!.userId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'EDITOR'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    const body = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
    const updated = await prisma.extractionTask.update({ where: { id: task.id }, data: { name: body.name } });
    res.json({ task: updated });
  }),
);

router.delete(
  '/extraction-tasks/:taskId',
  requireAuth,
  asyncH(async (req, res) => {
    const task = await prisma.extractionTask.findFirst({ where: { id: req.params.taskId, deletedAt: null } });
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Extraction task not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: task.workspaceId, userId: req.auth!.userId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'EDITOR'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    await prisma.extractionTask.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
    res.json({ ok: true });
  }),
);

// Re-run (replaces previous results)
router.post(
  '/extraction-tasks/:taskId/rerun',
  requireAuth,
  asyncH(async (req, res) => {
    const task = await prisma.extractionTask.findFirst({ where: { id: req.params.taskId, deletedAt: null } });
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Extraction task not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: task.workspaceId, userId: req.auth!.userId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'EDITOR'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    await prisma.extractionTask.update({ where: { id: task.id }, data: { status: 'PENDING', error: null } });
    await enqueue('RUN_EXTRACTION', { taskId: task.id });
    res.json({ ok: true });
  }),
);

// AI-suggested fields from a document's real structure.
router.post(
  '/extraction-tasks/:taskId/suggest-fields',
  requireAuth,
  asyncH(async (req, res) => {
    const task = await prisma.extractionTask.findFirst({ where: { id: req.params.taskId, deletedAt: null } });
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Extraction task not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: task.workspaceId, userId: req.auth!.userId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'EDITOR'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    const { documentId } = z.object({ documentId: z.string() }).parse(req.body);
    const fields = await suggestFields(task.workspaceId, documentId);
    res.json({ fields });
  }),
);

// Add a custom field to a task.
router.post(
  '/extraction-tasks/:taskId/fields',
  requireAuth,
  asyncH(async (req, res) => {
    const task = await prisma.extractionTask.findFirst({ where: { id: req.params.taskId, deletedAt: null } });
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Extraction task not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: task.workspaceId, userId: req.auth!.userId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'EDITOR'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    const body = z.object({
      key: z.string().trim().min(1).max(60),
      label: z.string().trim().min(1).max(120),
      type: z.enum(['text', 'number', 'currency', 'percent', 'date']).default('text'),
      description: z.string().trim().max(300).optional(),
    }).parse(req.body);
    const order = await prisma.extractionField.count({ where: { taskId: task.id } });
    const field = await prisma.extractionField.create({
      data: { taskId: task.id, key: body.key, label: body.label, type: body.type, description: body.description, order, isCustom: true },
    });
    res.status(201).json({ field });
  }),
);

// Review an extraction result: verify / edit / reject / flag.
router.patch(
  '/extraction-results/:resultId',
  requireAuth,
  asyncH(async (req, res) => {
    const result = await prisma.extractionResult.findUnique({
      where: { id: req.params.resultId },
      include: { task: { select: { id: true, workspaceId: true } } },
    });
    if (!result) throw new ApiError(404, 'NOT_FOUND', 'Result not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: result.task.workspaceId, userId: req.auth!.userId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'REVIEWER', 'EDITOR'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Reviewing requires the Reviewer role or higher.');
    }

    const body = z
      .object({
        value: z.string().max(500).nullable().optional(),
        status: z.enum(['VERIFIED', 'NEEDS_REVIEW', 'REJECTED', 'MISSING']).optional(),
        flagged: z.boolean().optional(),
        note: z.string().trim().max(500).optional(),
      })
      .parse(req.body);

    const updated = await prisma.extractionResult.update({
      where: { id: result.id },
      data: {
        ...(body.value !== undefined ? { value: body.value } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.flagged !== undefined ? { flagged: body.flagged } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        reviewedById: req.auth!.userId,
        reviewedAt: new Date(),
      },
    });
    if (body.status === 'VERIFIED') {
      await audit({ workspaceId: result.task.workspaceId, actorId: req.auth!.userId, action: 'extraction.verified', targetType: 'extraction_result', targetId: result.id });
    }
    res.json({ result: updated });
  }),
);

// Feed verified results into analytics (as AI-inferred observations).
router.post(
  '/extraction-tasks/:taskId/ingest-analytics',
  requireAuth,
  asyncH(async (req, res) => {
    const task = await prisma.extractionTask.findFirst({ where: { id: req.params.taskId, deletedAt: null } });
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Extraction task not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: task.workspaceId, userId: req.auth!.userId, deletedAt: null },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'EDITOR'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    // Entity named after the task; created on first ingest.
    const entity = await prisma.entity.upsert({
      where: { workspaceId_name: { workspaceId: task.workspaceId, name: task.name } },
      create: { workspaceId: task.workspaceId, name: task.name },
      update: {},
    });
    const created = await ingestFromExtraction(task.workspaceId, task.id);
    res.json({ ok: true, entityId: entity.id, created });
  }),
);

// Export: CSV or Excel, one row per field × document.
router.get(
  '/extraction-tasks/:taskId/export',
  requireAuth,
  asyncH(async (req, res) => {
    const task = await prisma.extractionTask.findFirst({
      where: { id: req.params.taskId, deletedAt: null },
      include: {
        fields: { orderBy: { order: 'asc' } },
        results: { include: { document: { select: { name: true } } } },
      },
    });
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Extraction task not found.');
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: task.workspaceId, userId: req.auth!.userId, deletedAt: null },
    });
    if (!membership) throw new ApiError(404, 'NOT_FOUND', 'Extraction task not found.');

    const format = (req.query.format as string) === 'csv' ? 'csv' : 'xlsx';
    const rows: (string | number)[][] = [
      ['Field', 'Document', 'Value', 'Unit', 'Confidence', 'Status', 'Page', 'Sheet', 'Cell', 'Evidence'],
    ];
    for (const r of task.results) {
      rows.push([
        r.fieldId ? task.fields.find((f) => f.id === r.fieldId)?.label ?? r.fieldId : '',
        r.document?.name ?? '',
        r.value ?? '',
        r.unit ?? '',
        Math.round(r.confidence * 100),
        r.status,
        r.page ?? '',
        r.sheet ?? '',
        r.cell ?? '',
        r.excerpt ?? '',
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 32 }, { wch: 40 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 60 }];

    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${task.name.replace(/["\\]/g, '')}.csv"`);
      res.send(csv);
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Extraction');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${task.name.replace(/["\\]/g, '')}.xlsx"`);
      res.send(buf);
    }
  }),
);

export default router;
