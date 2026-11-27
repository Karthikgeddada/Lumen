// Chart endpoints — NEW paths (additive; the 84 existing routes are
// untouched). VIEWER can read catalog/data/views; EDITOR writes views.
// The request body IS a ChartSpec (validated against the whitelist — no
// raw SQL, no arbitrary fields). Every write is audited.

import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncH } from '../../middleware/error';
import { requireAuth, requireWorkspace } from '../../middleware/auth';
import { audit } from '../../utils';
import {
  buildCatalogResponse,
  buildChartData,
  listSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
} from '../services/charts';

const router = Router();

// Catalog: every chart with tier/intents/requires, every dataset with
// whitelisted fields/roles/filters, unavailable datasets with honest reasons,
// the intent list, the caps, and the flag states.
router.get(
  '/:workspaceId/charts/catalog',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (_req, res) => {
    res.json(buildCatalogResponse());
  }),
);

// Data: a validated ChartSpec → whitelisted rows (with per-point lineage),
// profile, recommended chart with the reason, alternatives with reasons,
// guardrail notes, and cap/truncation info. Unresolved points are included
// but flagged (TRUST RULE).
router.post(
  '/:workspaceId/charts/data',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const result = await buildChartData(req.ws!.id, req.body);
    res.json(result);
  }),
);

// ── Saved views ──────────────────────────────────────────────────

router.get(
  '/:workspaceId/charts/views',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const views = await listSavedViews(req.ws!.id, req.auth!.userId);
    res.json({ views });
  }),
);

router.post(
  '/:workspaceId/charts/views',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        spec: z.unknown(), // validated against the ChartSpec whitelist inside
      })
      .strict()
      .parse(req.body);
    const view = await createSavedView(req.ws!.id, req.auth!.userId, body.name, body.spec);
    await audit({
      workspaceId: req.ws!.id,
      actorId: req.auth!.userId,
      action: 'chart.view.created',
      targetType: 'savedChartView',
      targetId: view.id,
      meta: { name: body.name, dataset: (body.spec as { dataset?: string })?.dataset },
    });
    res.status(201).json({ view });
  }),
);

router.patch(
  '/:workspaceId/charts/views/:viewId',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        spec: z.unknown().optional(),
        pinned: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    const view = await updateSavedView(req.ws!.id, req.params.viewId, body);
    if (!view) throw new ApiError(404, 'NOT_FOUND', 'Saved view not found.'); // 404, not 403
    await audit({
      workspaceId: req.ws!.id,
      actorId: req.auth!.userId,
      action: 'chart.view.updated',
      targetType: 'savedChartView',
      targetId: view.id,
      meta: { name: view.name, pinned: view.pinned },
    });
    res.json({ view });
  }),
);

router.delete(
  '/:workspaceId/charts/views/:viewId',
  requireAuth,
  requireWorkspace('EDITOR'),
  asyncH(async (req, res) => {
    const view = await deleteSavedView(req.ws!.id, req.params.viewId);
    if (!view) throw new ApiError(404, 'NOT_FOUND', 'Saved view not found.'); // 404, not 403
    await audit({
      workspaceId: req.ws!.id,
      actorId: req.auth!.userId,
      action: 'chart.view.deleted',
      targetType: 'savedChartView',
      targetId: view.id,
      meta: { name: view.name },
    });
    res.json({ ok: true, deleted: view.name });
  }),
);

export default router;
