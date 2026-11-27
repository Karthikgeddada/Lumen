'use client';

// Borrower company page — one borrower end to end for quarterly monitoring.
// Landed on from Portfolio (heatmap / table) or the Data Room; never a
// sidebar item. Shows the quarterly package (expected vs received), covenant
// standing, the metric trend, and the borrower's documents.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { Building2, Plus, ArrowLeft, Tag, Unlink, Activity, FileText } from 'lucide-react';
import { api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { DerivationBadge, DocStatusBadge, EmptyState, ErrorBanner, Field, LoadingBlock, Modal } from '../../../../components/ui';

interface PackageCell {
  itemId: string; status: 'RECEIVED' | 'MISSING';
  documentId: string | null; documentName: string | null; receivedAt: string | null;
}
interface PackageItem { id: string; label: string; keywords: string; required: boolean }
interface BorrowerData {
  entity: { id: string; name: string; createdAt: string };
  package: {
    items: PackageItem[];
    quarters: { period: string; cells: PackageCell[] }[];
  };
  covenants: { total: number; passes: number; fails: number; nearBreaches: number; pendingReview: number; latestPeriod: string | null };
  trend: {
    metrics: { metricKey: string; label: string; unit: string; points: { period: string; value: number; derivation: string }[]; deltaPct: number | null; deltaNote: string | null }[];
  } | null;
  documents: { id: string; name: string; fileType: string; status: string; source: string; uploadedAt: string; pageCount: number | null }[];
}
interface WsDoc { id: string; name: string; status: string }

export default function BorrowerPage() {
  const params = useParams();
  const entityId = typeof params.entityId === 'string' ? params.entityId : '';
  const { workspace, can } = useWorkspace();
  const wid = workspace?.workspace.id;
  const editable = can('EDITOR');

  const [tagOpen, setTagOpen] = useState(false);
  const [tagDocId, setTagDocId] = useState('');
  const [itemOpen, setItemOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [keywords, setKeywords] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, mutate: refetch } = useSWR(
    wid && entityId ? `bor-${wid}-${entityId}` : null,
    () => api<BorrowerData>(`/api/${wid}/borrowers/${entityId}`),
  );

  // Same key the nav prefetch and Assistant use — the completed-docs list is
  // already warm for most sessions.
  const { data: wsDocs } = useSWR(
    wid ? `docs-${wid}` : null,
    () => api<{ documents: WsDoc[] }>(`/api/workspaces/${wid}/documents?status=COMPLETED&take=200`),
  );

  const taggable = useMemo(
    () => (wsDocs?.documents ?? []).filter((d) => !(data?.documents ?? []).some((m) => m.id === d.id)),
    [wsDocs, data],
  );

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); refetch(); } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally { setBusy(false); }
  }

  const quarters = data?.package.quarters ?? [];

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <Link href="/portfolio" className="btn btn-ghost btn-sm" style={{ marginBottom: 8, padding: '0 4px' }}>
            <ArrowLeft size={13} /> Portfolio
          </Link>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Building2 size={20} color="var(--text-muted)" /> {data?.entity.name ?? 'Borrower'}
          </div>
          <div className="page-desc">Quarterly monitoring — package, covenants, trend, and documents.</div>
        </div>
        {editable ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => { setTagDocId(''); setTagOpen(true); }}><Tag size={14} /> Tag document</button>
            <button className="btn btn-primary" onClick={() => { setLabel(''); setKeywords(''); setItemOpen(true); }}><Plus size={15} /> Add package item</button>
          </div>
        ) : null}
      </div>

      <ErrorBanner message={error} />

      {!data || isLoading ? (
        <LoadingBlock label="Loading borrower…" />
      ) : (
        <>
          {/* Covenant standing */}
          <div className="grid-kpi" style={{ marginBottom: 16 }}>
            <div className="card" style={{ padding: '16px 20px' }}>
              <div className="kpi-value" style={{ color: data.covenants.passes > 0 ? 'var(--success)' : undefined }}>{data.covenants.passes}</div>
              <div className="kpi-label">Passing{data.covenants.latestPeriod ? ` · ${data.covenants.latestPeriod}` : ''}</div>
            </div>
            <div className="card" style={{ padding: '16px 20px' }}>
              <div className="kpi-value" style={{ color: data.covenants.fails > 0 ? 'var(--error)' : undefined }}>{data.covenants.fails}</div>
              <div className="kpi-label">Breached</div>
            </div>
            <div className="card" style={{ padding: '16px 20px' }}>
              <div className="kpi-value" style={{ color: data.covenants.nearBreaches > 0 ? '#9a6700' : undefined }}>{data.covenants.nearBreaches}</div>
              <div className="kpi-label">Near breach</div>
            </div>
            <div className="card" style={{ padding: '16px 20px', cursor: 'default' }}>
              <div className="kpi-value">{data.covenants.total}</div>
              <div className="kpi-label">Covenants tracked</div>
            </div>
          </div>

          {/* Quarterly package — expected vs received */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title">Quarterly package</div>
              <span className="card-sub">expected vs received · matched by name on documents tagged to this borrower</span>
            </div>
            {data.package.items.length === 0 ? (
              <div style={{ padding: 20 }}><EmptyState
                icon={<FileText size={20} />}
                title="No package items"
                sub="Add the document kinds that should arrive each quarter — received items are matched by name on tagged documents."
              /></div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      {quarters.map((q) => <th key={q.period} style={{ textAlign: 'center' }}>{q.period}</th>)}
                      {editable ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.package.items.map((item) => (
                      <tr key={item.id}>
                        <td className="strong" style={{ whiteSpace: 'nowrap' }}>
                          {item.label}
                          {!item.required ? <span className="badge badge-neutral" style={{ marginLeft: 8 }}>optional</span> : null}
                        </td>
                        {quarters.map((q) => {
                          const cell = q.cells.find((c) => c.itemId === item.id);
                          if (!cell) return <td key={q.period} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>—</td>;
                          return cell.status === 'RECEIVED' ? (
                            <td key={q.period} style={{ textAlign: 'center' }}>
                              <Link href={`/documents/${cell.documentId}`} title={`${cell.documentName} · received ${new Date(cell.receivedAt ?? '').toLocaleDateString()}`}
                                className="badge badge-success" style={{ textDecoration: 'none' }}>✓ Received</Link>
                            </td>
                          ) : (
                            <td key={q.period} style={{ textAlign: 'center' }}>
                              <span className="badge" style={item.required ? { background: 'var(--warning-bg)', color: 'var(--warning)' } : { background: 'var(--sunken)', color: 'var(--text-muted)' }}>
                                {item.required ? 'Missing' : '—'}
                              </span>
                            </td>
                          );
                        })}
                        {editable ? (
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn-ghost btn-sm" title="Remove item" disabled={busy}
                              onClick={() => run(() => api(`/api/${wid}/borrowers/package/${item.id}`, { method: 'DELETE' }))}>
                              <Unlink size={13} />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Trend — compact metric table; charts live in Analytics */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title"><Activity size={13} style={{ verticalAlign: -2, marginRight: 6 }} />Metric trend</div>
              <Link href="/analytics" className="btn btn-ghost btn-sm">Open Analytics</Link>
            </div>
            {!data.trend || data.trend.metrics.length === 0 ? (
              <div style={{ padding: '20px 20px 24px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                No metric observations yet — confirm figures in Extraction &amp; Review or add them in Analytics.
              </div>
            ) : (
              <table className="table">
                <thead><tr><th>Metric</th><th>Latest</th><th>Δ prior-year</th><th>Derivation</th></tr></thead>
                <tbody>
                  {data.trend.metrics.map((m) => {
                    const latest = m.points[m.points.length - 1];
                    return (
                      <tr key={m.metricKey}>
                        <td className="strong">{m.label}</td>
                        <td className="mono" style={{ fontSize: 12.5 }}>{latest ? `${latest.value} ${m.unit}` : '—'}{latest ? <span style={{ color: 'var(--text-muted)' }}> · {latest.period}</span> : null}</td>
                        <td style={{ fontSize: 12.5, color: m.deltaPct == null ? 'var(--text-muted)' : m.deltaPct >= 0 ? 'var(--success)' : 'var(--error)' }}>
                          {m.deltaPct == null ? '—' : `${m.deltaPct >= 0 ? '+' : ''}${m.deltaPct.toFixed(1)}%`}
                        </td>
                        <td>{latest ? <DerivationBadge d={latest.derivation} /> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Documents tagged to this borrower */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Documents</div>
              <span className="card-sub">tagged from the Data Room{data.documents.length ? ` · ${data.documents.length}` : ''}</span>
            </div>
            {data.documents.length === 0 ? (
              <div style={{ padding: 20 }}><EmptyState
                icon={<Tag size={20} />}
                title="No documents tagged yet"
                sub="Tag Data Room documents to this borrower (button above) — tagged documents feed the quarterly package checks."
              /></div>
            ) : (
              <table className="table">
                <thead><tr><th>Document</th><th>Status</th><th>Source</th><th>Added</th>{editable ? <th /> : null}</tr></thead>
                <tbody>
                  {data.documents.map((d) => (
                    <tr key={d.id}>
                      <td className="strong"><Link href={`/documents/${d.id}`} style={{ color: 'var(--text-primary)' }}>{d.name}</Link></td>
                      <td><DocStatusBadge status={d.status} /></td>
                      <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{d.source === 'EMAIL' ? 'Email' : 'Upload'}</td>
                      <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{new Date(d.uploadedAt).toLocaleDateString()}</td>
                      {editable ? (
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-ghost btn-sm" title="Untag from borrower" disabled={busy}
                            onClick={() => run(() => api(`/api/${wid}/borrowers/tag-document`, { method: 'POST', body: { documentId: d.id, entityId: null } }))}>
                            <Unlink size={13} />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Tag document */}
      <Modal open={tagOpen} onClose={() => setTagOpen(false)} title="Tag a document to this borrower">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Data Room document" hint="Only completed documents are listed. Tagging feeds the quarterly package checks.">
            <select className="select" value={tagDocId} onChange={(e) => setTagDocId(e.target.value)}>
              <option value="">Choose a document…</option>
              {taggable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setTagOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !tagDocId}
              onClick={() => run(async () => {
                await api(`/api/${wid}/borrowers/tag-document`, { method: 'POST', body: { documentId: tagDocId, entityId } });
                setTagOpen(false);
              })}>Tag document</button>
          </div>
        </div>
      </Modal>

      {/* Add package item */}
      <Modal open={itemOpen} onClose={() => setItemOpen(false)} title="Add package item">
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          await api(`/api/${wid}/borrowers/${entityId}/package`, { method: 'POST', body: { label, keywords } });
          setItemOpen(false);
        }); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Item name">
            <input className="input" required autoFocus maxLength={120} value={label} placeholder="e.g. Insurance certificate"
              onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Match keywords" hint="Comma-separated. A tagged document whose name contains any keyword counts as received.">
            <input className="input" required maxLength={500} value={keywords} placeholder="insurance policy,certificate of insurance"
              onChange={(e) => setKeywords(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setItemOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>Add item</button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
