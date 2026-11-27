// Single source of truth for how routers mount onto the Express app.
// index.ts applies every entry with the shared rate limiter, in this exact
// order; the route-table snapshot test walks this list, so any path change
// — a renamed route, a reordered mount, a dropped router — fails CI before
// it can silently break the frontend.

import { Router } from 'express';
import authRoutes from './auth';
import workspaceRoutes from './workspaces';
import collectionRoutes from './collections';
import documentRoutes from './documents';
import searchRoutes from './search';
import conversationRoutes from './conversations';
import extractionRoutes from './extraction';
import questionnaireRoutes from './questionnaires';
import analyticsRoutes from './analytics';
import covenantRoutes from './covenants';
import qualityRoutes from './quality';
import dashboardRoutes from './dashboard';
import notificationRoutes from './notifications';

export type Mount = { prefix: string; router: Router };

export const MOUNTS: Mount[] = [
  { prefix: '/api/auth', router: authRoutes },
  { prefix: '/api/workspaces', router: workspaceRoutes },
  { prefix: '/api/workspaces/:workspaceId/collections', router: collectionRoutes },
  { prefix: '/api/workspaces/:workspaceId/documents', router: documentRoutes },
  { prefix: '/api/workspaces/:workspaceId/search', router: searchRoutes },
  { prefix: '/api', router: conversationRoutes },
  { prefix: '/api', router: extractionRoutes },
  { prefix: '/api', router: questionnaireRoutes },
  { prefix: '/api', router: analyticsRoutes },
  { prefix: '/api', router: covenantRoutes },
  { prefix: '/api', router: qualityRoutes },
  { prefix: '/api', router: dashboardRoutes },
  { prefix: '/api/notifications', router: notificationRoutes },
];
