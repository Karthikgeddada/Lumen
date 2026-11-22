import fs from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { getObject } from './storage';
import { parseDocument } from './parsers';
import { chunksFromSections, chunksFromTable } from './chunker';
import { chatJson, embed, hasAI } from './ai';
import { estimateTokens } from '../utils';

// The full ingestion pipeline, run by the background worker:
//   1. fetch original file from object storage to a temp file
//   2. parse structure per format (pages, headings, tables, sheets, footnotes)
//   3. persist sections, tables + rows, and source-linked chunks
//   4. embed chunks (when an embedding model is configured)
//   5. generate an AI summary with key facts and figures (grounded)
//   6. set final status: COMPLETED / NEEDS_REVIEW / FAILED
// A document is never marked COMPLETED unless its content and chunks exist.

export async function processDocument(documentId: string): Promise<void> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: { workspace: { select: { id: true, storageUsedBytes: true } } },
  });
  if (!doc || doc.deletedAt) return;

  await prisma.document.update({ where: { id: documentId }, data: { status: 'PROCESSING', error: null } });

  const tmpPath = path.join(os.tmpdir(), `lumen-${documentId}.${doc.fileType}`);
  try {
    const buffer = await getObject(doc.storageKey);
    fs.writeFileSync(tmpPath, buffer);

    const parsed = await parseDocument(tmpPath, doc.fileType, doc.name.replace(/\.[^.]+$/, ''));

    // Scanned/image-only documents: no text could be extracted. Honest
    // NEEDS_REVIEW instead of pretending to understand the file.
    if (parsed.ocrRequired && parsed.sections.length === 0 && parsed.tables.length === 0) {
      await prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'NEEDS_REVIEW',
          error: 'No extractable text found. This appears to be a scanned/image-only document; OCR is required to process it further.',
        },
      });
      return;
    }

    // Replace any previous extraction (retry path).
    await prisma.documentSection.deleteMany({ where: { documentId } });
    await prisma.documentTable.deleteMany({ where: { documentId } });
    await prisma.documentChunk.deleteMany({ where: { documentId } });
    await prisma.documentSummary.deleteMany({ where: { documentId } });

    // Sections
    if (parsed.sections.length) {
      await prisma.documentSection.createMany({
        data: parsed.sections.slice(0, 20000).map((s) => ({
          documentId,
          kind: s.kind,
          level: s.level ?? null,
          headingPath: s.headingPath,
          page: s.page,
          order: s.order,
          text: s.text,
        })),
      });
    }

    // Tables + rows
    const tableIdByIndex = new Map<number, string>();
    for (let i = 0; i < parsed.tables.length; i++) {
      const t = parsed.tables[i];
      const created = await prisma.documentTable.create({
        data: {
          documentId,
          sheet: t.sheet ?? null,
          title: t.title ?? null,
          page: t.page ?? null,
          order: t.order,
          header: (t.header as unknown) ?? undefined,
        },
      });
      tableIdByIndex.set(i, created.id);
      if (t.rows.length) {
        await prisma.documentTableRow.createMany({
          data: t.rows.slice(0, 10000).map((r) => ({ tableId: created.id, rowIndex: r.rowIndex, cells: r.cells as unknown[] })),
        });
      }
    }

    // Chunks
    const drafts = [
      ...chunksFromSections(parsed),
      ...parsed.tables.flatMap((t, i) => chunksFromTable(t, i)),
    ];
    if (!drafts.length) throw new Error('Parsing produced no readable content.');

    const tableIdOf = (d: (typeof drafts)[number]) =>
      d.tableIndex != null ? tableIdByIndex.get(d.tableIndex) ?? null : null;

    const createdChunks: string[] = [];
    for (let i = 0; i < drafts.length; i += 200) {
      const batch = drafts.slice(i, i + 200);
      const res = await prisma.documentChunk.createMany({
        data: batch.map((d) => ({
          documentId,
          page: d.page,
          sheet: d.sheet,
          headingPath: d.headingPath,
          tableId: tableIdOf(d) ?? null,
          kind: d.kind,
          text: d.text,
          tokenEstimate: estimateTokens(d.text),
        })),
      });
      void res;
    }

    // Embeddings (optional — keyword retrieval still works without them)
    if (hasAI()) {
      try {
        const rows = await prisma.documentChunk.findMany({
          where: { documentId },
          select: { id: true, text: true },
          take: 2000,
        });
        for (let i = 0; i < rows.length; i += 64) {
          const batch = rows.slice(i, i + 64);
          const vectors = await embed(batch.map((c) => c.text));
          await Promise.all(
            batch.map((c, j) =>
              prisma.documentChunk.update({
                where: { id: c.id },
                data: { embedding: vectors[j] as unknown as object },
              }),
            ),
          );
        }
      } catch (e) {
        logger.warn({ err: String(e), documentId }, 'embedding skipped');
      }
    }

    // Grounded summary with key facts and figures
    if (hasAI()) {
      try {
        const sample = drafts.slice(0, 24).map((d) => d.text.slice(0, 500)).join('\n---\n');
        const summary = await chatJson<{
          summary: string;
          keyFacts: { label: string; value: string; page?: number }[];
          figures: { label: string; value: string; unit?: string; page?: number }[];
        }>([
          {
            role: 'system',
            content:
              'Summarize business documents factually. Use ONLY facts present in the provided excerpts; include page numbers only when the excerpt states them. Omit anything you are unsure about.',
          },
          { role: 'user', content: `Document: ${doc.name}\nExcerpts:\n${sample}` },
        ]);
        if (summary?.summary) {
          await prisma.documentSummary.create({
            data: {
              documentId,
              summary: summary.summary,
              keyFacts: (summary.keyFacts ?? []) as unknown as object,
              figures: (summary.figures ?? []) as unknown as object,
              model: 'ai',
            },
          });
        }
      } catch (e) {
        logger.warn({ err: String(e), documentId }, 'summary skipped');
      }
    }

    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'COMPLETED',
        pageCount: parsed.pageCount,
        processedAt: new Date(),
        error: null,
      },
    });

    await prisma.notification.create({
      data: {
        userId: doc.ownerId,
        workspaceId: doc.workspaceId,
        kind: 'document.completed',
        title: `“${doc.name}” is ready`,
        body: 'Processing completed — the document is now searchable and ready for the assistant.',
        link: `/library/${documentId}`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Processing failed';
    await prisma.document.update({ where: { id: documentId }, data: { status: 'FAILED', error: message } });
    logger.error({ err, documentId }, 'document processing failed');
    throw err;
  } finally {
    fs.rm(tmpPath, { force: true }, () => undefined);
  }
}
