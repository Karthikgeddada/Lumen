// Route-table snapshot: walks every mounted router WITHOUT starting the
// server (no listen(), no sockets — we traverse Express' layer tree directly).
// The committed inline snapshot is the contract between backend and frontend;
// any added/removed/renamed route or mount fails this test, which is the
// safety net for the analytics module restructure and future refactors.

import { describe, expect, it, vi } from 'vitest';
import type { Router } from 'express';

// Routers import config, which requires these at import time. Placeholder
// values only — nothing connects or listens during this test. vi.hoisted runs
// before the static import below.
const envReady = vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
  process.env.AUTH_SECRET ||= 'route-table-snapshot-only';
});

import { MOUNTS } from './mounts';
void envReady;

// Walk a router's layer tree into "METHOD /full/path" entries. Nested routers
// (router.use of another Router) are recursed via their stored mount path;
// direct routes contribute one entry per method. Order is deterministic:
// mount order first, then route registration order.
function walk(router: Router, prefix: string, out: string[]): void {
  for (const layer of (router as unknown as { stack: unknown[] }).stack as {
    name: string;
    route?: { path: unknown; methods: Record<string, boolean> };
    handle?: Router;
    path?: string | RegExp;
  }[]) {
    if (layer.name === 'router' && layer.handle) {
      const mountPath = typeof layer.path === 'string' ? layer.path : '';
      walk(layer.handle, `${prefix}${mountPath}`, out);
    } else if (layer.route && typeof layer.route.path === 'string') {
      const methods = Object.keys(layer.route.methods)
        .map((m) => m.toUpperCase())
        .sort();
      for (const method of methods) out.push(`${method} ${prefix}${layer.route.path}`);
    }
  }
}

// Mount prefixes mirrored from mounts.ts — the test asserts BOTH the route
// table and that mounts.ts still exports exactly these prefixes, so the
// snapshot cannot drift from the real app wiring.
const EXPECTED_PREFIXES = [
  '/api/auth',
  '/api/workspaces',
  '/api/workspaces/:workspaceId/collections',
  '/api/workspaces/:workspaceId/documents',
  '/api/workspaces/:workspaceId/search',
  '/api',
  '/api',
  '/api',
  '/api',
  '/api',
  '/api',
  '/api',
  '/api/notifications',
];

describe('route table', () => {
  it('mounts every router at exactly the expected prefixes', () => {
    expect(MOUNTS.map((m) => m.prefix)).toEqual(EXPECTED_PREFIXES);
  });

  it('matches the committed route-table snapshot', () => {
    const table: string[] = [];
    for (const { prefix, router } of MOUNTS) walk(router, prefix, table);
    expect(table.length).toBeGreaterThan(50); // sanity: we actually walked routes
    expect(table).toMatchInlineSnapshot(`
      [
        "POST /api/auth/register",
        "POST /api/auth/verify",
        "POST /api/auth/resend",
        "POST /api/auth/signin",
        "POST /api/auth/refresh",
        "POST /api/auth/signout",
        "POST /api/auth/forgot",
        "POST /api/auth/reset",
        "GET /api/auth/me",
        "PATCH /api/auth/me",
        "GET /api/workspaces/",
        "POST /api/workspaces/",
        "GET /api/workspaces/:workspaceId",
        "PATCH /api/workspaces/:workspaceId",
        "GET /api/workspaces/:workspaceId/members",
        "PATCH /api/workspaces/:workspaceId/members/:userId",
        "DELETE /api/workspaces/:workspaceId/members/:userId",
        "GET /api/workspaces/:workspaceId/invitations",
        "POST /api/workspaces/:workspaceId/invitations",
        "DELETE /api/workspaces/:workspaceId/invitations/:invitationId",
        "POST /api/workspaces/invitations/accept",
        "GET /api/workspaces/:workspaceId/settings",
        "PUT /api/workspaces/:workspaceId/settings/:key",
        "GET /api/workspaces/:workspaceId/activity",
        "GET /api/workspaces/:workspaceId/collections/",
        "POST /api/workspaces/:workspaceId/collections/",
        "PATCH /api/workspaces/:workspaceId/collections/:collectionId",
        "DELETE /api/workspaces/:workspaceId/collections/:collectionId",
        "POST /api/workspaces/:workspaceId/documents/",
        "GET /api/workspaces/:workspaceId/documents/",
        "GET /api/workspaces/:workspaceId/documents/:documentId",
        "PATCH /api/workspaces/:workspaceId/documents/:documentId",
        "DELETE /api/workspaces/:workspaceId/documents/:documentId",
        "POST /api/workspaces/:workspaceId/documents/:documentId/retry",
        "GET /api/workspaces/:workspaceId/documents/:documentId/download",
        "GET /api/workspaces/:workspaceId/documents/:documentId/file",
        "GET /api/workspaces/:workspaceId/search/",
        "GET /api/workspaces/:workspaceId/conversations",
        "POST /api/workspaces/:workspaceId/conversations",
        "GET /api/conversations/:conversationId",
        "PATCH /api/conversations/:conversationId",
        "DELETE /api/conversations/:conversationId",
        "POST /api/conversations/:conversationId/messages",
        "GET /api/workspaces/:workspaceId/validation",
        "PUT /api/workspaces/:workspaceId/validation",
        "GET /api/workspaces/:workspaceId/extractions/templates",
        "POST /api/workspaces/:workspaceId/extractions/templates",
        "GET /api/workspaces/:workspaceId/extractions",
        "POST /api/workspaces/:workspaceId/extractions",
        "GET /api/extraction-tasks/:taskId",
        "PATCH /api/extraction-tasks/:taskId",
        "DELETE /api/extraction-tasks/:taskId",
        "POST /api/extraction-tasks/:taskId/rerun",
        "POST /api/extraction-tasks/:taskId/suggest-fields",
        "POST /api/extraction-tasks/:taskId/fields",
        "PATCH /api/extraction-results/:resultId",
        "POST /api/extraction-tasks/:taskId/ingest-analytics",
        "GET /api/extraction-tasks/:taskId/export",
        "GET /api/workspaces/:workspaceId/questionnaires",
        "POST /api/workspaces/:workspaceId/questionnaires",
        "GET /api/questionnaires/:questionnaireId",
        "PATCH /api/questionnaires/:questionnaireId",
        "DELETE /api/questionnaires/:questionnaireId",
        "POST /api/questionnaires/:questionnaireId/questions",
        "PATCH /api/questions/:questionId",
        "DELETE /api/questions/:questionId",
        "POST /api/questionnaires/:questionnaireId/import",
        "POST /api/questionnaires/:questionnaireId/generate",
        "PATCH /api/answers/:answerId",
        "GET /api/questionnaires/:questionnaireId/export",
        "GET /api/:workspaceId/analytics/entities",
        "POST /api/:workspaceId/analytics/entities",
        "DELETE /api/:workspaceId/analytics/entities/:entityId",
        "GET /api/:workspaceId/analytics/overview",
        "POST /api/:workspaceId/analytics/observations",
        "GET /api/analytics/observations/:observationId/revisions",
        "GET /api/:workspaceId/analytics/reports",
        "POST /api/:workspaceId/analytics/reports",
        "DELETE /api/analytics/reports/:reportId",
        "GET /api/workspaces/:workspaceId/covenants",
        "POST /api/workspaces/:workspaceId/covenants",
        "POST /api/workspaces/:workspaceId/covenants/extract",
        "POST /api/workspaces/:workspaceId/covenants/test",
        "GET /api/covenants/:definitionId",
        "PATCH /api/covenants/:definitionId",
        "POST /api/covenants/:definitionId/cure",
        "DELETE /api/covenants/:definitionId",
        "GET /api/workspaces/:workspaceId/quality",
        "GET /api/workspaces/:workspaceId/dashboard",
        "GET /api/notifications/",
        "POST /api/notifications/read",
      ]
    `);
  });
});
