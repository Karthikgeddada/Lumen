import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { asyncH } from '../middleware/error';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncH(async (req, res) => {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.auth!.userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { userId: req.auth!.userId, readAt: null } }),
    ]);
    res.json({ notifications, unreadCount });
  }),
);

router.post(
  '/read',
  requireAuth,
  asyncH(async (req, res) => {
    const body = z.object({ ids: z.array(z.string()).optional() }).parse(req.body ?? {});
    await prisma.notification.updateMany({
      where: {
        userId: req.auth!.userId,
        readAt: null,
        ...(body.ids?.length ? { id: { in: body.ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  }),
);

export default router;
