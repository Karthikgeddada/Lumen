import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { excerptOf } from '../utils';

const router = Router();

// Global search: document names + passages inside documents, each with its
// location (page / sheet / heading) so results are traceable.

router.get(
  '/',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(200) }).parse(req.query);

    const documents = await prisma.document.findMany({
      where: {
        workspaceId: req.ws!.id,
        deletedAt: null,
        name: { contains: q, mode: 'insensitive' },
      },
      select: { id: true, name: true, fileType: true, status: true, pageCount: true, collection: { select: { name: true } } },
      take: 10,
    });

    const chunks = await prisma.documentChunk.findMany({
      where: {
        text: { contains: q, mode: 'insensitive' },
        document: {
          workspaceId: req.ws!.id,
          deletedAt: null,
          status: 'COMPLETED',
        },
      },
      select: {
        id: true, page: true, sheet: true, headingPath: true, kind: true, text: true,
        document: { select: { id: true, name: true } },
      },
      take: 20,
    });

    res.json({
      documents,
      passages: chunks.map((c) => ({
        chunkId: c.id,
        documentId: c.document.id,
        documentName: c.document.name,
        page: c.page,
        sheet: c.sheet,
        headingPath: c.headingPath,
        kind: c.kind,
        excerpt: excerptOf(c.text, q),
      })),
    });
  }),
);

export default router;
