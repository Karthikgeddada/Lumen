'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowLeft, FileText, Download, MessagesSquare, ClipboardCheck,
  AlertTriangle, Table2, ChevronRight,
} from 'lucide-react';
import { api } from '../../../../lib/api';
import {
  DocStatusBadge, DemoTag, EmptyState, LoadingBlock, formatBytes, formatDate, timeAgo,
} from '../../../../components/ui';

interface DocDetail {
  id: string; name: string; fileType: string; mimeType: string; sizeBytes: number;
  pageCount: number | null; status: string; error: string | null; isDemo: boolean;
  uploadedAt: string; processedAt: string | null;
  collection: { id: string; name: string } | null;
  owner: { id: string; firstName: string; lastName: string } | null;
  summary: { summary: string; keyFacts: string[]; figures: Record<string, unknown>[]; model: string } | null;
  sections: { id: string; kind: string; headingPath: string[]; page: number | null; text: string; order: number }[];
  tables: { id: string; sheet: string | null; title: string | null; header: string[]; rows: { id: string; rowIndex: number; cells: string[] }[] }[];
  _count: { chunks: number; tables: number; sections: number };
}

export default function DocumentViewer() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'summary' | 'text' | 'tables'>('summary');
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data, isLoading, error } = useSWR(id, (docId: string) => api<{ document: DocDetail }>(`/api/documents/${docId}`));
  const doc = data?.document;

  if (isLoading) return <main className="content"><LoadingBlock label="Loading document…" /></main>;
  if (error || !doc) {
    return (
      <main className="content">
        <EmptyState icon={<FileText size={20} />} title="Document not found"
          sub="It may have been deleted, or it belongs to a workspace you're no longer in."
          action={<Link href="/library" className="btn btn-secondary btn-sm"><ArrowLeft size={14} /> Back to library</Link>} />
      </main>
    );
  }

  async function download() {
    setDownloadError(null);
    try {
      const res = await api<{ url: string }>(`/api/documents/${doc!.id}/download`);
      window.open(res.url, '_blank');
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download unavailable.');
    }
  }

  // Group sections under their top heading.
  const headings: { heading: string; sections: typeof doc.sections }[] = [];
  for (const s of doc.sections) {
    const h = s.headingPath?.[0] ?? 'Document';
    const last = headings[headings.length - 1];
    if (last && last.heading === h) last.sections.push(s);
    else headings.push({ heading: h, sections: [s] });
  }

  return (
    <main className="content">
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/library" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 10, color: 'var(--text-muted)' }}>
          <ArrowLeft size={13} /> Library
        </Link>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {doc.name} {doc.isDemo ? <DemoTag /> : null}
            </div>
            <div className="page-desc">
              {doc.collection ? `in ${doc.collection.name} · ` : ''}
              {doc.fileType.toUpperCase()} · {formatBytes(doc.sizeBytes)} ·
              {doc.pageCount ? ` ${doc.pageCount} pages` : ' spreadsheet'} ·
              uploaded {formatDate(doc.uploadedAt)} by {doc.owner ? `${doc.owner.firstName} ${doc.owner.lastName}`.trim() : '—'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <DocStatusBadge status={doc.status} />
            <Link className="btn btn-secondary" href={`/assistant?doc=${doc.id}`}><MessagesSquare size={14} /> Ask about this</Link>
            <Link className="btn btn-secondary" href={`/extraction?doc=${doc.id}`}><ClipboardCheck size={14} /> Extract data</Link>
            <button className="btn btn-secondary" onClick={download} disabled={doc.isDemo} title={doc.isDemo ? 'Demo documents have no original file' : 'Download original'}>
              <Download size={14} /> Download
            </button>
          </div>
        </div>
        {downloadError ? <div className="badge badge-warning" style={{ marginTop: 8 }}>{downloadError}</div> : null}
      </div>

      {doc.status === 'FAILED' ? (
        <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={16} color="var(--warning)" style={{ marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Processing failed</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
              {doc.error ?? 'The document could not be processed.'}
              {doc.error?.toLowerCase().includes('ocr')
                ? ' Scanned/image-only PDFs need OCR, which this deployment does not include yet.'
                : ''}
            </div>
          </div>
        </div>
      ) : null}

      {doc.isDemo ? (
        <div className="card card-pad" style={{ marginBottom: 16, background: 'var(--blue-tint)', boxShadow: 'none' }}>
          <div style={{ fontSize: 13, color: 'var(--blue-text)' }}>
            <strong>Demo document.</strong> This is sample reference content — clearly distinct from your real uploads.
            Its structure, tables, and citations behave exactly like a real processed document.
          </div>
        </div>
      ) : null}

      {doc.status !== 'COMPLETED' ? (
        <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="spinner" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {doc.status === 'FAILED' ? 'Processing failed' : 'Processing in progress'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Text, tables, and structure are being extracted. This view fills in automatically.
            </div>
          </div>
          <DocStatusBadge status={doc.status} />
        </div>
      ) : (
        <>
          <div className="tabs" style={{ marginBottom: 16 }}>
            <button className={`tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>Summary</button>
            <button className={`tab ${tab === 'text' ? 'active' : ''}`} onClick={() => setTab('text')}>Structure ({doc._count.sections})</button>
            <button className={`tab ${tab === 'tables' ? 'active' : ''}`} onClick={() => setTab('tables')}>Tables ({doc._count.tables})</button>
          </div>

          {tab === 'summary' ? (
            <div className="grid-2" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
              <div className="card">
                <div className="card-header">
                  <div className="card-title">AI summary</div>
                  {doc.summary?.model ? <span className="card-sub mono">{doc.summary.model}</span> : null}
                </div>
                <div style={{ padding: 20, fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-secondary)' }}>
                  {doc.summary?.summary ?? 'No summary available.'}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="card">
                  <div className="card-header"><div className="card-title">Key facts</div></div>
                  <div style={{ padding: '8px 20px' }}>
                    {doc.summary?.keyFacts?.length ? doc.summary.keyFacts.map((f, i) => (
                      <div key={i} style={{ padding: '10px 0', borderBottom: i < doc.summary!.keyFacts.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 13.2 }}>
                        {f}
                      </div>
                    )) : (
                      <div style={{ padding: '14px 0', fontSize: 13, color: 'var(--text-muted)' }}>No key facts extracted.</div>
                    )}
                  </div>
                </div>
                <div className="card">
                  <div className="card-header"><div className="card-title">Provenance</div></div>
                  <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12.5 }}>
                    <Fact label="Sections" value={String(doc._count.sections)} />
                    <Fact label="Tables" value={String(doc._count.tables)} />
                    <Fact label="Passages indexed" value={String(doc._count.chunks)} />
                    <Fact label="Processed" value={doc.processedAt ? timeAgo(doc.processedAt) : '—'} />
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'text' ? (
            <div className="card">
              {headings.length === 0 ? (
                <EmptyState icon={<FileText size={20} />} title="No extracted text"
                  sub="This document had no extractable text sections." />
              ) : (
                headings.map((group, gi) => (
                  <div key={gi}>
                    <div style={{
                      padding: '10px 20px', background: 'var(--sunken)', borderBottom: '1px solid var(--border)',
                      fontSize: 12, fontWeight: 650, letterSpacing: '0.02em', color: 'var(--text-secondary)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <ChevronRight size={12} /> {group.heading}
                    </div>
                    {group.sections.map((s) => (
                      <div key={s.id} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>
                          {s.page ? `Page ${s.page}` : s.kind === 'HEADING' ? 'Heading' : 'Paragraph'}
                        </div>
                        <div style={{ fontSize: 13.5, lineHeight: 1.62, color: s.kind === 'HEADING' ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: s.kind === 'HEADING' ? 640 : 400 }}>
                          {s.text}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === 'tables' ? (
            doc.tables.length === 0 ? (
              <div className="card">
                <EmptyState icon={<Table2 size={20} />} title="No tables found"
                  sub="Spreadsheet tables appear here with their sheets, headers, and rows." />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {doc.tables.map((t) => (
                  <div className="card" key={t.id}>
                    <div className="card-header">
                      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Table2 size={14} color="var(--text-muted)" /> {t.title ?? 'Table'}
                      </div>
                      {t.sheet ? <span className="badge badge-neutral">Sheet “{t.sheet}”</span> : null}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="table" style={{ minWidth: 600 }}>
                        <thead><tr>{t.header.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                        <tbody>
                          {t.rows.map((r) => (
                            <tr key={r.id}>{r.cells.map((c, i) => (
                              <td key={i} className={i === 0 ? 'strong' : ''} style={i > 0 ? { fontVariantNumeric: 'tabular-nums' } : undefined}>{c}</td>
                            ))}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : null}
        </>
      )}
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div className="mono" style={{ marginTop: 2 }}>{value}</div>
    </div>
  );
}
