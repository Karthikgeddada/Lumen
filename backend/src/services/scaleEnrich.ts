// Extraction-time scale enrichment: detects header scales from a document's
// parsed tables/sections, resolves precedence, and writes scale provenance +
// review flags onto extraction results. Kept separate from scale.ts so the
// pure scale logic stays testable without any database env.
// BEFORE review: detects header scales from the document's parsed tables
// and sections, resolves precedence, and writes scale provenance + review
// flags onto every result so the queue shows exactly why a figure was (or
// wasn't) scaled.

import { prisma } from '../prisma';
import { logger } from '../logger';
import { decideScale, detectScaleInText, ScaleCandidate } from './scale';
import { parseNumericValueDetailed } from './normalizer';

export async function enrichResultsWithScale(taskId: string): Promise<void> {
  try {
    const results = await prisma.extractionResult.findMany({
      where: { taskId, value: { not: null } },
      select: {
        id: true, value: true, unit: true, documentId: true,
        page: true, sheet: true, note: true, flagged: true,
      },
    });
    if (!results.length) return;

    // Per-document context, loaded once: tables (title/header/page/sheet) and
    // page→text mapping from sections.
    const docIds = [...new Set(results.map((r) => r.documentId).filter((d): d is string => !!d))];
    interface DocCtx {
      tables: { id: string; title: string | null; header: unknown; page: number | null; sheet: string | null; contextAbove: unknown }[];
      pages: Map<number, string>;
      firstPage: number | null;
    }
    const ctx = new Map<string, DocCtx>();
    for (const docId of docIds) {
      const [tables, sections] = await Promise.all([
        prisma.documentTable.findMany({
          where: { documentId: docId },
          select: { id: true, title: true, header: true, page: true, sheet: true, contextAbove: true },
        }),
        prisma.documentSection.findMany({
          where: { documentId: docId },
          select: { page: true, text: true },
          orderBy: { order: 'asc' },
          take: 400,
        }),
      ]);
      const pages = new Map<number, string>();
      for (const s of sections) {
        if (s.page == null) continue;
        pages.set(s.page, (pages.get(s.page) ?? '') + '\n' + s.text);
      }
      const pageKeys = [...pages.keys()];
      const firstPage = pageKeys.length ? Math.min(...pageKeys) : null;
      ctx.set(docId, { tables, pages, firstPage });
    }

    for (const r of results) {
      const detail = parseNumericValueDetailed(r.value, r.unit);
      if (!detail) continue;

      const c = r.documentId ? ctx.get(r.documentId) : undefined;

      // Table-level candidate: the table this figure came from (same sheet for
      // spreadsheets, same page for paginated documents — PDF tables arrive
      // with item 2; today this serves Excel/DOCX tables).
      let table: ScaleCandidate | null = null;
      if (c) {
        const t = c.tables.find(
          (tb) =>
            (r.sheet && tb.sheet === r.sheet) ||
            (r.sheet == null && r.page != null && tb.page === r.page) ||
            (r.sheet == null && r.page == null && c.tables.length === 1),
        );
        if (t) {
          const headerText = Array.isArray(t.header) ? t.header.join(' ') : '';
          // contextAbove: the ~3 lines above a PDF table — where "(in
          // thousands)" typically sits — now feed the table-level rule.
          const ctxText = Array.isArray(t.contextAbove) ? (t.contextAbove as string[]).join(' ') : '';
          const det = detectScaleInText(`${ctxText} ${t.title ?? ''} ${headerText}`);
          if (det) table = { ...det, from: 'table', page: t.page, sheet: t.sheet, tableId: t.id };
        }
      }

      // Page-level candidate: the page's text (statements usually declare
      // scale near the top of the page).
      let pageCand: ScaleCandidate | null = null;
      if (c && r.page != null) {
        const det = detectScaleInText(c.pages.get(r.page) ?? '');
        if (det) pageCand = { ...det, from: 'page', page: r.page };
      }

      // Document-level candidate: the first page (a one-time declaration).
      let docCand: ScaleCandidate | null = null;
      if (c && c.firstPage != null && r.page !== c.firstPage) {
        const det = detectScaleInText(c.pages.get(c.firstPage) ?? '');
        if (det) docCand = { ...det, from: 'document', page: c.firstPage };
      }

      const decision = decideScale({
        raw: r.value,
        unit: r.unit,
        suffixApplied: detail.suffixApplied,
        unitApplied: detail.unitApplied,
        nonScalable: detail.nonScalable,
        nonScalableReason: detail.nonScalableReason,
        table,
        page: pageCand,
        document: docCand,
      });

      await prisma.extractionResult.update({
        where: { id: r.id },
        data: {
          scale: {
            multiplier: decision.multiplier,
            appliedFrom: decision.appliedFrom,
            provenance: decision.provenance,
            flags: decision.flags,
            nonScalable: detail.nonScalable ? detail.nonScalableReason : null,
          },
          ...(decision.flags.length
            ? {
                flagged: true,
                note: [r.note, ...decision.flags].filter(Boolean).join(' · ') || null,
              }
            : {}),
        },
      });
    }
  } catch (err) {
    // Scale enrichment is best-effort by design: it must never fail an
    // extraction — a failed enrichment just means figures get reviewed
    // without scale annotations.
    logger.error({ err: String(err), taskId }, 'scale enrichment failed');
  }
}