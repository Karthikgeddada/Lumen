// Structural test of the GET /workspaces/:id/quality JSON shape. The route
// is a thin delegate over buildQuality, so pinning this object pins the API
// response shape the frontend consumes (extraction, answers, covenants,
// derivations, grounding, documents).

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../prisma', () => ({
  prisma: {
    extractionResult: { findMany: vi.fn() },
    questionAnswer: { groupBy: vi.fn() },
    covenantDefinition: { groupBy: vi.fn() },
    metricObservation: { groupBy: vi.fn() },
    document: { findMany: vi.fn() },
    citation: { count: vi.fn() },
  },
}));

import { prisma } from '../../prisma';
import { buildQuality } from './quality';

const m = (f: unknown) => f as ReturnType<typeof vi.fn>;

describe('buildQuality shape', () => {
  it('returns the exact top-level keys for an empty workspace', async () => {
    m(prisma.extractionResult.findMany).mockResolvedValue([]);
    m(prisma.questionAnswer.groupBy).mockResolvedValue([]);
    m(prisma.covenantDefinition.groupBy).mockResolvedValue([]);
    m(prisma.metricObservation.groupBy).mockResolvedValue([]);
    m(prisma.document.findMany).mockResolvedValue([]);
    m(prisma.citation.count).mockResolvedValue(0);

    const q = await buildQuality('ws');
    expect(Object.keys(q)).toEqual(['extraction', 'answers', 'covenants', 'derivations', 'grounding', 'documents']);
    expect(Object.keys(q.extraction)).toEqual([
      'verified', 'needsReview', 'missing', 'rejected', 'flagged', 'total', 'avgConfidence',
    ]);
    expect(q.extraction).toEqual({
      verified: 0, needsReview: 0, missing: 0, rejected: 0, flagged: 0, total: 0, avgConfidence: null,
    });
    expect(Object.keys(q.grounding)).toEqual(['documents', 'pagesUnderstood', 'citations', 'sections', 'tables', 'passages']);
    expect(q.answers).toEqual({});
    expect(q.covenants).toEqual({});
    expect(q.derivations).toEqual({});
    expect(q.documents).toEqual([]);
  });

  it('counts extraction results, flags, confidence and per-document rows', async () => {
    m(prisma.extractionResult.findMany).mockResolvedValue([
      { status: 'VERIFIED', confidence: 0.9, documentId: 'd1', flagged: false },
      { status: 'NEEDS_REVIEW', confidence: 0.5, documentId: 'd1', flagged: true },
      { status: 'MISSING', confidence: null, documentId: 'd2', flagged: false },
      { status: 'REJECTED', confidence: null, documentId: null, flagged: false },
    ]);
    m(prisma.document.findMany).mockResolvedValue([
      { id: 'd1', name: 'Q3.pdf', status: 'COMPLETED', pageCount: 3, processedAt: null, _count: { sections: 2, tables: 1, chunks: 9 } },
    ]);
    m(prisma.citation.count).mockResolvedValue(7);

    const q = await buildQuality('ws');
    expect(q.extraction.total).toBe(4);
    expect(q.extraction.verified).toBe(1);
    expect(q.extraction.needsReview).toBe(1);
    expect(q.extraction.missing).toBe(1);
    expect(q.extraction.rejected).toBe(1);
    expect(q.extraction.flagged).toBe(1);
    expect(q.extraction.avgConfidence).toBeCloseTo((0.9 + 0.5) / 4);
    expect(q.documents).toHaveLength(1);
    expect(Object.keys(q.documents[0])).toEqual([
      'id', 'name', 'status', 'pageCount', 'processedAt', 'sections', 'tables', 'passages', 'extraction',
    ]);
    expect(Object.keys(q.documents[0].extraction)).toEqual(['total', 'verified', 'needsReview', 'flagged', 'avgConfidence']);
    expect(q.documents[0].extraction.total).toBe(2);
    expect(q.documents[0].extraction.avgConfidence).toBeCloseTo((0.9 + 0.5) / 2);
    expect(q.grounding.citations).toBe(7);
  });
});
