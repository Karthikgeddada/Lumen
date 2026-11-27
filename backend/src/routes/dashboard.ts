import { Router } from 'express';
import { prisma } from '../prisma';
import { asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { buildDashboardAnalytics } from '../analytics';

const router = Router();

// Everything on the dashboard comes from real workspace data — no hardcoded
// production values. Fresh workspaces get honest zeros, and the frontend
// renders empty states for them.
// The analytics parts (covenant board, breaches, portfolio counts) live in
// analytics/services/dashboard.ts; this route composes them with the
// activity/document queries into the same JSON shape as before
// (pinned by analytics/services/dashboard.test.ts).
router.get(
  '/workspaces/:workspaceId/dashboard',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const wid = req.ws!.id;

    const [
      documentsTotal,
      pagesUnderstood,
      extractionsCount,
      openExtractionReviews,
      openAnswerReviews,
      recentDocuments,
      activeProcessing,
      recentActivity,
      recentConversations,
      analytics,
    ] = await Promise.all([
      prisma.document.count({ where: { workspaceId: wid, deletedAt: null } }),
      prisma.document.aggregate({
        where: { workspaceId: wid, deletedAt: null, status: 'COMPLETED' },
        _sum: { pageCount: true },
      }),
      prisma.extractionTask.count({ where: { workspaceId: wid, deletedAt: null } }),
      prisma.extractionResult.count({
        where: { status: 'NEEDS_REVIEW', task: { workspaceId: wid, deletedAt: null } },
      }),
      prisma.questionAnswer.count({
        where: {
          status: { in: ['NEEDS_REVIEW'] },
          question: { questionnaire: { workspaceId: wid, deletedAt: null } },
        },
      }),
      prisma.document.findMany({
        where: { workspaceId: wid, deletedAt: null },
        orderBy: { uploadedAt: 'desc' },
        take: 6,
        select: {
          id: true, name: true, fileType: true, status: true, pageCount: true, uploadedAt: true, isDemo: true,
          collection: { select: { name: true } },
          owner: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.document.findMany({
        where: { workspaceId: wid, deletedAt: null, status: { in: ['UPLOADING', 'QUEUED', 'PROCESSING'] } },
        orderBy: { uploadedAt: 'desc' },
        take: 5,
        select: { id: true, name: true, fileType: true, status: true, uploadedAt: true, error: true },
      }),
      prisma.auditEvent.findMany({
        where: {
          workspaceId: wid,
          action: {
            in: [
              'workspace.created', 'document.uploaded', 'document.deleted', 'document.completed',
              'invitation.sent', 'invitation.accepted', 'member.role_changed', 'extraction.run',
              'questionnaire.drafted', 'answer.approved', 'extraction.verified',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, action: true, meta: true, createdAt: true,
          actor: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.conversation.findMany({
        where: { workspaceId: wid, userId: req.auth!.userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, title: true, updatedAt: true, documentIds: true },
      }),
      buildDashboardAnalytics(wid),
    ]);

    res.json({
      kpis: {
        documents: documentsTotal,
        pagesUnderstood: pagesUnderstood._sum.pageCount ?? 0,
        extractions: extractionsCount,
        openReviews: openExtractionReviews + openAnswerReviews,
        covenants: analytics.covenantCount,
        breaches: analytics.breaches,
        covenantPeriods: analytics.covenantPeriods,
      },
      covenants: analytics.board,
      portfolio: analytics.portfolio,
      recentDocuments,
      activeProcessing,
      recentActivity,
      recentConversations,
    });
  }),
);

export default router;
