// THE evidence helper for every chart click (single place — no chart wires
// its own source link). A point with a backing source document links to the
// document viewer with its page; a point without one reports 'source
// unavailable' and never renders a dead click.

export type EvidenceLink = {
  href: string;
  documentId: string;
  page: number | null;
};

type EvidencePoint = {
  sourceDocumentId?: string | null;
  documentId?: string | null;
  sourcePage?: number | null;
};

/** Null when the point has no source document — callers show 'source unavailable'. */
export function evidenceLinkFor(point: EvidencePoint | Record<string, unknown>): EvidenceLink | null {
  const p = point as EvidencePoint;
  const doc = p.sourceDocumentId ?? p.documentId;
  if (typeof doc !== 'string' || doc.length === 0) return null;
  const page = typeof p.sourcePage === 'number' && Number.isFinite(p.sourcePage) ? p.sourcePage : null;
  return {
    href: page !== null ? `/documents/${doc}?page=${page}` : `/documents/${doc}`,
    documentId: doc,
    page,
  };
}

export function evidenceAvailable(point: EvidencePoint | Record<string, unknown>): boolean {
  return evidenceLinkFor(point) !== null;
}

/** Tooltip / caption text: 'Source: p.3' vs 'Source unavailable'. */
export function evidenceLabel(point: EvidencePoint | Record<string, unknown>): string {
  const link = evidenceLinkFor(point);
  return link ? (link.page !== null ? `Source: p.${link.page} — click to view` : 'Source: document — click to view') : 'Source unavailable';
}
