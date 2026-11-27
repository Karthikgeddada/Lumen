// Workspace-level data-quality analytics (moved verbatim from the quality
// route): how much of what Lumen shows is human-verified vs AI-proposed, how
// confident the AI is, and how well every document is grounded (sections,
// tables, citations). Read-only, workspace-scoped.
// analytics/services/quality.test.ts pins the JSON shape.

import { prisma } from '../../prisma';

export type QualityResponse = {
  extraction: {
    verified: number;
    needsReview: number;
    missing: number;
    rejected: number;
    flagged: number;
    total: number;
    avgConfidence: number | null;
  };
  answers: Record<string, number>;
  covenants: Record<string, number>;
  derivations: Record<string, number>;
  grounding: {
    documents: number;
    pagesUnderstood: number;
    citations: number;
    sections: number;
    tables: number;
    passages: number;
  };
  documents: Array<{
    id: string;
    name: string;
    status: string;
    pageCount: number | null;
    processedAt: Date | null;
    sections: number;
    tables: number;
    passages: number;
    extraction: {
      total: number;
      verified: number;
      needsReview: number;
      flagged: number;
      avgConfidence: number | null;
    };
  }>;
};

export async function buildQuality(wid: string): Promise<QualityResponse> {
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

  return {
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
  };
}