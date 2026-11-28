'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Award, Building2, FileText } from 'lucide-react';
import { api } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import { DerivationBadge, EmptyState, ErrorBanner, LoadingBlock, timeAgo } from '../../../components/ui';

// Certificates (use case 4): each company's stated ratios vs what Lumen has
// independently stored — side by side, with a verdict per figure and evidence
// links to both sides.

interface CertRow {
  label: string;
  reported: { value: number; unit: string | null; page: number | null };
  recomputed: {
    value: number; unit: string; derivation: string; confidence: number | null;
    source: { documentId: string | null; page: number | null; excerpt: string | null };
  } | null;
  verdict: 'MATCH' | 'WITHIN_TOLERANCE' | 'DIFFERS_MATERIALLY' | 'CANNOT_COMPARE';
  diffPct: number | null;
}
interface CertDoc {
  document: { id: string; name: string; source: string; period: string; arrivedAt: string };
  rows: CertRow[];
  summary: { match: number; withinTolerance: number; differsMaterially: number; cannotCompare: number };
}
interface CertEntity { id: string; name: string; parentId: string | null; certificates: CertDoc[] }

const VERDICT_META: Record<string, { label: string; bg: string; color: string }> = {
  MATCH: { label: 'Match', bg: 'rgba(46,160,67,.15)', color: '#2ea043' },
  WITHIN_TOLERANCE: { label: 'Within tolerance', bg: 'rgba(28,79,216,.12)', color: '#153a94' },
  DIFFERS_MATERIALLY: { label: 'Differs materially', bg: 'rgba(220,38,38,.12)', color: '#dc2626' },
  CANNOT_COMPARE: { label: 'Cannot compare', bg: 'var(--sunken)', color: 'var(--text-muted)' },
};

function VerdictChip({ verdict }: { verdict: string }) {
  const m = VERDICT_META[verdict] ?? VERDICT_META.CANNOT_COMPARE;
  return (
    <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
}

const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function Certificates() {
  const { workspace } = useWorkspace();
  const wid = workspace?.workspace.id;
  const [entityId, setEntityId] = useState<string | null>(null);

  const { data, isLoading, error } = useSWR(
    wid ? `certs-${wid}` : null,
    () => api<{ entities: CertEntity[] }>(`/api/workspaces/${wid}/certificates`),
  );

  const withCerts = (data?.entities ?? []).filter((e) => e.certificates.length > 0);
  const selected = entityId ? data?.entities.find((e) => e.id === entityId) : withCerts[0] ?? data?.entities[0] ?? null;

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Certificates</div>
          <div className="page-desc">
            Each company&apos;s reported ratios vs Lumen&apos;s independently stored figures — match, within tolerance, differs materially, or cannot compare.
          </div>
        </div>
        {/* Tab pair with Covenants — certificates' final home is a tab here (spec). */}
        <div className="tabs">
          <Link href="/covenants" className="tab">Covenant tests</Link>
          <Link href="/certificates" className="tab active">Certificates</Link>
        </div>
      </div>

      <ErrorBanner message={error ? 'Could not load certificates.' : null} />

      {/* Company selector */}
      {(data?.entities?.length ?? 0) > 0 ? (
        <div className="card" style={{ padding: '10px 12px', marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data!.entities.map((e) => {
            const active = selected?.id === e.id;
            const hasCerts = e.certificates.length > 0;
            return (
              <button key={e.id} className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setEntityId(e.id)}>
                <Building2 size={13} /> {e.name}
                {hasCerts ? (
                  <span style={{ marginLeft: 4, fontSize: 10.5, opacity: 0.85 }}>{e.certificates.length}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {isLoading ? <LoadingBlock label="Loading certificates…" /> : null}

      {!isLoading && (data?.entities?.length ?? 0) === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Award size={20} />}
            title="No companies yet"
            sub="Create a company, upload its compliance or borrowing-base certificates, and Lumen will compare what the certificate states against the figures it has stored."
          />
        </div>
      ) : null}

      {!isLoading && data && (data.entities.length > 0) && !selected?.certificates.length ? (
        <div className="card">
          <EmptyState
            icon={<Award size={20} />}
            title="No certificates for this company yet"
            sub="A document whose name mentions a certificate, compliance report or covenant report — processed in the Data Room — appears here with its figures compared."
          />
        </div>
      ) : null}

      {selected?.certificates.map((cert) => (
        <div className="card" key={cert.document.id} style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <FileText size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
              <Link href={`/documents/${cert.document.id}`} style={{ color: 'inherit', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cert.document.name}
              </Link>
              <span className="badge badge-blue">{cert.document.period}</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>arrived {timeAgo(cert.document.arrivedAt)}</span>
          </div>

          {/* Roll-up verdict chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 20px 12px', borderBottom: '1px solid var(--border)' }}>
            <VerdictChip verdict="MATCH" /><span style={{ fontSize: 12 }}>{cert.summary.match}</span>
            <VerdictChip verdict="WITHIN_TOLERANCE" /><span style={{ fontSize: 12 }}>{cert.summary.withinTolerance}</span>
            <VerdictChip verdict="DIFFERS_MATERIALLY" /><span style={{ fontSize: 12 }}>{cert.summary.differsMaterially}</span>
            <VerdictChip verdict="CANNOT_COMPARE" /><span style={{ fontSize: 12 }}>{cert.summary.cannotCompare}</span>
            {cert.rows.length === 0 ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No comparable figures found in this document.</span> : null}
          </div>

          {cert.rows.length > 0 ? (
            <table className="table">
              <thead>
                <tr><th>Figure</th><th>Certificate states</th><th>Lumen has</th><th>Verdict</th><th>Δ</th></tr>
              </thead>
              <tbody>
                {cert.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="strong">{r.label}</td>
                    <td>
                      <span className="mono">{fmt(r.reported.value)}</span>
                      {r.reported.unit ? <span style={{ color: 'var(--text-muted)' }}> {r.reported.unit}</span> : null}
                      {r.reported.page != null ? (
                        <Link href={`/documents/${cert.document.id}?page=${r.reported.page}`} className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }}>p.{r.reported.page}</Link>
                      ) : null}
                    </td>
                    <td>
                      {r.recomputed ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className="mono">{fmt(r.recomputed.value)}</span>
                          {r.recomputed.unit ? <span style={{ color: 'var(--text-muted)' }}>{r.recomputed.unit}</span> : null}
                          <DerivationBadge d={r.recomputed.derivation} />
                          {r.recomputed.source.documentId ? (
                            <Link href={`/documents/${r.recomputed.source.documentId}${r.recomputed.source.page != null ? `?page=${r.recomputed.source.page}` : ''}`} className="btn btn-ghost btn-sm" title={r.recomputed.source.excerpt ?? 'Open the supporting document'}>
                              source
                            </Link>
                          ) : null}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>— no stored figure for {cert.document.period}</span>
                      )}
                    </td>
                    <td><VerdictChip verdict={r.verdict} /></td>
                    <td className="mono">{r.diffPct != null ? `${r.diffPct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ))}
    </main>
  );
}
