import { Router } from 'express';
import { prisma } from '../prisma';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { asyncH } from '../middleware/error';
import { computePackage, lastNQuarters } from '../services/borrowers';

// Data Room tree — one read for the whole left panel. Everything the Library
// tree renders comes from here: companies with subsidiaries, their folders
// (with document counts), unassigned counts, and per-company package status.
// Capped: up to 200 companies and 25 package rows per company — large
// portfolios page at the company level rather than growing this payload.

const router = Router({ mergeParams: true }); // inherit :workspaceId from the app.use mount

const MAX_ENTITIES = 200;
const MAX_PACKAGE_ROWS = 25;

router.get(
  '/tree',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const wid = req.ws!.id;

    const [entities, folders, unassignedCount, needsConfirmationCount] = await Promise.all([
      // Companies with subsidiaries + latest quarterly package status.
      prisma.entity.findMany({
        where: { workspaceId: wid },
        orderBy: { name: 'asc' },
        take: MAX_ENTITIES,
        select: {
          id: true, name: true, parentId: true, createdAt: true,
          _count: { select: { documents: { where: { deletedAt: null } } } },
        },
      }),
      // All live folders (collections) with counts; entity scoping drives the tree.
      prisma.collection.findMany({
        where: { workspaceId: wid, deletedAt: null },
        orderBy: { name: 'asc' },
        select: {
          id: true, name: true, parentId: true, entityId: true, kind: true, periodKey: true, createdAt: true,
          _count: { select: { documents: { where: { deletedAt: null } } } },
        },
      }),
      // Unassigned inbox: documents with no company and no folder.
      prisma.document.count({
        where: { workspaceId: wid, deletedAt: null, entityId: null, collectionId: null },
      }),
      // Emailed documents still waiting for a confirm / dismiss decision.
      prisma.document.count({
        where: { workspaceId: wid, deletedAt: null, entityId: null, assignmentStatus: 'NEEDS_CONFIRMATION' },
      }),
    ]);

    // Quarterly package status per top-level company — latest quarter only,
    // reusing the same keyword-matching service as the company page so the
    // tree can never disagree with it. Capped at 25 companies; the tree shows
    // a summary — full package detail lives on the company page.
    const topEntities = entities.filter((e) => !e.parentId).slice(0, MAX_PACKAGE_ROWS);
    const packages = await Promise.all(
      topEntities.map(async (e) => {
        const pkg = await computePackage(e.id, lastNQuarters(1));
        const quarter = pkg.quarters[0];
        if (!quarter) return null;
        const requiredCells = quarter.cells.filter((c, i) => pkg.items[i]?.required);
        if (!requiredCells.length) return null;
        return {
          entityId: e.id,
          period: quarter.period,
          expected: requiredCells.length,
          received: requiredCells.filter((c) => c.status === 'RECEIVED').length,
        };
      }),
    );
    const packageByEntity = new Map(
      packages
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => [p.entityId, { period: p.period, expected: p.expected, received: p.received } as const]),
    );

    res.json({
      entities: entities.map((e) => ({
        id: e.id,
        name: e.name,
        parentId: e.parentId,
        documentCount: e._count.documents,
        package: packageByEntity.get(e.id) ?? null,
      })),
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        entityId: f.entityId,
        kind: f.kind,
        periodKey: f.periodKey,
        documentCount: f._count.documents,
      })),
      unassigned: { total: unassignedCount, needsConfirmation: needsConfirmationCount },
    });
  }),
);

export default router;
