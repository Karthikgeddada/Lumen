// Certificates (use case 4): each borrower's reported ratios vs the figures
// Lumen has independently stored, side by side, with a verdict per row —
// match / within tolerance / differs materially / cannot compare — and
// evidence links on both sides. The certificate's figures come from the
// document's own summary (what the borrower stated); the recomputed side is
// the metric-observation layer (reported / calculated / AI-inferred, each
// labeled) that covenants and analytics run on.

import { Router } from 'express';
import { prisma } from '../prisma';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { asyncH } from '../middleware/error';
import { parseNumericValueDetailed } from '../services/normalizer';

const router = Router({ mergeParams: true }); // route carries :workspaceId itself; mounted at /api

// A document counts as a certificate when its name says so — the same
// convention the quarterly package uses (compliance certificate, borrowing
// base certificate, covenant report…).
const MAX_DOCS_PER_ENTITY = 50;
const MAX_FIGURES_PER_DOC = 30;

// Verdict bands: how far the certificate's stated figure may sit from the
// stored observation before it stops being a match.
const MATCH_PCT = 1; // ≤ 1% → MATCH
const TOLERANCE_PCT = 10; // ≤ 10% → WITHIN_TOLERANCE; above → DIFFERS_MATERIALLY

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function quarterOf(d: Date): string {
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
}

// The period a certificate speaks about: the quarter in its name when there is
// one, else the quarter it arrived.
function periodOf(doc: { name: string; emailReceivedAt: Date | null; uploadedAt: Date }): string {
  const m = doc.name.match(/Q([1-4])\s?(\d{4})/i);
  if (m) return `Q${m[1]} ${m[2]}`;
  const y = doc.name.match(/\b(\d{4})\b/);
  if (y) return y[1]; // annual certificate
  return quarterOf(doc.emailReceivedAt ?? doc.uploadedAt);
}

interface SummaryFigure { label?: string; value?: unknown; unit?: string; page?: number }

router.get(
  '/workspaces/:workspaceId/certificates',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const wid = req.ws!.id;
    const entityId = (req.query.entityId as string | undefined) ?? null;

    const entities = await prisma.entity.findMany({
      where: { workspaceId: wid, ...(entityId ? { id: entityId } : {}) },
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true, parentId: true },
    });

    const out = [];
    for (const e of entities) {
      const docs = await prisma.document.findMany({
        where: {
          workspaceId: wid, entityId: e.id, deletedAt: null, status: 'COMPLETED',
          OR: [
            { name: { contains: 'certificate', mode: 'insensitive' } },
            { name: { contains: 'compliance report', mode: 'insensitive' } },
            { name: { contains: 'covenant report', mode: 'insensitive' } },
          ],
        },
        orderBy: { uploadedAt: 'desc' },
        take: MAX_DOCS_PER_ENTITY,
        select: {
          id: true, name: true, source: true, uploadedAt: true, emailReceivedAt: true,
          summary: { select: { figures: true } },
        },
      });

      // All observations for the entity once; each certificate filters its own
      // period out of this list.
      const observations = await prisma.metricObservation.findMany({
        where: { entityId: e.id },
        select: {
          metricKey: true, label: true, period: true, value: true, unit: true,
          derivation: true, confidence: true,
          sourceDocumentId: true, sourcePage: true, sourceExcerpt: true,
        },
      });

      const certificates = docs.map((doc) => {
        const period = periodOf(doc);
        const figures = ((doc.summary?.figures as SummaryFigure[] | undefined) ?? []).slice(0, MAX_FIGURES_PER_DOC);
        const periodObs = observations.filter((o) => o.period === period);

        const rows = [];
        for (const f of figures) {
          const label = (f.label ?? '').trim();
          if (!label) continue;
          // Summary figures store values as strings; the normalizer parses
          // numerals, commas, currency marks and magnitude words ("4.82",
          // "$1.2B"). Unparseable figures have nothing to compare.
          const detail = parseNumericValueDetailed(String(f.value ?? ''), f.unit);
          if (!detail || !Number.isFinite(detail.value)) continue;
          const reported = detail.value;

          // Match the certificate's label to a stored metric: containment in
          // either direction on normalized text ("Debt Service Coverage" vs
          // "Debt service coverage ratio"). Longest labels win so specific
          // metrics beat generic ones.
          const obs = [...periodObs]
            .sort((a, b) => b.label.length - a.label.length)
            .find((o) => {
              const a = norm(label);
              const b = norm(o.label);
              return a && b && (b.includes(a) || a.includes(b));
            }) ?? null;

          const diffPct = obs
            ? (Math.abs(reported - obs.value) / Math.max(Math.abs(obs.value), 1e-9)) * 100
            : null;
          const verdict =
            !obs || diffPct == null
              ? 'CANNOT_COMPARE'
              : diffPct <= MATCH_PCT
                ? 'MATCH'
                : diffPct <= TOLERANCE_PCT
                  ? 'WITHIN_TOLERANCE'
                  : 'DIFFERS_MATERIALLY';

          rows.push({
            label,
            reported: { value: reported, unit: f.unit ?? null, page: f.page ?? null },
            recomputed: obs
              ? {
                  value: obs.value, unit: obs.unit, derivation: obs.derivation,
                  confidence: obs.confidence,
                  source: { documentId: obs.sourceDocumentId, page: obs.sourcePage, excerpt: obs.sourceExcerpt },
                }
              : null,
            verdict,
            diffPct: diffPct != null ? Math.round(diffPct * 10) / 10 : null,
          });
        }

        const order: Record<string, number> = { DIFFERS_MATERIALLY: 0, WITHIN_TOLERANCE: 1, CANNOT_COMPARE: 2, MATCH: 3 };
        rows.sort((a, b) => order[a.verdict] - order[b.verdict]);

        return {
          document: {
            id: doc.id, name: doc.name, source: doc.source, period,
            arrivedAt: (doc.emailReceivedAt ?? doc.uploadedAt).toISOString(),
          },
          rows,
          summary: {
            match: rows.filter((r) => r.verdict === 'MATCH').length,
            withinTolerance: rows.filter((r) => r.verdict === 'WITHIN_TOLERANCE').length,
            differsMaterially: rows.filter((r) => r.verdict === 'DIFFERS_MATERIALLY').length,
            cannotCompare: rows.filter((r) => r.verdict === 'CANNOT_COMPARE').length,
          },
        };
      });

      out.push({ id: e.id, name: e.name, parentId: e.parentId, certificates });
    }

    res.json({ entities: out });
  }),
);

export default router;
