import { Router } from 'express';
import { z } from 'zod';
import { WorkspaceRole } from '@prisma/client';
import { prisma } from '../prisma';
import { config } from '../config';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { audit, randomToken, uniqueSlug } from '../utils';
import { sendInvitation } from '../services/mailer';

const router = Router();

// Dedicated inbound address for a workspace (slug + short random suffix so a
// deleted workspace's address cannot be guessed or collide).
function inboundAddressFor(slug: string): string {
  return `${slug}.${randomToken(2).toLowerCase()}@${config.inboundEmail.domain}`;
}

// Workspaces, membership, roles, invitations, settings and activity — all
// permission-enforced on the backend. Role gates:
//   VIEWER read · REVIEWER review answers/extractions · EDITOR content
//   ADMIN members + settings · OWNER workspace lifecycle

// ── My workspaces ─────────────────────────────────────────────────────
router.get(
  '/',
  requireAuth,
  asyncH(async (req, res) => {
    const rows = await prisma.membership.findMany({
      where: { userId: req.auth!.userId, deletedAt: null, workspace: { deletedAt: null } },
      select: {
        role: true,
        workspace: {
          select: {
            id: true, name: true, slug: true, inboundEmail: true, industry: true, plan: true,
            createdAt: true, storageUsedBytes: true,
            _count: { select: { memberships: { where: { deletedAt: null } }, documents: { where: { deletedAt: null } } } },
          },
        },
      },
    });
    // Lazily backfill inbound addresses for pre-existing workspaces.
    const missing = rows.filter((r) => !r.workspace.inboundEmail);
    if (missing.length) {
      await Promise.all(missing.map(async (r) => {
        const inboundEmail = inboundAddressFor(r.workspace.slug);
        try {
          await prisma.workspace.update({ where: { id: r.workspace.id }, data: { inboundEmail } });
          (r.workspace as { inboundEmail: string | null }).inboundEmail = inboundEmail;
        } catch { /* address collision — leave for the next request */ }
      }));
    }
    res.json({ workspaces: rows.map((r) => ({ ...r.workspace, role: r.role })) });
  }),
);

// ── Create workspace (onboarding step 2) ────────────────────────────
router.post(
  '/',
  requireAuth,
  asyncH(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(80),
        industry: z.string().trim().max(40).optional(),
      })
      .parse(req.body);

    const slug = await uniqueSlug(body.name);
    const ws = await prisma.workspace.create({
      data: {
        name: body.name,
        slug,
        inboundEmail: inboundAddressFor(slug),
        industry: body.industry ?? 'Business',
        createdById: req.auth!.userId,
        memberships: { create: { userId: req.auth!.userId, role: 'OWNER' } },
        settings: {
          create: { key: 'questionnaires.rules', value: { requireCitations: true, lowConfidenceThreshold: 0.85, autoApproveHighConfidence: false } },
        },
      },
    });
    await prisma.user.update({
      where: { id: req.auth!.userId },
      data: { onboardingStep: 3 },
    });
    await audit({ workspaceId: ws.id, actorId: req.auth!.userId, action: 'workspace.created', targetType: 'workspace', targetId: ws.id });
    res.status(201).json({ workspace: ws });
  }),
);

// ── Workspace detail / update ─────────────────────────────────────
router.get(
  '/:workspaceId',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    let ws = await prisma.workspace.findUnique({
      where: { id: req.ws!.id },
      select: {
        id: true, name: true, slug: true, inboundEmail: true, industry: true, plan: true, createdAt: true,
        storageUsedBytes: true,
        _count: {
          select: {
            memberships: { where: { deletedAt: null } },
            documents: { where: { deletedAt: null } },
            collections: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (ws && !ws.inboundEmail) {
      const inboundEmail = inboundAddressFor(ws.slug);
      try {
        await prisma.workspace.update({ where: { id: ws.id }, data: { inboundEmail } });
        ws = { ...ws, inboundEmail };
      } catch { /* leave null — retried on the next request */ }
    }
    res.json({ workspace: { ...ws, role: req.ws!.role } });
  }),
);

router.patch(
  '/:workspaceId',
  requireAuth,
  requireWorkspace('ADMIN'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        industry: z.enum(['Finance', 'Technology', 'Industrial', 'Legal', 'Research', 'Business']).optional(),
      })
      .parse(req.body);
    const ws = await prisma.workspace.update({ where: { id: req.ws!.id }, data: body });
    await audit({ workspaceId: ws.id, actorId: req.auth!.userId, action: 'workspace.updated', targetType: 'workspace', targetId: ws.id, meta: body });
    res.json({ workspace: ws });
  }),
);

// ── Members & roles ──────────────────────────────────────────────
router.get(
  '/:workspaceId/members',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const members = await prisma.membership.findMany({
      where: { workspaceId: req.ws!.id, deletedAt: null },
      select: {
        id: true, role: true, createdAt: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true, lastLoginAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ members });
  }),
);

router.patch(
  '/:workspaceId/members/:userId',
  requireAuth,
  requireWorkspace('ADMIN'),
  asyncH(async (req, res) => {
    const { role } = z.object({ role: z.enum(['ADMIN', 'EDITOR', 'REVIEWER', 'VIEWER']) }).parse(req.body);
    const target = await prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: req.ws!.id, userId: req.params.userId } },
    });
    if (!target || target.deletedAt) throw new ApiError(404, 'NOT_FOUND', 'Member not found.');
    if (target.role === 'OWNER') throw new ApiError(403, 'FORBIDDEN', "The workspace owner's role cannot be changed.");
    const updated = await prisma.membership.update({
      where: { id: target.id },
      data: { role: role as WorkspaceRole },
    });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'member.role_changed', targetType: 'membership', targetId: target.id, meta: { role } });
    res.json({ membership: updated });
  }),
);

router.delete(
  '/:workspaceId/members/:userId',
  requireAuth,
  requireWorkspace('ADMIN'),
  asyncH(async (req, res) => {
    const target = await prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: req.ws!.id, userId: req.params.userId } },
    });
    if (!target || target.deletedAt) throw new ApiError(404, 'NOT_FOUND', 'Member not found.');
    if (target.role === 'OWNER') throw new ApiError(403, 'FORBIDDEN', 'The workspace owner cannot be removed.');
    await prisma.membership.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'member.removed', targetType: 'user', targetId: req.params.userId });
    res.json({ ok: true });
  }),
);

// ── Invitations ────────────────────────────────────────────────────
router.get(
  '/:workspaceId/invitations',
  requireAuth,
  requireWorkspace('ADMIN'),
  asyncH(async (req, res) => {
    const invitations = await prisma.invitation.findMany({
      where: { workspaceId: req.ws!.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ invitations });
  }),
);

router.post(
  '/:workspaceId/invitations',
  requireAuth,
  requireWorkspace('ADMIN'),
  asyncH(async (req, res) => {
    const body = z
      .object({ email: z.string().email(), role: z.enum(['ADMIN', 'EDITOR', 'REVIEWER', 'VIEWER']).default('EDITOR') })
      .parse(req.body);
    const email = body.email.toLowerCase();

    const existingMember = await prisma.membership.findFirst({
      where: { workspaceId: req.ws!.id, user: { email }, deletedAt: null },
    });
    if (existingMember) throw new ApiError(409, 'ALREADY_MEMBER', 'That person is already a member of this workspace.');

    const invitation = await prisma.invitation.create({
      data: {
        workspaceId: req.ws!.id,
        email,
        role: body.role,
        token: randomToken(24),
        invitedById: req.auth!.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const inviter = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { firstName: true, lastName: true } });
    const ws = await prisma.workspace.findUnique({ where: { id: req.ws!.id }, select: { name: true } });
    await sendInvitation(email, `${inviter?.firstName ?? 'A teammate'}`, ws!.name, `${config.frontendUrl}/invite/${invitation.token}`);
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'invitation.sent', targetType: 'invitation', targetId: invitation.id, meta: { email, role: body.role } });
    res.status(201).json({ invitation: { ...invitation, token: undefined } });
  }),
);

router.delete(
  '/:workspaceId/invitations/:invitationId',
  requireAuth,
  requireWorkspace('ADMIN'),
  asyncH(async (req, res) => {
    await prisma.invitation.updateMany({
      where: { id: req.params.invitationId, workspaceId: req.ws!.id, status: 'PENDING' },
      data: { status: 'REVOKED' },
    });
    res.json({ ok: true });
  }),
);

// Accepting an invitation (auth already required).
router.post(
  '/invitations/accept',
  requireAuth,
  asyncH(async (req, res) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const invitation = await prisma.invitation.findUnique({ where: { token } });
    if (!invitation) throw new ApiError(404, 'NOT_FOUND', 'Invitation not found.');
    if (invitation.status !== 'PENDING' || invitation.expiresAt < new Date()) {
      throw new ApiError(410, 'INVITATION_EXPIRED', 'This invitation has expired or was revoked.');
    }
    const me = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { email: true } });
    if (me!.email !== invitation.email) {
      throw new ApiError(403, 'EMAIL_MISMATCH', `This invitation was sent to ${invitation.email}. Sign in with that address (or register it) to accept.`);
    }
    const existing = await prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: req.auth!.userId } },
    });
    if (existing) {
      await prisma.membership.update({ where: { id: existing.id }, data: { deletedAt: null, role: invitation.role } });
    } else {
      await prisma.membership.create({
        data: { workspaceId: invitation.workspaceId, userId: req.auth!.userId, role: invitation.role },
      });
    }
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    await prisma.notification.create({
      data: {
        userId: invitation.invitedById,
        workspaceId: invitation.workspaceId,
        kind: 'invitation.accepted',
        title: `${invitation.email} joined`,
        link: '/team',
      },
    });
    await audit({ workspaceId: invitation.workspaceId, actorId: req.auth!.userId, action: 'invitation.accepted', targetType: 'invitation', targetId: invitation.id });
    res.json({ ok: true, workspaceId: invitation.workspaceId });
  }),
);

// ── Settings (questionnaire rules etc.) ───────────────────────────
router.get(
  '/:workspaceId/settings',
  requireAuth,
  requireWorkspace('ADMIN'),
  asyncH(async (req, res) => {
    const settings = await prisma.workspaceSetting.findMany({ where: { workspaceId: req.ws!.id } });
    res.json({ settings });
  }),
);

router.put(
  '/:workspaceId/settings/:key',
  requireAuth,
  requireWorkspace('ADMIN'),
  asyncH(async (req, res) => {
    const { key } = req.params;
    const body = z.object({ value: z.unknown() }).parse(req.body);
    const setting = await prisma.workspaceSetting.upsert({
      where: { workspaceId_key: { workspaceId: req.ws!.id, key } },
      create: { workspaceId: req.ws!.id, key, value: body.value as object },
      update: { value: body.value as object },
    });
    await audit({ workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'settings.updated', meta: { key } });
    res.json({ setting });
  }),
);

// ── Activity feed (member-visible audit subset) ──────────────────────
const VISIBLE_ACTIONS = [
  'workspace.created', 'document.uploaded', 'document.deleted', 'document.completed',
  'invitation.sent', 'invitation.accepted', 'member.role_changed', 'member.removed',
  'extraction.run', 'questionnaire.drafted', 'extraction.verified', 'answer.approved',
];

router.get(
  '/:workspaceId/activity',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const events = await prisma.auditEvent.findMany({
      where: { workspaceId: req.ws!.id, action: { in: VISIBLE_ACTIONS } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, action: true, targetType: true, targetId: true, meta: true, createdAt: true,
        actor: { select: { firstName: true, lastName: true } },
      },
    });
    res.json({ events });
  }),
);

export default router;
