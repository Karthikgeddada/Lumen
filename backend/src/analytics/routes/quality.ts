import { Router } from 'express';
import { asyncH } from '../../middleware/error';
import { requireAuth, requireWorkspace } from '../../middleware/auth';
import { buildQuality } from '../services/quality';

const router = Router();

// Workspace-level data-quality analytics: how much of what Lumen shows is
// human-verified vs AI-proposed, how confident the AI is, and how well every
// document is grounded (sections, tables, citations). Read-only, VIEWER.
// The computation lives in analytics/services/quality.ts (identical JSON
// shape — pinned by analytics/services/quality.test.ts).
router.get(
  '/workspaces/:workspaceId/quality',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    res.json(await buildQuality(req.ws!.id));
  }),
);

export default router;
