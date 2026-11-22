import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { WorkspaceRole } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../prisma';
import { sha256 } from '../utils';
import { ApiError, asyncH } from './error';

// ── tokens ────────────────────────────────────────────────────────────────
export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId }, config.authSecret, {
    expiresIn: config.accessTokenTtlSec,
    issuer: 'lumen',
  });
}

export function verifyAccessToken(token: string): { userId: string; sessionId: string } {
  const payload = jwt.verify(token, config.authSecret, { issuer: 'lumen' }) as {
    sub: string;
    sid: string;
  };
  return { userId: payload.sub, sessionId: payload.sid };
}

// Refresh tokens are opaque random strings; only their hash is stored.
export function newRefreshToken(): string {
  const t = require('crypto').randomBytes(48).toString('base64url');
  return t as string;
}
export { sha256 as hashToken };

// ── authentication ──────────────────────────────────────────────────────
// Accepts the short-lived access token via `Authorization: Bearer <jwt>`.
// Checks the backing session is still alive so signout revokes everywhere.
export const requireAuth = asyncH(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');

  let payload: { userId: string; sessionId: string };
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new ApiError(401, 'TOKEN_INVALID', 'Access token is invalid or expired.');
  }

  const session = await prisma.session.findUnique({
    where: { id: payload.sessionId },
    select: { id: true, revokedAt: true, expiresAt: true, userId: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== payload.userId) {
    throw new ApiError(401, 'SESSION_ENDED', 'Session has ended. Please sign in again.');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, deletedAt: true, emailVerifiedAt: true },
  });
  if (!user || user.deletedAt) throw new ApiError(401, 'SESSION_ENDED', 'Session has ended.');

  req.auth = { userId: user.id, sessionId: session.id };
  next();
});

// ── authorization ───────────────────────────────────────────────────────
const ROLE_RANK: Record<WorkspaceRole, number> = {
  VIEWER: 1,
  REVIEWER: 2,
  EDITOR: 3,
  ADMIN: 4,
  OWNER: 5,
};

export function roleAtLeast(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

// Resolves the workspace the request targets, verifies membership and minimum
// role — enforced on the backend; the client can never bypass it.
// Workspace id resolution order: req.params.workspaceId, body.workspaceId, query.workspaceId.
export function requireWorkspace(minRole: WorkspaceRole = 'VIEWER') {
  return asyncH(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');
    const wid =
      (req.params.workspaceId as string | undefined) ||
      ((req.body as Record<string, unknown> | undefined)?.workspaceId as string | undefined) ||
      ((req.query as Record<string, unknown>).workspaceId as string | undefined);
    if (!wid) throw new ApiError(400, 'WORKSPACE_REQUIRED', 'A workspace id is required.');

    const membership = await prisma.membership.findFirst({
      where: { workspaceId: wid, userId: req.auth.userId, deletedAt: null },
      select: { role: true, workspace: { select: { id: true, deletedAt: true } } },
    });
    // 404 (not 403) when not a member — never leak that a workspace exists.
    if (!membership || membership.workspace.deletedAt) {
      throw new ApiError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    }
    if (!roleAtLeast(membership.role, minRole)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    req.ws = { id: wid, role: membership.role };
    next();
  });
}

// For resources nested under a document/conversation/etc — resolves the
// owning workspace from the record itself and enforces the minimum role.
export async function assertDocAccess(
  req: Request,
  documentId: string,
  minRole: WorkspaceRole = 'VIEWER',
) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { workspaceId: true },
  });
  if (!doc) throw new ApiError(404, 'NOT_FOUND', 'Document not found.');
  const membership = await prisma.membership.findFirst({
    where: { workspaceId: doc.workspaceId, userId: req.auth!.userId, deletedAt: null },
    select: { role: true },
  });
  if (!membership) throw new ApiError(404, 'NOT_FOUND', 'Document not found.');
  if (!roleAtLeast(membership.role, minRole))
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
  return { workspaceId: doc.workspaceId, role: membership.role };
}
