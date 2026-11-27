// Structural test of the dashboard analytics shape. routes/dashboard.ts
// composes buildDashboardAnalytics with its document/activity queries into
// the same JSON the frontend has always consumed, so pinning this object
// pins that contract (kpis.covenants/breaches/covenantPeriods, the covenant
// board rows, portfolio).

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../prisma', () => ({
  prisma: {
    covenantDefinition: { findMany: vi.fn() },
    covenantResult: { findMany: vi.fn() },
    entity: { count: vi.fn() },
    metricObservation: { count: vi.fn() },
  },
}));

import { prisma } from '../../prisma';
import { buildDashboardAnalytics } from './dashboard';

const m = (f: unknown) => f as ReturnType<typeof vi.fn>;

describe('buildDashboardAnalytics shape', () => {
  it('returns honest zeros for a fresh workspace', async () => {
    m(prisma.covenantDefinition.findMany).mockResolvedValue([]);
    m(prisma.entity.count).mockResolvedValue(0);
    m(prisma.metricObservation.count).mockResolvedValue(0);

    const a = await buildDashboardAnalytics('ws');
    expect(Object.keys(a)).toEqual(['covenantCount', 'breaches', 'covenantPeriods', 'board', 'portfolio']);
    expect(a.covenantCount).toBe(0);
    expect(a.breaches).toBe(0);
    expect(a.covenantPeriods).toEqual([]);
    expect(a.board).toEqual([]);
    expect(a.portfolio).toEqual({ entities: 0, observations: 0 });
  });

  it('builds the board from latest results, breaches first, and pins the row shape', async () => {
    const now = new Date('2026-11-27T00:00:00Z');
    const earlier = new Date('2026-08-27T00:00:00Z');
    m(prisma.covenantDefinition.findMany).mockResolvedValue([
      { id: 'def1', label: 'Leverage ≤ 4.0x', comparator: 'LTE', threshold: 4, unit: 'x', status: 'CONFIRMED', createdAt: earlier, entity: { name: 'Halden' } },
      { id: 'def2', label: 'Liquidity ≥ $10m', comparator: 'GTE', threshold: 10, unit: 'USD millions', status: 'AI_INFERRED', createdAt: earlier, entity: { name: 'Halden' } },
    ]);
    m(prisma.covenantResult.findMany).mockResolvedValue([
      { id: 'r1', definitionId: 'def1', period: 'Q3 2026', status: 'FAIL', value: 4.8, reason: null, observationId: null, headroom: -0.8, nearBreach: false, previousStatus: 'PASS', computedAt: now },
      { id: 'r0', definitionId: 'def1', period: 'Q2 2026', status: 'PASS', value: 3.9, reason: null, observationId: null, headroom: 0.1, nearBreach: false, previousStatus: null, computedAt: earlier },
      { id: 'r2', definitionId: 'def2', period: 'Q3 2026', status: 'NOT_TESTED', value: null, reason: 'missing observation', observationId: null, headroom: null, nearBreach: null, previousStatus: null, computedAt: now },
    ]);
    m(prisma.entity.count).mockResolvedValue(1);
    m(prisma.metricObservation.count).mockResolvedValue(16);

    const a = await buildDashboardAnalytics('ws');
    expect(a.covenantCount).toBe(2);
    expect(a.breaches).toBe(1);
    // latest per definition, NOT all results: def1 latest is the Q3 FAIL
    expect(a.board).toHaveLength(2);
    expect(a.board[0].id).toBe('def1'); // FAIL sorts first
    expect(a.board[0].latest?.period).toBe('Q3 2026');
    expect(a.board[0].latest?.status).toBe('FAIL');
    expect(a.board[1].id).toBe('def2');
    expect(a.board[1].needsReview).toBe(true);
    expect(a.board[1].latest?.status).toBe('NOT_TESTED');
    expect(Object.keys(a.board[0])).toEqual([
      'id', 'label', 'entityName', 'comparator', 'threshold', 'unit', 'needsReview', 'latest',
    ]);
    expect(a.covenantPeriods).toEqual(expect.arrayContaining(['Q3 2026', 'Q2 2026']));
    expect(a.portfolio).toEqual({ entities: 1, observations: 16 });
  });
});
