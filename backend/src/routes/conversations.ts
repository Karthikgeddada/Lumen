import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { audit } from '../utils';
import { aiUnavailableMessage, chat, chatStream, hasAI } from '../services/ai';
import { ANTI_INJECTION_RULES, buildContext, retrieve, type RetrievedChunk } from '../services/rag';

const router = Router();

// Conversations are scoped to their creator inside a workspace. The retrieval
// scope (documents / collection / whole workspace) is resolved on the backend
// from workspace-visible documents only — another user's workspaces are
// unreachable by construction.

async function requireConversationOwnership(req: { auth?: { userId: string }; params: Record<string, string> }, id: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, deletedAt: null },
    include: { workspace: { select: { id: true, name: true, deletedAt: true } } },
  });
  if (!conversation || conversation.deletedAt || conversation.userId !== req.auth!.userId || conversation.workspace.deletedAt) {
    throw new ApiError(404, 'NOT_FOUND', 'Conversation not found.');
  }
  return conversation;
}

// ── List / create conversations (workspace-scoped) ───────────────────
router.get(
  '/workspaces/:workspaceId/conversations',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const q = (req.query.q as string | undefined)?.trim();
    const conversations = await prisma.conversation.findMany({
      where: {
        workspaceId: req.ws!.id,
        userId: req.auth!.userId,
        deletedAt: null,
        ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true, title: true, documentIds: true, collectionId: true, createdAt: true, updatedAt: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, createdAt: true } },
      },
    });
    res.json({ conversations });
  }),
);

router.post(
  '/workspaces/:workspaceId/conversations',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const body = z
      .object({
        title: z.string().trim().max(120).optional(),
        documentIds: z.array(z.string()).max(50).optional(),
        collectionId: z.string().nullable().optional(),
      })
      .parse(req.body ?? {});

    // The scope can only reference documents this workspace can see.
    const validIds = body.documentIds?.length
      ? (
          await prisma.document.findMany({
            where: { id: { in: body.documentIds }, workspaceId: req.ws!.id, deletedAt: null },
            select: { id: true },
          })
        ).map((d) => d.id)
      : [];

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: req.ws!.id,
        userId: req.auth!.userId,
        title: body.title?.trim() || 'New conversation',
        documentIds: validIds,
        collectionId: body.collectionId ?? null,
      },
    });
    res.status(201).json({ conversation });
  }),
);

// ── Single conversation ───────────────────────────────────────────
router.get(
  '/conversations/:conversationId',
  requireAuth,
  asyncH(async (req, res) => {
    const conversation = await requireConversationOwnership(req, req.params.conversationId);
    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      include: {
        citations: {
          orderBy: { ref: 'asc' },
          select: {
            ref: true, kind: true, page: true, sheet: true, tableRef: true, excerpt: true,
            documentId: true, document: { select: { name: true } },
          },
        },
      },
    });
    res.json({ conversation, messages });
  }),
);

router.patch(
  '/conversations/:conversationId',
  requireAuth,
  asyncH(async (req, res) => {
    const conversation = await requireConversationOwnership(req, req.params.conversationId);
    const body = z
      .object({
        title: z.string().trim().min(1).max(120).optional(),
        documentIds: z.array(z.string()).max(50).optional(),
        collectionId: z.string().nullable().optional(),
      })
      .parse(req.body ?? {});
    const data: { title?: string; documentIds?: string[]; collectionId?: string | null } = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.documentIds !== undefined) {
      // The scope can only reference documents this workspace can see.
      data.documentIds = body.documentIds.length
        ? (
            await prisma.document.findMany({
              where: { id: { in: body.documentIds }, workspaceId: conversation.workspaceId, deletedAt: null },
              select: { id: true },
            })
          ).map((d) => d.id)
        : [];
    }
    if (body.collectionId !== undefined) {
      if (body.collectionId) {
        const coll = await prisma.collection.findFirst({
          where: { id: body.collectionId, workspaceId: conversation.workspaceId, deletedAt: null },
        });
        if (!coll) throw new ApiError(404, 'NOT_FOUND', 'Collection not found.');
      }
      data.collectionId = body.collectionId;
    }
    const updated = await prisma.conversation.update({ where: { id: conversation.id }, data });
    res.json({ conversation: updated });
  }),
);

router.delete(
  '/conversations/:conversationId',
  requireAuth,
  asyncH(async (req, res) => {
    const conversation = await requireConversationOwnership(req, req.params.conversationId);
    await prisma.conversation.update({ where: { id: conversation.id }, data: { deletedAt: new Date() } });
    res.json({ ok: true });
  }),
);

// ── Ask a question ─────────────────────────────────────────────────
router.post(
  '/conversations/:conversationId/messages',
  requireAuth,
  asyncH(async (req, res) => {
    const conversation = await requireConversationOwnership(req, req.params.conversationId);
    const body = z
      .object({ content: z.string().trim().min(1).max(4000), stream: z.boolean().optional().default(true) })
      .parse(req.body);

    if (!hasAI()) throw new ApiError(503, 'AI_UNAVAILABLE', aiUnavailableMessage());

    const documentIds = (conversation.documentIds as string[]) ?? [];
    const scope = documentIds.length
      ? { documentIds }
      : conversation.collectionId
        ? { collectionId: conversation.collectionId }
        : {};

    const chunks: RetrievedChunk[] = await retrieve(conversation.workspaceId, scope, body.content, 8);

    // Persist the user's message.
    const userMessage = await prisma.message.create({
      data: { conversationId: conversation.id, role: 'USER', content: body.content },
    });
    if (conversation.title === 'New conversation') {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { title: body.content.slice(0, 60) } });
    }

    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id, id: { not: userMessage.id } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { role: true, content: true },
    });

    const evidenceText = chunks.length
      ? buildContext(chunks)
      : 'NO EVIDENCE FOUND — the authorized documents contain no passages matching this question. State that plainly.';

    const systemPrompt = `${ANTI_INJECTION_RULES}

Evidence blocks (the ONLY citable sources):
${evidenceText}`;

    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.reverse().map((m) => ({ role: m.role === 'USER' ? ('user' as const) : ('assistant' as const), content: m.content.slice(0, 1500) })),
      { role: 'user' as const, content: body.content },
    ];

    const persist = async (answer: string, latencyMs: number) => {
      const assistantMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: answer,
          model: 'ai',
          latencyMs,
        },
      });
      // Only citations that reference evidence blocks we actually provided.
      const used = new Set(
        [...answer.matchAll(/\[(\d{1,2})/g)].map((m) => parseInt(m[1], 10)).filter((n) => n >= 1 && n <= chunks.length),
      );
      if (used.size) {
        await prisma.citation.createMany({
          data: [...used].map((n, i) => ({
            messageId: assistantMessage.id,
            documentId: chunks[n - 1].documentId,
            ref: i + 1,
            kind: chunks[n - 1].kind as never,
            page: chunks[n - 1].page,
            sheet: chunks[n - 1].sheet,
            tableRef: chunks[n - 1].sheet
              ? `Sheet ${chunks[n - 1].sheet}`
              : chunks[n - 1].page != null
                ? `Page ${chunks[n - 1].page}`
                : null,
            excerpt: chunks[n - 1].text.slice(0, 1500),
          })),
        });
      }
      const full = await prisma.message.findUnique({
        where: { id: assistantMessage.id },
        include: {
          citations: {
            orderBy: { ref: 'asc' },
            select: {
              ref: true, kind: true, page: true, sheet: true, tableRef: true, excerpt: true,
              documentId: true, document: { select: { name: true } },
            },
          },
        },
      });
      return full;
    };

    if (body.stream) {
      // Server-Sent Events: token deltas, then the final message with citations.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const started = Date.now();
      let answer = '';
      try {
        for await (const piece of chatStream(chatMessages)) {
          answer += piece;
          res.write(`data: ${JSON.stringify({ delta: piece })}\n\n`);
        }
        const message = await persist(answer, Date.now() - started);
        res.write(`data: ${JSON.stringify({ done: true, message })}\n\n`);
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: 'The AI provider failed mid-response. Please try again.' })}\n\n`);
      } finally {
        res.end();
      }
      await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      void userMessage;
    } else {
      const started = Date.now();
      const answer = await chat(chatMessages);
      const message = await persist(answer, Date.now() - started);
      await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      res.json({ userMessage, message });
    }
  }),
);

export default router;
