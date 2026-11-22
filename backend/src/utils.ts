import crypto from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// ── strings & ids ──────────────────────────────────────────────────────────
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace';
}

export async function uniqueSlug(base: string): Promise<string> {
  const slug = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const exists = await prisma.workspace.findFirst({
      where: { slug: candidate, deletedAt: null },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `${slug}-${crypto.randomBytes(3).toString('hex')}`;
}

// ── codes & hashing ──────────────────────────────────────────────────────
export function sixDigitCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ── express helpers ──────────────────────────────────────────────────────
export const asyncH =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

// ── pagination ───────────────────────────────────────────────────────────
export function paginate(query: Record<string, unknown>, defaults = { limit: 25, maxLimit: 100 }) {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(
    defaults.maxLimit,
    Math.max(1, parseInt(String(query.limit ?? String(defaults.limit)), 10) || defaults.limit),
  );
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export function pageMeta(total: number, page: number, limit: number) {
  return { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

// ── text ──────────────────────────────────────────────────────────────────
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function excerptOf(text: string, around?: string, len = 240): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!around) return t.slice(0, len) + (t.length > len ? '…' : '');
  const i = t.toLowerCase().indexOf(around.toLowerCase().slice(0, 40));
  if (i < 0) return t.slice(0, len) + (t.length > len ? '…' : '');
  const start = Math.max(0, i - Math.floor(len / 3));
  return (start > 0 ? '…' : '') + t.slice(start, start + len) + (start + len < t.length ? '…' : '');
}

// ── audit ────────────────────────────────────────────────────────────────
export async function audit(input: {
  workspaceId?: string | null;
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}) {
  try {
    await prisma.auditEvent.create({
      data: {
        workspaceId: input.workspaceId ?? undefined,
        actorId: input.actorId ?? undefined,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        meta: input.meta as Prisma.InputJsonValue | undefined,
        ip: input.ip,
      },
    });
  } catch {
    /* audit must never break the request path */
  }
}
