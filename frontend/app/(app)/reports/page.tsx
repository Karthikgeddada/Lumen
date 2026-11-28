'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { FileBarChart, Building2, Printer, Download, FileText, Scale, ClipboardCheck } from 'lucide-react';
import { api, qs } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import { DerivationBadge, EmptyState, ErrorBanner, LoadingBlock } from '../../../components/ui';

// Reports: quarterly covenant report per company — package status, covenant
// results per period, and every underlying figure with its sources and flags.
// Downloadable as XLSX, printable as PDF, plus the audit-log export.

interface Entity { id: string; name: string }
interface Report {
  entity: { id: string; name: string; parentId: string | null };
  periods: string[]; // newest first
  generatedAt: string;
  package: {
    items: { id: string; label: string; required: boolean }[];
    quarters: { period: string; cells: { itemId: string; status: string; documentName: string | null }[] }[];
  };
  covenants: {
    id: string; label: string; comparator: 'LTE' | 'GTE'; threshold: number; unit: string;
    nearBreachPct: number | null;
    results: { period: string; status: string; value: number | null; headroom: number | null; previousStatus: string | null; reason: string | null }[];
  }[];
  figures: {
    metricKey: string; label: string; period: string; value: number; unit: string;
    derivation: string; confidence: number | null;
    sourceDocumentId: string | null; sourcePage: number | null; sourceExcerpt: string | null;
    scaleUnresolved: boolean;
  }[];
}

const STATUS_COLOR: Record<string, string> = {
  PASS: 'rgba(46,160,67,.15)',
  FAIL: 'rgba(220,38,38,.12)',
  NOT_TESTED: 'var(--sunken)',
  WAIVED: 'rgba(28,79,216,.12)',
};
const STATUS_TEXT: Record<string, string> = {
  PASS: '#2ea043',
  FAIL: '#dc2626',
  NOT_TESTED: 'var(--text-muted)',
  WAIVED: '#0a67d6',
};

function StatusCell({ status, title }: { status: string; title?: string }) {
  return (
    <span title={title} style={{
      display: 'inline-block', minWidth: 58, textAlign: 'center', fontSize: 11.5, fontWeight: 600,
      padding: '3px 8px', borderRadius: 6,
      background: STATUS_COLOR[status] ?? 'var(--sunken)', color: STATUS_TEXT[status] ?? 'inherit',
    }}>
      {status === 'PASS' ? 'Pass' : status === 'FAIL' ? 'Breach' : status === 'WAIVED' ? 'Waived' : status === 'NOT_TESTED' ? 'Not tested' : status}
    </span>
  );
}

const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

// Authorized download via the API client (Bearer header), saved as a blob.
async function downloadFile(path: string, filename: string) {
  try {
    const blob = await api<Blob>(path);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    window.alert(err instanceof Error ? err.message : 'Download failed.');
  }
}

function kpiDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400e3);
  return d.toISOString().slice(0, 10);
}

export default function Reports() {
  const { workspace, can } = useWorkspace();
  const wid = workspace?.workspace.id;
  const [entityId, setEntityId] = useState<string | null>(null);
  const [quarters, setQuarters] = useState(4);
  const [auditFrom, setAuditFrom] = useState(kpiDaysAgo(90));
  const [auditTo, setAuditTo] = useState(kpiDaysAgo(0));

  const { data: entData } = useSWR(wid ? `rep-ents-${wid}` : null,
    () => api<{ entities: Entity[] }>(`/api/${wid}/analytics/entities`));
  const effectiveEntity = entityId ?? entData?.entities?.[0]?.id ?? null;

  const reportKey = wid && effectiveEntity ? `cov-report-${effectiveEntity}-${quarters}` : null;
  const { data: repData, isLoading, error } = useSWR(
    reportKey,
    () => api<{ report: Report }>(`/api/workspaces/${wid}/reports/covenant${qs({ entityId: effectiveEntity, quarters })}`),
  );
  const report = repData?.report;

  const latest = report?.periods[0] ?? '';
  const latestResults = report?.covenants.map((c) => c.results.find((r) => r.period === latest) ?? c.results[0] ?? null) ?? [];
  const passes = latestResults.filter((r) => r?.status === 'PASS').length;
  const fails = latestResults.filter((r) => r?.status === 'FAIL').length;
  const latestQuarter = report?.package.quarters.find((q) => q.period === latest);
  const received = latestQuarter?.cells.filter((c) => c.status === 'RECEIVED').length ?? 0;
  const expected = latestQuarter?.cells.length ?? 0;
  const flaggedFigures = report?.figures.filter((f) => f.scaleUnresolved).length ?? 0;

  return (
    <main className="content">
      {/* Print styles: the report below is the whole page when printing/saving PDF. */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          .sidebar, .topbar, .no-print { display: none !important; }
          .shell { display: block !important; }
          .content { padding: 0 !important; max-width: none !important; }
          .card { box-shadow: none !important; border: 1px solid #ccc; break-inside: avoid; }
        }
      `}} />

      <div className="page-head no-print">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-desc">Quarterly covenant reports with sources and flags — XLSX download, print to PDF, plus the audit export.</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="tabs">
            <button className={`tab ${quarters === 4 ? 'active' : ''}`} onClick={() => setQuarters(4)}>4Q</button>
            <button className={`tab ${quarters === 8 ? 'active' : ''}`} onClick={() => setQuarters(8)}>8Q</button>
          </div>
          <button className="btn btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print / PDF</button>
          <button
            className="btn btn-primary"
            disabled={!effectiveEntity || !report}
            onClick={() => downloadFile(`/api/workspaces/${wid}/reports/covenant.xlsx${qs({ entityId: effectiveEntity, quarters })}`, `${report?.entity.name ?? 'company'}-covenant-report-${latest.replace(/\s/g, '')}.xlsx`)}
          >
            <Download size={15} /> XLSX
          </button>
        </div>
      </div>

      <ErrorBanner message={error ? 'Could not load the report.' : null} />

      {/* Company selector */}
      {(entData?.entities?.length ?? 0) > 0 ? (
        <div className="card no-print" style={{ padding: '10px 12px', marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {entData!.entities.map((e) => (
            <button key={e.id} className={`btn btn-sm ${effectiveEntity === e.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setEntityId(e.id)}>
              <Building2 size={13} /> {e.name}
            </button>
          ))}
        </div>
      ) : null}

      {isLoading ? <LoadingBlock label="Assembling report…" /> : null}

      {!isLoading && (entData?.entities?.length ?? 0) === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FileBarChart size={20} />}
            title="No companies yet"
            sub="Create a company and upload its documents — the quarterly covenant report is generated from what Lumen has stored."
          />
        </div>
      ) : null}

      {report ? (
        <div className="report-body">
          {/* Report header — visible in print */}
          <div className="card" style={{ padding: '18px 20px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 18, fontWeight: 700 }}>Quarterly covenant report</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>{report.entity.name}</span>
              <span className="badge badge-blue">{latest}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Window {report.periods[report.periods.length - 1]} – {latest} · generated {new Date(report.generatedAt).toLocaleString()} · every figure carries its source and derivation.
            </div>
          </div>

          {/* KPIs */}
          <div className="grid-kpi" style={{ marginBottom: 16 }}>
            <div className="card" style={{ padding: '14px 18px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}><Scale size={13} /> Covenants pass / breach ({latest})</div>
              <div style={{ fontSize: 24, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ color: passes > 0 || report.covenants.length === 0 ? 'inherit' : 'var(--text-muted)' }}>{passes}</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>/</span>
                <span style={{ color: fails > 0 ? '#dc2626' : 'var(--text-muted)' }}>{fails}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>of {report.covenants.length}</span>
              </div>
            </div>
            <div className="card" style={{ padding: '14px 18px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}><ClipboardCheck size={13} /> Quarterly package ({latest})</div>
              <div style={{ fontSize: 24, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ color: received >= expected && expected > 0 ? '#2ea043' : expected === 0 ? 'inherit' : '#b47800' }}>{received}</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>of {expected} expected</span>
              </div>
            </div>
            <div className="card" style={{ padding: '14px 18px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={13} /> Figures in window</div>
              <div style={{ fontSize: 24, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                {report.figures.length}
                {flaggedFigures > 0 ? <span style={{ fontSize: 12, fontWeight: 600, color: '#dc2626' }}>{flaggedFigures} unresolved scale</span> : null}
              </div>
            </div>
          </div>

          {/* Covenant results by period */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><div className="card-title">Covenant results</div></div>
            {report.covenants.length === 0 ? (
              <div style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text-muted)' }}>No covenants defined for this company yet.</div>
            ) : (
              <table className="table">
                <thead><tr><th>Covenant</th>{report.periods.map((p) => <th key={p} style={{ textAlign: 'center' }}>{p}</th>)}</tr></thead>
                <tbody>
                  {report.covenants.map((c) => (
                    <tr key={c.id}>
                      <td className="strong" style={{ whiteSpace: 'nowrap' }}>
                        {c.label}
                        <span className="mono" style={{ marginLeft: 7, fontSize: 11.5, color: 'var(--text-muted)' }}>{c.comparator === 'LTE' ? '≤' : '≥'}{c.threshold}{c.unit === 'x' ? 'x' : c.unit}</span>
                      </td>
                      {report.periods.map((p) => {
                        const r = c.results.find((x) => x.period === p);
                        return (
                          <td key={p} style={{ textAlign: 'center' }}>
                            {r ? (
                              <StatusCell
                                status={r.status}
                                title={r.value != null ? `${fmt(r.value)} ${c.unit}${r.headroom != null ? ` · headroom ${fmt(r.headroom)}` : ''}${r.reason ? ` · ${r.reason}` : ''}` : r.reason ?? undefined}
                              />
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Quarterly package grid */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><div className="card-title">Quarterly package</div><span className="card-sub">expected vs received</span></div>
            {report.package.items.length === 0 ? (
              <div style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text-muted)' }}>No package items defined for this company yet.</div>
            ) : (
              <table className="table">
                <thead><tr><th>Expected item</th>{report.periods.map((p) => <th key={p} style={{ textAlign: 'center' }}>{p}</th>)}</tr></thead>
                <tbody>
                  {report.package.items.map((item, i) => (
                    <tr key={item.id}>
                      <td className="strong">{item.label}{item.required ? '' : <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>(optional)</span>}</td>
                      {report.periods.map((p) => {
                        const q = report.package.quarters.find((x) => x.period === p);
                        const cell = q?.cells[i];
                        return (
                          <td key={p} style={{ textAlign: 'center' }}>
                            {cell?.status === 'RECEIVED' ? (
                              <span title={cell.documentName ?? undefined} style={{ color: '#2ea043', fontWeight: 700 }}>✓</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Figures with sources and flags */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><div className="card-title">Figures — sources and flags</div><span className="card-sub">every number in this report</span></div>
            {report.figures.length === 0 ? (
              <div style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text-muted)' }}>No stored figures in this window.</div>
            ) : (
              <table className="table">
                <thead><tr><th>Figure</th><th>Period</th><th>Value</th><th>Derivation</th><th>Confidence</th><th>Source</th></tr></thead>
                <tbody>
                  {report.figures.map((f) => (
                    <tr key={`${f.metricKey}-${f.period}`}>
                      <td className="strong">{f.label}</td>
                      <td>{f.period}</td>
                      <td><span className="mono">{fmt(f.value)}</span> <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{f.unit}</span></td>
                      <td><DerivationBadge d={f.derivation} /></td>
                      <td>{f.confidence != null ? `${Math.round(f.confidence * 100)}%` : '—'}</td>
                      <td style={{ minWidth: 200 }}>
                        {f.scaleUnresolved ? (
                          <span className="badge badge-error" style={{ marginRight: 6 }}>Unresolved scale</span>
                        ) : null}
                        {f.sourceDocumentId ? (
                          <Link href={`/documents/${f.sourceDocumentId}${f.sourcePage != null ? `?page=${f.sourcePage}` : ''}`} className="btn btn-ghost btn-sm" title={f.sourceExcerpt ?? 'Open the supporting document'}>
                            {f.sourcePage != null ? `p. ${f.sourcePage}` : 'document'}
                          </Link>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>no source document</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}

      {/* Audit export */}
      <div className="card no-print" style={{ marginTop: 20 }}>
        <div className="card-header">
          <div className="card-title">Audit export</div>
          <span className="card-sub">the workspace activity trail, default last 90 days</span>
        </div>
        <div style={{ padding: '14px 20px', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
            From
            <input className="input" type="date" value={auditFrom} onChange={(e) => setAuditFrom(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
            To
            <input className="input" type="date" value={auditTo} onChange={(e) => setAuditTo(e.target.value)} />
          </label>
          <button
            className="btn btn-secondary"
            disabled={!wid}
            onClick={() => downloadFile(`/api/workspaces/${wid}/reports/audit.xlsx${qs({ from: auditFrom, to: auditTo })}`, `audit-${auditFrom}-to-${auditTo}.xlsx`)}
          >
            <Download size={15} /> Download audit log
          </button>
        </div>
      </div>
    </main>
  );
}
