import { Router } from 'express';
import { prisma } from '../prisma';
import { asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';

const router = Router();

// Everything on the dashboard comes from real workspace data — no hardcoded
// production values. Fresh workspaces get honest zeros, and the frontend
// renders empty states for them.

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
      covenantDefinitions,
      entitiesCount,
      observationsCount,
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
      prisma.covenantDefinition.findMany({
        where: { workspaceId: wid, deletedAt: null },
        include: { entity: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.entity.count({ where: { workspaceId: wid } }),
      prisma.metricObservation.count({ where: { entity: { workspaceId: wid } } }),
    ]);

    // Latest test result per covenant, breaches first for the status board.
    const defIds = covenantDefinitions.map((d) => d.id);
    const recentResults = defIds.length
      ? await prisma.covenantResult.findMany({
          where: { definitionId: { in: defIds } },
          orderBy: { computedAt: 'desc' },
        })
      : [];
    const latestByDef = new Map<string, (typeof recentResults)[number]>();
    for (const r of recentResults) {
      if (!latestByDef.has(r.definitionId)) latestByDef.set(r.definitionId, r);
    }
    const covenantBoard = covenantDefinitions
      .map((d) => ({
        id: d.id,
        label: d.label,
        entityName: d.entity.name,
        comparator: d.comparator,
        threshold: d.threshold,
        unit: d.unit,
        needsReview: d.status === 'AI_INFERRED',
        latest: latestByDef.get(d.id) ?? null,
      }))
      .sort((a, b) => {
        const rank = (x: { latest: { status: string } | null; needsReview: boolean }) =>
          x.latest?.status === 'FAIL' ? 0 : !x.latest ? 1 : x.needsReview ? 2 : 3;
        return rank(a) - rank(b);
      });

    const latestPeriods = new Set(recentResults.map((r) => r.period));
    const breaches = covenantBoard.filter((c) => c.latest?.status === 'FAIL').length;

    res.json({
      kpis: {
        documents: documentsTotal,
        pagesUnderstood: pagesUnderstood._sum.pageCount ?? 0,
        extractions: extractionsCount,
        openReviews: openExtractionReviews + openAnswerReviews,
        covenants: covenantDefinitions.length,
        breaches,
        covenantPeriods: Array.from(latestPeriods),
      },
      covenants: covenantBoard,
      portfolio: { entities: entitiesCount, observations: observationsCount },
      recentDocuments,
      activeProcessing,
      recentActivity,
      recentConversations,
    });
  }),
);

export default router;
