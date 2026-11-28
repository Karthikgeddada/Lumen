import { Router } from 'express';
import { prisma } from '../prisma';
import { asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';

const router = Router();

// Workspace-level data-quality analytics: how much of what Lumen shows is
// human-verified vs AI-proposed, how confident the AI is, and how well every
// document is grounded (sections, tables, citations). Read-only, VIEWER.
router.get(
  '/workspaces/:workspaceId/quality',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const wid = req.ws!.id;

    const [
      extractionResults,
      answerStatuses,
      covenantStatuses,
      metricDerivations,
      documents,
      citations,
    ] = await Promise.all([
      prisma.extractionResult.findMany({
        where: { task: { workspaceId: wid, deletedAt: null }, documentId: { not: null } },
        select: { status: true, confidence: true, documentId: true, flagged: true },
      }),
      prisma.questionAnswer.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: { question: { questionnaire: { workspaceId: wid, deletedAt: null } } },
      }),
      prisma.covenantDefinition.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: { workspaceId: wid, deletedAt: null },
      }),
      prisma.metricObservation.groupBy({
        by: ['derivation'],
        _count: { _all: true },
        where: { entity: { workspaceId: wid } },
      }),
      prisma.document.findMany({
        where: { workspaceId: wid, deletedAt: null },
        select: {
          id: true, name: true, status: true, pageCount: true, processedAt: true,
          _count: { select: { sections: true, tables: true, chunks: true } },
        },
        orderBy: { uploadedAt: 'asc' },
      }),
      prisma.citation.count({ where: { document: { workspaceId: wid, deletedAt: null } } }),
    ]);

    // ── Extraction quality ──
    const byDoc = new Map<string, { verified: number; review: number; missing: number; total: number; confSum: number; flagged: number }>();
    const ext = { verified: 0, review: 0, missing: 0, rejected: 0, total: 0, flagged: 0, confidenceSum: 0 };
    for (const r of extractionResults) {
      ext.total++;
      ext.confidenceSum += r.confidence ?? 0;
      if (r.flagged) ext.flagged++;
      if (r.status === 'VERIFIED') ext.verified++;
      else if (r.status === 'NEEDS_REVIEW') ext.review++;
      else if (r.status === 'MISSING') ext.missing++;
      else if (r.status === 'REJECTED') ext.rejected++;

      if (r.documentId) {
        const d = byDoc.get(r.documentId) ?? { verified: 0, review: 0, missing: 0, total: 0, confSum: 0, flagged: 0 };
        d.total++;
        d.confSum += r.confidence ?? 0;
        if (r.flagged) d.flagged++;
        if (r.status === 'VERIFIED') d.verified++;
        else if (r.status === 'NEEDS_REVIEW') d.review++;
        else if (r.status === 'MISSING') d.missing++;
        byDoc.set(r.documentId, d);
      }
    }

    const answers = Object.fromEntries(answerStatuses.map((a) => [a.status, a._count._all]));
    const covenants = Object.fromEntries(covenantStatuses.map((c) => [c.status, c._count._all]));
    const derivations = Object.fromEntries(metricDerivations.map((m) => [m.derivation, m._count._all]));

    const pagesUnderstood = documents.reduce((n, d) => n + (d.pageCount ?? 0), 0);

    res.json({
      extraction: {
        verified: ext.verified,
        needsReview: ext.review,
        missing: ext.missing,
        rejected: ext.rejected,
        flagged: ext.flagged,
        total: ext.total,
        avgConfidence: ext.total ? ext.confidenceSum / ext.total : null,
      },
      answers,
      covenants,
      derivations,
      grounding: {
        documents: documents.length,
        pagesUnderstood,
        citations,
        sections: documents.reduce((n, d) => n + d._count.sections, 0),
        tables: documents.reduce((n, d) => n + d._count.tables, 0),
        passages: documents.reduce((n, d) => n + d._count.chunks, 0),
      },
      documents: documents.map((d) => {
        const q = byDoc.get(d.id) ?? { verified: 0, review: 0, missing: 0, total: 0, confSum: 0, flagged: 0 };
        return {
          id: d.id,
          name: d.name,
          status: d.status,
          pageCount: d.pageCount,
          processedAt: d.processedAt,
          sections: d._count.sections,
          tables: d._count.tables,
          passages: d._count.chunks,
          extraction: {
            total: q.total,
            verified: q.verified,
            needsReview: q.review,
            flagged: q.flagged,
            avgConfidence: q.total ? q.confSum / q.total : null,
          },
        };
      }),
    });
  }),
);

// Revision history: every real overwrite of a stored metric figure — manual
// edit or formula recompute — newest first, with entity and actor names.
router.get(
  '/workspaces/:workspaceId/quality/revisions',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const revisions = await prisma.observationRevision.findMany({
      where: { workspaceId: req.ws!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    const entityIds = [...new Set(revisions.map((r) => r.entityId))];
    const entities = entityIds.length
      ? await prisma.entity.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(entities.map((e) => [e.id, e.name]));
    res.json({
      revisions: revisions.map((r) => ({
        id: r.id,
        entityId: r.entityId,
        entityName: names.get(r.entityId) ?? 'Unknown',
        metricKey: r.metricKey,
        period: r.period,
        oldValue: r.oldValue,
        newValue: r.newValue,
        oldDerivation: r.oldDerivation,
        newDerivation: r.newDerivation,
        source: r.source,
        actor: r.user ? `${r.user.firstName} ${r.user.lastName}` : null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  }),
);

export default router;
