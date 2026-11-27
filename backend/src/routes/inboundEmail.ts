import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../prisma';
import { config, hasStorage } from '../config';
import { ApiError, asyncH } from '../middleware/error';
import { audit } from '../utils';
import { putObject, storageKey, storageMode } from '../services/storage';
import { enqueue } from '../services/queue';
import { SUPPORTED_EXTENSIONS, extOf } from '../services/parsers';

// ── Inbound email webhook ────────────────────────────────────────────────
// Emails sent to a workspace's dedicated address (Workspace.inboundEmail,
// e.g. `acme-corp.k3f9@in.lumen.app`) are forwarded here by an inbound-email
// provider (SendGrid Inbound Parse, Postmark inbound, Mailgun routes,
// Cloudflare Email Workers…). Each supported attachment is ingested into the
// Data Room exactly like a user upload: object storage, Document row, worker
// queue — but into the workspace's "Email Inbox" collection, with the
// sender/subject kept on the document for triage.

const router = Router();

// Providers POST either multipart (SendGrid: fields + attachment1..n files;
// Postmark multipart: a single `data` field holding JSON) or JSON (Postmark
// JSON, Cloudflare Email Workers). Multer handles the multipart shapes.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 20 },
});

const EMAIL_INBOX = 'Email Inbox';

// Pull every email address out of any shape providers send: display headers
// ("Name <a@b.com>"), comma lists, JSON strings (SendGrid's `envelope`),
// arrays or objects (Postmark JSON).
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
function extractAddresses(...values: unknown[]): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (!v) return;
    if (typeof v === 'string') {
      for (const m of v.matchAll(EMAIL_RE)) out.push(m[0].toLowerCase());
      return;
    }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  values.forEach(walk);
  return [...new Set(out)];
}

interface Attachment { name: string; mimeType: string; buffer: Buffer }

router.post(
  '/',
  upload.any(),
  asyncH(async (req, res) => {
    // Shared secret (empty only in local dev).
    const secret = (req.header('x-webhook-secret') || (req.query.secret as string | undefined)) ?? '';
    if (config.inboundEmail.secret && secret !== config.inboundEmail.secret) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid webhook secret.');
    }
    if (storageMode() === 's3' && !hasStorage()) {
      throw new ApiError(503, 'STORAGE_UNCONFIGURED', 'S3 storage is selected but not configured.');
    }

    const body = req.body as Record<string, unknown>;
    // Postmark multipart: JSON inside a `data` field.
    let json: Record<string, unknown> | null = null;
    if (typeof body.data === 'string') {
      try { json = JSON.parse(body.data); } catch { json = null; }
    } else if (body.From || body.Attachments) {
      json = body; // Postmark-style application/json post
    }

    const fromRaw = String(json?.From ?? body.from ?? body.sender ?? body.From ?? '');
    const from = (fromRaw && (extractAddresses(fromRaw)[0] ?? fromRaw)) || null;
    const subject = String(json?.Subject ?? body.subject ?? '') || null;
    const recipients = extractAddresses(
      json?.To, body.to, body.recipient, body.envelope, body.To, body.Recipient,
    );

    // Attachments: multipart files, Postmark JSON (base64), or generic JSON arrays.
    const attachments: Attachment[] = [];
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    for (const f of files) {
      attachments.push({ name: f.originalname, mimeType: f.mimetype || 'application/octet-stream', buffer: f.buffer });
    }
    for (const key of ['Attachments', 'attachments']) {
      const arr = (json?.[key] ?? body[key]) as { Name?: string; name?: string; Content?: string; content?: string; ContentType?: string; contentType?: string }[] | undefined;
      if (!Array.isArray(arr)) continue;
      for (const a of arr) {
        const b64 = a.Content ?? a.content ?? '';
        if (!b64) continue;
        attachments.push({
          name: a.Name ?? a.name ?? 'attachment',
          mimeType: (a.ContentType ?? a.contentType) || 'application/octet-stream',
          buffer: Buffer.from(b64, 'base64'),
        });
      }
    }

    if (!recipients.length) {
      res.status(200).json({ ok: true, skipped: 'No recipient address found.' });
      return;
    }
    const ws = await prisma.workspace.findFirst({
      where: { inboundEmail: { in: recipients }, deletedAt: null },
    });
    // Always 200 on a non-match so the provider does not retry forever — an
    // email to an unknown workspace address is not an error.
    if (!ws) {
      res.status(200).json({ ok: true, skipped: 'No workspace matches this address.' });
      return;
    }
    if (!attachments.length) {
      res.status(200).json({ ok: true, created: 0, skipped: 'No attachments.' });
      return;
    }

    // Ensure the Email Inbox collection exists (documents are filed here for
    // manual triage into company folders; concurrent creation races are fine).
    let inbox = await prisma.collection.findFirst({
      where: { workspaceId: ws.id, name: EMAIL_INBOX, deletedAt: null },
      select: { id: true },
    });
    if (!inbox) {
      try {
        inbox = await prisma.collection.create({
          data: {
            workspaceId: ws.id, name: EMAIL_INBOX,
            description: 'Attachments received via the workspace inbound email address',
            createdById: ws.createdById,
          },
          select: { id: true },
        });
      } catch {
        inbox = await prisma.collection.findFirst({
          where: { workspaceId: ws.id, name: EMAIL_INBOX, deletedAt: null },
          select: { id: true },
        });
      }
    }

    const created: string[] = [];
    const rejected: { file: string; reason: string }[] = [];

    for (const att of attachments) {
      const ext = extOf(att.name);
      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        rejected.push({ file: att.name, reason: `Unsupported format .${ext}.` });
        continue;
      }

      const doc = await prisma.document.create({
        data: {
          workspaceId: ws.id,
          collectionId: inbox?.id ?? null,
          name: att.name,
          fileType: ext,
          mimeType: att.mimeType,
          sizeBytes: att.buffer.length,
          status: 'UPLOADING',
          storageKey: 'pending',
          ownerId: ws.createdById,
          source: 'EMAIL',
          emailFrom: from,
          emailSubject: subject,
          emailReceivedAt: new Date(),
        },
      });

      const key = storageKey(ws.id, doc.id, ext);
      await putObject(key, att.buffer, att.mimeType);

      await prisma.$transaction([
        prisma.document.update({ where: { id: doc.id }, data: { storageKey: key, status: 'QUEUED' } }),
        prisma.workspace.update({
          where: { id: ws.id },
          data: { storageUsedBytes: { increment: att.buffer.length } },
        }),
      ]);
      await enqueue('PROCESS_DOCUMENT', { documentId: doc.id });
      await audit({
        workspaceId: ws.id,
        actorId: null,
        action: 'document.email_received',
        targetType: 'document',
        targetId: doc.id,
        meta: { name: att.name, from, subject, sizeBytes: att.buffer.length },
        ip: req.ip,
      });
      created.push(doc.id);
    }

    // Providers treat non-2xx as a retryable failure; a fully-rejected email
    // is still "delivered" from the provider's perspective.
    res.status(200).json({ ok: true, created: created.length, rejected });
  }),
);

export default router;
