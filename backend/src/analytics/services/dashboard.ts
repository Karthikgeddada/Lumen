// The analytics parts of the dashboard (moved verbatim from the dashboard
// route): the covenant status board with latest results, breach counting, and
// portfolio counts. The route composes these with its activity/document
// queries into the same JSON shape as before — pinned by
// analytics/services/dashboard.test.ts.

import { prisma } from '../../prisma';
import type { CovenantResult } from '@prisma/client';

export type DashboardBoardRow = {
  id: string;
  label: string;
  entityName: string;
  comparator: string;
  threshold: number;
  unit: string;
  needsReview: boolean;
  latest: CovenantResult | null;
};

export type DashboardAnalytics = {
  covenantCount: number;
  breaches: number;
  covenantPeriods: string[];
  board: DashboardBoardRow[];
  portfolio: { entities: number; observations: number };
};

export async function buildDashboardAnalytics(wid: string): Promise<DashboardAnalytics> {
  const [covenantDefinitions, entitiesCount, observationsCount] = await Promise.all([
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
  const covenantBoard: DashboardBoardRow[] = covenantDefinitions
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

  return {
    covenantCount: covenantDefinitions.length,
    breaches,
    covenantPeriods: Array.from(latestPeriods),
    board: covenantBoard,
    portfolio: { entities: entitiesCount, observations: observationsCount },
  };
}