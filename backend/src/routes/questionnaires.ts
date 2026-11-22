import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { audit } from '../utils';
import { enqueue } from '../services/queue';
import { getRules, questionsFromWorkbook, questionnaireToWorkbook } from '../services/questionnaire';
import * as XLSX from 'xlsx';

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function requireQAccess(
  req: { auth?: { userId: string }; params: Record<string, string> },
  questionnaireId: string,
  minRole: 'VIEWER' | 'EDITOR' | 'REVIEWER' | 'ADMIN',
) {
  const q = await prisma.questionnaire.findFirst({
    where: { id: questionnaireId, deletedAt: null },
    select: { id: true, workspaceId: true },
  });
  if (!q) throw new ApiError(404, 'NOT_FOUND', 'Questionnaire not found.');
  const membership = await prisma.membership.findFirst({
    where: { workspaceId: q.workspaceId, userId: req.auth!.userId, deletedAt: null },
    select: { role: true },
  });
  const rank: Record<string, number> = { VIEWER: 1, REVIEWER: 2, EDITOR: 3, ADMIN: 4, OWNER: 5 };
  if (!membership || rank[membership.role] < rank[minRole]) {
    throw new ApiError(404, 'NOT_FOUND', 'Questionnaire not found.'); // never leak existence
  }
  return { questionnaire: q, role: membership.role, workspaceId: q.workspaceId };
}

// List with progress.
router.get(
  '/workspaces/:workspaceId/questionnaires',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const questionnaires = await prisma.questionnaire.findMany({
      where: { workspaceId: req.ws!.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true, title: true, description: true, status: true, source: true, createdAt: true, updatedAt: true,
        _count: { select: { questions: true } },
      },
    });
    // Questions answered by AI (drafted) or approved, per questionnaire.
    const answeredGroups = await prisma.question.groupBy({
      by: ['questionnaireId'],
      where: {
        questionnaire: { workspaceId: req.ws!.id, deletedAt: null },
        answer: { status: { in: ['APPROVED', 'AI_DRAFTED'] } },
      },
      _count: { _all: true },
    });
    const answeredBy = new Map(answeredGroups.map((g) => [g.questionnaireId, g._count._all]));
    const rules = await getRules(req.ws!.id);
    res.json({
      questionnaires: questionnaires.map((q) => ({
        ...q,
        answeredCount: answeredBy.get(q.id) ?? 0,
      })),
      rules,
    });
  }),
);

// Create (custom or template-based).
router.post(
  '/workspaces/:workspaceId/questionnaires',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        title: z.string().trim().min(1).max(140),
        description: z.string().trim().max(400).optional(),
      })
      .parse(req.body);
    const questionnaire = await prisma.questionnaire.create({
      data: {
        workspaceId: req.ws!.id,
        title: body.title,
        description: body.description,
        createdById: req.auth!.userId,
      },
    });
    res.status(201).json({ questionnaire });
  }),
);

// Detail with questions + answers + evidence.
router.get(
  '/questionnaires/:questionnaireId',
  requireAuth,
  asyncH(async (req, res) => {
    const { workspaceId } = await requireQAccess(req, req.params.questionnaireId, 'VIEWER');
    const questionnaire = await prisma.questionnaire.findFirst({
      where: { id: req.params.questionnaireId },
      include: {
        questions: {
          orderBy: { order: 'asc' },
          include: {
            answer: {
              include: {
                evidence: { select: { id: true, documentId: true, page: true, kind: true, tableRef: true, excerpt: true, document: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });
    res.json({ questionnaire, rules: await getRules(workspaceId) });
  }),
);

router.patch(
  '/questionnaires/:questionnaireId',
  requireAuth,
  asyncH(async (req, res) => {
    await requireQAccess(req, req.params.questionnaireId, 'EDITOR');
    const body = z
      .object({
        title: z.string().trim().min(1).max(140).optional(),
        description: z.string().trim().max(400).optional(),
        status: z.enum(['draft', 'in_progress', 'completed']).optional(),
      })
      .parse(req.body);
    const questionnaire = await prisma.questionnaire.update({ where: { id: req.params.questionnaireId }, data: body });
    res.json({ questionnaire });
  }),
);

router.delete(
  '/questionnaires/:questionnaireId',
  requireAuth,
  asyncH(async (req, res) => {
    await requireQAccess(req, req.params.questionnaireId, 'EDITOR');
    await prisma.questionnaire.update({ where: { id: req.params.questionnaireId }, data: { deletedAt: new Date() } });
    res.json({ ok: true });
  }),
);

// ── Questions (form builder) ──────────────────────────────────────────
router.post(
  '/questionnaires/:questionnaireId/questions',
  requireAuth,
  asyncH(async (req, res) => {
    await requireQAccess(req, req.params.questionnaireId, 'EDITOR');
    const body = z
      .object({
        section: z.string().trim().min(1).max(80).default('General'),
        type: z.enum(['yes_no', 'multiple_choice', 'text', 'table']).default('text'),
        prompt: z.string().trim().min(2).max(2000),
        options: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
        required: z.boolean().default(true),
      })
      .parse(req.body);
    const order = await prisma.question.count({ where: { questionnaireId: req.params.questionnaireId } });
    const question = await prisma.question.create({ data: { questionnaireId: req.params.questionnaireId, ...body, order } });
    res.status(201).json({ question });
  }),
);

router.patch(
  '/questions/:questionId',
  requireAuth,
  asyncH(async (req, res) => {
    const question = await prisma.question.findUnique({ where: { id: req.params.questionId }, select: { questionnaireId: true } });
    if (!question) throw new ApiError(404, 'NOT_FOUND', 'Question not found.');
    await requireQAccess(req, question.questionnaireId, 'EDITOR');
    const body = z
      .object({
        section: z.string().trim().min(1).max(80).optional(),
        type: z.enum(['yes_no', 'multiple_choice', 'text', 'table']).optional(),
        prompt: z.string().trim().min(2).max(2000).optional(),
        options: z.array(z.string().trim().min(1).max(120)).max(10).nullable().optional(),
        required: z.boolean().optional(),
      })
      .parse(req.body);
    const updated = await prisma.question.update({
      where: { id: req.params.questionId },
      data: { ...body, options: body.options === null ? Prisma.DbNull : body.options },
    });
    res.json({ question: updated });
  }),
);

router.delete(
  '/questions/:questionId',
  requireAuth,
  asyncH(async (req, res) => {
    const question = await prisma.question.findUnique({ where: { id: req.params.questionId }, select: { questionnaireId: true } });
    if (!question) throw new ApiError(404, 'NOT_FOUND', 'Question not found.');
    await requireQAccess(req, question.questionnaireId, 'EDITOR');
    await prisma.question.delete({ where: { id: req.params.questionId } });
    res.json({ ok: true });
  }),
);

// ── Excel import ───────────────────────────────────────────────────
router.post(
  '/questionnaires/:questionnaireId/import',
  requireAuth,
  upload.single('file'),
  asyncH(async (req, res) => {
    const { workspaceId } = await requireQAccess(req, req.params.questionnaireId, 'EDITOR');
    if (!req.file) throw new ApiError(400, 'NO_FILE', 'Upload an .xlsx or .csv file.');
    const incoming = questionsFromWorkbook(req.file.buffer);
    if (!incoming.length) {
      throw new ApiError(400, 'IMPORT_EMPTY', 'No questions found. Expected columns: Section, Question, Type, Options, Required.');
    }
    const base = await prisma.question.count({ where: { questionnaireId: req.params.questionnaireId } });
    await prisma.question.createMany({
      data: incoming.map((q, i) => ({
        questionnaireId: req.params.questionnaireId,
        section: q.section,
        type: q.type,
        prompt: q.prompt,
        options: q.options ?? undefined,
        required: q.required,
        order: base + i,
      })),
    });
    await prisma.questionnaire.update({ where: { id: req.params.questionnaireId }, data: { source: 'imported', status: 'in_progress' } });
    await audit({ workspaceId, actorId: req.auth!.userId, action: 'questionnaire.imported', targetType: 'questionnaire', targetId: req.params.questionnaireId, meta: { count: incoming.length } });
    res.json({ imported: incoming.length });
  }),
);

// ── AI drafting ─────────────────────────────────────────────────────
router.post(
  '/questionnaires/:questionnaireId/generate',
  requireAuth,
  asyncH(async (req, res) => {
    const { workspaceId } = await requireQAccess(req, req.params.questionnaireId, 'EDITOR');
    await prisma.questionnaire.update({ where: { id: req.params.questionnaireId }, data: { status: 'in_progress' } });
    await enqueue('DRAFT_QUESTIONNAIRE', { questionnaireId: req.params.questionnaireId });
    await audit({ workspaceId, actorId: req.auth!.userId, action: 'questionnaire.drafted', targetType: 'questionnaire', targetId: req.params.questionnaireId });
    res.json({ ok: true, message: 'Drafting started — answers will appear as they are generated.' });
  }),
);

// ── Answer review workflow ─────────────────────────────────────────
router.patch(
  '/answers/:answerId',
  requireAuth,
  asyncH(async (req, res) => {
    const answer = await prisma.questionAnswer.findUnique({
      where: { id: req.params.answerId },
      include: { question: { select: { questionnaireId: true } } },
    });
    if (!answer) throw new ApiError(404, 'NOT_FOUND', 'Answer not found.');
    const { workspaceId } = await requireQAccess(req, answer.question.questionnaireId, 'REVIEWER');

    const body = z
      .object({
        finalAnswer: z.string().trim().max(4000).optional(),
        status: z.enum(['APPROVED', 'NEEDS_REVIEW', 'REJECTED', 'MISSING']),
        comment: z.string().trim().max(1000).optional(),
      })
      .parse(req.body);

    const updated = await prisma.questionAnswer.update({
      where: { id: answer.id },
      data: {
        ...(body.finalAnswer !== undefined ? { finalAnswer: body.finalAnswer } : {}),
        ...(body.status === 'APPROVED' && body.finalAnswer === undefined && !answer.finalAnswer
          ? { finalAnswer: answer.draftAnswer }
          : {}),
        status: body.status,
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
        reviewedById: req.auth!.userId,
        reviewedAt: new Date(),
      },
    });
    if (body.status === 'APPROVED') {
      await audit({ workspaceId, actorId: req.auth!.userId, action: 'answer.approved', targetType: 'question_answer', targetId: answer.id });
    }
    res.json({ answer: updated });
  }),
);

// ── Export ───────────────────────────────────────────────────────────
router.get(
  '/questionnaires/:questionnaireId/export',
  requireAuth,
  asyncH(async (req, res) => {
    const { workspaceId } = await requireQAccess(req, req.params.questionnaireId, 'VIEWER');
    const q = await prisma.questionnaire.findFirst({
      where: { id: req.params.questionnaireId },
      include: {
        questions: {
          orderBy: { order: 'asc' },
          include: { answer: { select: { draftAnswer: true, finalAnswer: true, status: true, confidence: true } } },
        },
      },
    });
    void workspaceId;
    const wb = questionnaireToWorkbook(q!);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${q!.title.replace(/["\\]/g, '')}.xlsx"`);
    res.send(buf);
  }),
);

export default router;
