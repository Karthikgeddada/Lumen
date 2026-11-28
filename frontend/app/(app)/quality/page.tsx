'use client';

import useSWR from 'swr';
import Link from 'next/link';
import {
  Gauge, ShieldCheck, ShieldAlert, Brain, Quote, FileText, Table2, Layers, Search,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import { DerivationBadge, EmptyState, LoadingBlock, timeAgo } from '../../../components/ui';

interface DocQuality {
  id: string; name: string; status: string; pageCount: number | null; processedAt: string | null;
  sections: number; tables: number; passages: number;
  extraction: { total: number; verified: number; needsReview: number; flagged: number; avgConfidence: number | null };
}
interface QualityData {
  extraction: { verified: number; needsReview: number; missing: number; rejected: number; flagged: number; total: number; avgConfidence: number | null };
  answers: Record<string, number>;
  covenants: Record<string, number>;
  derivations: Record<string, number>;
  grounding: { documents: number; pagesUnderstood: number; citations: number; sections: number; tables: number; passages: number };
  documents: DocQuality[];
}
interface Revision {
  id: string; entityId: string; entityName: string; metricKey: string; period: string;
  oldValue: number; newValue: number;
  oldDerivation: string; newDerivation: string;
  source: string; actor: string | null; createdAt: string;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

function Bar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--sunken)' }}>
        {total > 0 ? segments.map((s) => (
          s.value > 0 ? <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.value}`} /> : null
        )) : <div style={{ width: '100%' }} />}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 12 }}>
        {segments.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, display: 'inline-block' }} />
            {s.label} <strong style={{ color: 'var(--text-primary)' }}>{s.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Quality() {
  const { workspace } = useWorkspace();
  const wid = workspace?.workspace.id;

  const { data, isLoading } = useSWR(wid ? `qual-${wid}` : null,
    () => api<QualityData>(`/api/workspaces/${wid}/quality`));
  // Figure revision history — every real overwrite of a stored number.
  const { data: revData } = useSWR(wid ? `qual-rev-${wid}` : null,
    () => api<{ revisions: Revision[] }>(`/api/workspaces/${wid}/quality/revisions`));
  const q = data;

  if (isLoading || (!data && wid)) return <main className="content"><LoadingBlock label="Loading quality…" /></main>;

  const openReviews =
    (q?.extraction.needsReview ?? 0) + (q?.answers.NEEDS_REVIEW ?? 0) + (q?.covenants.AI_INFERRED ?? 0);
  const verifiedPct = q ? pct(q.extraction.verified, q.extraction.total) : null;
  const answersTotal = q ? Object.values(q.answers).reduce((a, b) => a + b, 0) : 0;
  const derivTotal = q ? Object.values(q.derivations).reduce((a, b) => a + b, 0) : 0;

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Data Quality</div>
          <div className="page-desc">How much of what Lumen shows is human-verified, how confident the AI is, and where every number comes from — nothing hidden.</div>
        </div>
      </div>

      {!q || q.grounding.documents === 0 ? (
        <div className="card">
          <EmptyState icon={<Gauge size={20} />} title="Nothing to measure yet"
            sub="Upload documents to the Data Room, run an extraction, or ask the assistant — quality analytics appear as you use Lumen." />
        </div>
      ) : (
        <>
          <div className="grid-kpi" style={{ marginBottom: 16 }}>
            <div className="card" style={{ padding: '16px 20px' }}>
              <div className="kpi-value" style={{ color: 'var(--success, #1d9a4b)' }}>
                {verifiedPct != null ? `${verifiedPct}%` : '—'}
              </div>
              <div className="kpi-label">Extraction values verified</div>
            </div>
            <div className="card" style={{ padding: '16px 20px' }}>
              <div className="kpi-value">{q.extraction.avgConfidence != null ? `${Math.round(q.extraction.avgConfidence * 100)}%` : '—'}</div>
              <div className="kpi-label">Avg AI confidence (extraction)</div>
            </div>
            <div className="card" style={{ padding: '16px 20px' }}>
              <div className="kpi-value" style={{ color: openReviews > 0 ? 'var(--error)' : undefined }}>{openReviews}</div>
              <div className="kpi-label">Open reviews</div>
            </div>
            <div className="card" style={{ padding: '16px 20px' }}>
              <div className="kpi-value">{q.grounding.citations}</div>
              <div className="kpi-label">Citations logged</div>
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-header">
                <div className="card-title">Extraction pipeline</div>
                <span className="card-sub">{q.extraction.total} extracted values · {q.extraction.flagged} flagged</span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <Bar segments={[
                  { label: 'Verified', value: q.extraction.verified, color: 'var(--success, #1d9a4b)' },
                  { label: 'Needs review', value: q.extraction.needsReview, color: 'var(--blue)' },
                  { label: 'Missing', value: q.extraction.missing, color: 'var(--border)' },
                  { label: 'Rejected', value: q.extraction.rejected, color: 'var(--error)' },
                ]} />
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Metric provenance</div>
                <span className="card-sub">{derivTotal} portfolio metrics</span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <Bar segments={[
                  { label: 'Reported', value: q.derivations.REPORTED ?? 0, color: 'var(--success, #1d9a4b)' },
                  { label: 'Calculated', value: q.derivations.CALCULATED ?? 0, color: 'var(--blue)' },
                  { label: 'AI-inferred', value: q.derivations.AI_INFERRED ?? 0, color: 'var(--border)' },
                ]} />
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Diligence answers</div>
                <span className="card-sub">{answersTotal} answers</span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <Bar segments={[
                  { label: 'Approved', value: q.answers.APPROVED ?? 0, color: 'var(--success, #1d9a4b)' },
                  { label: 'Needs review', value: q.answers.NEEDS_REVIEW ?? 0, color: 'var(--blue)' },
                  { label: 'AI-drafted', value: q.answers.AI_DRAFTED ?? 0, color: 'var(--border)' },
                  { label: 'Missing', value: q.answers.MISSING ?? 0, color: 'var(--sunken)' },
                  { label: 'Rejected', value: q.answers.REJECTED ?? 0, color: 'var(--error)' },
                ]} />
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Covenant review coverage</div>
                <span className="card-sub">{(q.covenants.REVIEWED ?? 0) + (q.covenants.AI_INFERRED ?? 0)} definitions</span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <Bar segments={[
                  { label: 'Human-reviewed', value: q.covenants.REVIEWED ?? 0, color: 'var(--success, #1d9a4b)' },
                  { label: 'AI-extracted, unreviewed', value: q.covenants.AI_INFERRED ?? 0, color: 'var(--blue)' },
                ]} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Grounding by document</div>
              <span className="card-sub">structure, citations, and verification per document</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>Document</th><th>Status</th><th>Structure</th><th>Passages</th><th>Extraction verified</th><th>Avg confidence</th></tr></thead>
                <tbody>
                  {q.documents.map((d) => {
                    const dp = pct(d.extraction.verified, d.extraction.total);
                    return (
                      <tr key={d.id}>
                        <td className="strong"><Link href={`/documents/${d.id}`}>{d.name}</Link></td>
                        <td>{d.status === 'COMPLETED'
                          ? <span className="badge badge-success"><ShieldCheck size={11} /> Ready</span>
                          : <span className="badge"><ShieldAlert size={11} /> {d.status}</span>}</td>
                        <td style={{ fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          <Layers size={11} style={{ verticalAlign: -1, marginRight: 3 }} />{d.sections}
                          <FileText size={11} style={{ verticalAlign: -1, margin: '0 3px 0 8px' }} />{d.pageCount ?? '—'}pp
                          <Table2 size={11} style={{ verticalAlign: -1, margin: '0 3px 0 8px' }} />{d.tables}
                        </td>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Search size={12} color="var(--text-muted)" /> {d.passages}</span></td>
                        <td>
                          {d.extraction.total > 0 ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 70, height: 6, borderRadius: 3, background: 'var(--sunken)', display: 'inline-block', overflow: 'hidden' }}>
                                <span style={{ display: 'block', height: '100%', width: `${dp ?? 0}%`, background: dp === 100 ? 'var(--success, #1d9a4b)' : 'var(--blue)' }} />
                              </span>
                              <span style={{ fontSize: 12.5 }}>{d.extraction.verified}/{d.extraction.total} · {dp}%</span>
                            </span>
                          ) : <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>—</span>}
                        </td>
                        <td>
                          {d.extraction.avgConfidence != null
                            ? <span style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Brain size={12} color="var(--text-muted)" /> {Math.round(d.extraction.avgConfidence * 100)}%</span>
                            : <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Figure revisions — who changed a stored number, when, from what to what. */}
          {revData?.revisions?.length ? (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header">
                <div className="card-title">Figure revisions</div>
                <span className="card-sub">every real overwrite of a stored figure — manual edit or formula recompute</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th>Company</th><th>Figure</th><th>Period</th><th>Changed</th><th>Derivation</th><th>By</th></tr></thead>
                  <tbody>
                    {revData.revisions.map((r) => (
                      <tr key={r.id}>
                        <td className="strong">{r.entityName}</td>
                        <td className="mono">{r.metricKey}</td>
                        <td>{r.period}</td>
                        <td>
                          <span className="mono" style={{ color: 'var(--text-muted)' }}>{r.oldValue.toLocaleString()}</span>
                          <span style={{ color: 'var(--text-muted)', margin: '0 5px' }}>→</span>
                          <span className="mono" style={{ fontWeight: 700 }}>{r.newValue.toLocaleString()}</span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <DerivationBadge d={r.oldDerivation} /> <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>→</span> <DerivationBadge d={r.newDerivation} />
                        </td>
                        <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                          {r.actor ?? (r.source === 'MANUAL' ? 'Manual entry' : 'Formula recompute')} · {timeAgo(r.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, fontSize: 12.5, color: 'var(--text-muted)' }}>
            <Quote size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {q.grounding.sections} sections, {q.grounding.tables} tables and {q.grounding.passages} passages indexed across {q.grounding.pagesUnderstood} pages —
              every AI answer and extracted value points back into this structure.
            </span>
          </div>
        </>
      )}
    </main>
  );
}
