import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma';
import { config } from '../config';
import { ApiError, asyncH, authLimiter } from '../middleware/error';
import { requireAuth } from '../middleware/auth';
import { signAccessToken, newRefreshToken, hashToken } from '../middleware/auth';
import { sendVerificationCode, sendPasswordResetCode } from '../services/mailer';
import { audit, sixDigitCode, sha256 } from '../utils';

const router = Router();

// Cross-domain auth (Vercel frontend → Render backend):
// - Access token: short-lived JWT kept in memory by the frontend.
// - Refresh token: opaque, stored hashed; delivered BOTH as an httpOnly
//   SameSite=None cookie AND in the response body. The cookie is preferred
//   where browsers allow it; the body copy is the fallback for browsers that
//   block third-party cookies (Safari ITP, Chrome's phase-out).

const REFRESH_COOKIE = 'lumen_rt';

function setRefreshCookie(res: Response, token: string, ttlMs: number) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: config.isProd ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: ttlMs,
  });
}
function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

async function issueSession(
  res: Response,
  userId: string,
  keepSignedIn: boolean,
  req: Request,
) {
  const refreshToken = newRefreshToken();
  const ttlMs = keepSignedIn ? config.refreshLongTtlMs : config.refreshShortTtlMs;
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: req.headers['user-agent']?.slice(0, 250) ?? null,
      ip: req.ip ?? null,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  setRefreshCookie(res, refreshToken, ttlMs);
  return {
    accessToken: signAccessToken(userId, session.id),
    refreshToken, // fallback transport for third-party-cookie-blocked browsers
    expiresIn: config.accessTokenTtlSec,
  };
}

const publicUser = {
  id: true, email: true, firstName: true, lastName: true,
  emailVerifiedAt: true, onboardingStep: true, createdAt: true,
} as const;

// ── Registration ─────────────────────────────────────────────────────────
const passwordSchema = z.string().min(10, 'Password must be at least 10 characters.').max(200);

router.post(
  '/register',
  authLimiter,
  asyncH(async (req, res) => {
    const body = z
      .object({
        firstName: z.string().trim().min(1).max(60),
        lastName: z.string().trim().min(1).max(60),
        email: z.string().trim().toLowerCase().email(),
        password: passwordSchema,
        acceptTerms: z.literal(true),
      })
      .parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });

    if (!existing) {
      // Email verification is disabled: new accounts are created verified so
      // anyone can register with an email + password and sign in right away.
      // (Password reset still uses emailed codes — see /forgot and /reset.)
      // Pre-existing unverified accounts keep the code flow: re-registering
      // someone's email must never hand out their account.
      const user = await prisma.user.create({
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          passwordHash: await bcrypt.hash(body.password, 12),
          emailVerifiedAt: new Date(),
          onboardingStep: 1,
        },
      });
      await audit({ actorId: user.id, action: 'user.register', ip: req.ip });
      const tokens = await issueSession(res, user.id, true, req);
      return res.status(201).json({ user: await mePayload(user.id), ...tokens });
    }

    // Existing address: legacy flow — generic response, never leak existence.
    await sendCodeFor(existing.emailVerifiedAt ? null : body.email, 'EMAIL_VERIFY');

    res.status(201).json({ ok: true, message: 'Check your email for a verification code.' });
  }),
);

async function sendCodeFor(email: string | null, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET') {
  if (!email) return;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, firstName: true, emailVerifiedAt: true } });
  if (!user || (purpose === 'EMAIL_VERIFY' && user.emailVerifiedAt)) return;
  // Invalidate previous unconsumed codes, then issue a fresh one.
  await prisma.verificationCode.updateMany({
    where: { userId: user.id, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const code = sixDigitCode();
  const ttlMin = purpose === 'EMAIL_VERIFY' ? 15 : 30;
  await prisma.verificationCode.create({
    data: {
      userId: user.id,
      purpose,
      codeHash: sha256(code),
      expiresAt: new Date(Date.now() + ttlMin * 60 * 1000),
    },
  });
  if (purpose === 'EMAIL_VERIFY') await sendVerificationCode(email, user.firstName, code);
  else await sendPasswordResetCode(email, user.firstName, code);
}

// ── Email verification ───────────────────────────────────────────────
router.post(
  '/verify',
  authLimiter,
  asyncH(async (req, res) => {
    const body = z.object({ email: z.string().email(), code: z.string().trim().regex(/^\d{6}$/) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) throw new ApiError(400, 'CODE_INVALID', 'That code is invalid or has expired.');

    if (user.emailVerifiedAt) {
      const tokens = await issueSession(res, user.id, true, req);
      return res.json({ user: await mePayload(user.id), ...tokens });
    }

    const code = await prisma.verificationCode.findFirst({
      where: { userId: user.id, purpose: 'EMAIL_VERIFY', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!code || code.attempts >= 6) throw new ApiError(400, 'CODE_INVALID', 'That code is invalid or has expired.');
    if (code.expiresAt < new Date()) throw new ApiError(400, 'CODE_EXPIRED', 'That code has expired. Request a new one.');
    if (code.codeHash !== sha256(body.code)) {
      await prisma.verificationCode.update({ where: { id: code.id }, data: { attempts: code.attempts + 1 } });
      throw new ApiError(400, 'CODE_INVALID', 'That code is invalid or has expired.');
    }

    await prisma.$transaction([
      prisma.verificationCode.update({ where: { id: code.id }, data: { consumedAt: new Date() } }),
      prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), onboardingStep: Math.max(user.onboardingStep, 1) } }),
    ]);
    await audit({ actorId: user.id, action: 'user.verified', ip: req.ip });

    const tokens = await issueSession(res, user.id, true, req);
    res.json({ user: await mePayload(user.id), ...tokens });
  }),
);

router.post(
  '/resend',
  authLimiter,
  asyncH(async (req, res) => {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    await sendCodeFor(body.email.toLowerCase(), 'EMAIL_VERIFY');
    res.json({ ok: true, message: 'If that address has a pending verification, a new code is on its way.' });
  }),
);

// ── Sign in / refresh / sign out ────────────────────────────────────
router.post(
  '/signin',
  authLimiter,
  asyncH(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
        keepSignedIn: z.boolean().optional().default(false),
      })
      .parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user || user.deletedAt || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new ApiError(401, 'CREDENTIALS_INVALID', 'Email or password is incorrect.');
    }
    if (!user.emailVerifiedAt) {
      throw new ApiError(403, 'EMAIL_UNVERIFIED', 'Verify your email before signing in. Check your inbox for the code.');
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ actorId: user.id, action: 'user.signin', ip: req.ip });

    const tokens = await issueSession(res, user.id, body.keepSignedIn, req);
    res.json({ user: await mePayload(user.id), ...tokens });
  }),
);

router.post(
  '/refresh',
  authLimiter,
  asyncH(async (req, res) => {
    const token =
      (req.cookies?.[REFRESH_COOKIE] as string | undefined) ||
      (z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {}).refreshToken) ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined);
    if (!token) throw new ApiError(401, 'NO_REFRESH_TOKEN', 'Please sign in again.');

    const session = await prisma.session.findUnique({
      where: { refreshTokenHash: hashToken(token) },
      include: { user: { select: { id: true, deletedAt: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.deletedAt) {
      throw new ApiError(401, 'SESSION_ENDED', 'Session has ended. Please sign in again.');
    }

    // Rotate: a new refresh token per use; the old one dies immediately.
    const ttlDelta = session.expiresAt.getTime() - session.createdAt.getTime();
    const refreshToken = newRefreshToken();
    await prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + Math.max(ttlDelta, config.refreshShortTtlMs)),
      },
    });
    setRefreshCookie(res, refreshToken, Math.max(ttlDelta, config.refreshShortTtlMs));

    res.json({
      accessToken: signAccessToken(session.userId, session.id),
      refreshToken,
      expiresIn: config.accessTokenTtlSec,
    });
  }),
);

router.post(
  '/signout',
  requireAuth,
  asyncH(async (req, res) => {
    await prisma.session.update({ where: { id: req.auth!.sessionId }, data: { revokedAt: new Date() } });
    clearRefreshCookie(res);
    res.json({ ok: true });
  }),
);

// ── Password recovery ──────────────────────────────────────────────
router.post(
  '/forgot',
  authLimiter,
  asyncH(async (req, res) => {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    await sendCodeFor(body.email.toLowerCase(), 'PASSWORD_RESET');
    res.json({ ok: true, message: 'If that address has an account, a reset code is on its way.' });
  }),
);

router.post(
  '/reset',
  authLimiter,
  asyncH(async (req, res) => {
    const body = z
      .object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/), password: passwordSchema })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) throw new ApiError(400, 'CODE_INVALID', 'That code is invalid or has expired.');

    const code = await prisma.verificationCode.findFirst({
      where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!code || code.attempts >= 6 || code.expiresAt < new Date() || code.codeHash !== sha256(body.code)) {
      if (code && code.codeHash !== sha256(body.code)) {
        await prisma.verificationCode.update({ where: { id: code.id }, data: { attempts: code.attempts + 1 } });
      }
      throw new ApiError(400, 'CODE_INVALID', 'That code is invalid or has expired.');
    }

    await prisma.$transaction([
      prisma.verificationCode.update({ where: { id: code.id }, data: { consumedAt: new Date() } }),
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.password, 12) } }),
      // New password invalidates every existing session.
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit({ actorId: user.id, action: 'user.password_reset', ip: req.ip });

    res.json({ ok: true, message: 'Password updated. You can sign in with your new password.' });
  }),
);

// ── Current user ────────────────────────────────────────────────────
async function mePayload(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...publicUser,
      memberships: {
        where: { deletedAt: null },
        select: {
          role: true,
          workspace: {
            select: { id: true, name: true, slug: true, industry: true, plan: true, storageUsedBytes: true },
          },
        },
      },
      _count: { select: { notifications: { where: { readAt: null } } } },
    },
  });
  return user;
}

router.get(
  '/me',
  requireAuth,
  asyncH(async (req, res) => {
    res.json({ user: await mePayload(req.auth!.userId) });
  }),
);

router.patch(
  '/me',
  requireAuth,
  asyncH(async (req, res) => {
    const body = z
      .object({
        firstName: z.string().trim().min(1).max(60).optional(),
        lastName: z.string().trim().min(1).max(60).optional(),
        onboardingStep: z.number().int().min(0).max(4).optional(),
      })
      .parse(req.body);
    const user = await prisma.user.update({ where: { id: req.auth!.userId }, data: body });
    res.json({ user: await mePayload(user.id) });
  }),
);

export default router;
