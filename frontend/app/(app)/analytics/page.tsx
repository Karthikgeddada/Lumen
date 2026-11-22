'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { LineChart, Building2, Plus, Trash2, CalendarClock } from 'lucide-react';
import { api } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import { DerivationBadge, EmptyState, Field, LoadingBlock, Modal, timeAgo } from '../../../components/ui';

interface Entity { id: string; name: string; _count: { observations: number; reports: number } }
interface Report { id: string; title: string; type: string; schedule: string | null; createdAt: string; lastRunAt: string | null }
interface Overview {
  metrics: {
    key: string; label: string; unit: string;
    series: { period: string; value: number; derivation: string; sourceExcerpt: string | null; sourcePage: number | null }[];
    delta?: { pct: number; from: number; to: number } | null;
    latest?: { period: string; value: number; derivation: string } | null;
  }[];
  quarters: string[];
}

export default function Analytics() {
  const { workspace, can } = useWorkspace();
  const wid = workspace?.workspace.id;
  const [entityId, setEntityId] = useState<string | null>(null);
  const [quarters, setQuarters] = useState(4);
  const [reportOpen, setReportOpen] = useState(false);

  const { data: entData } = useSWR(wid ? `ent-${wid}` : null,
    () => api<{ entities: Entity[] }>(`/api/workspaces/${wid}/analytics/entities`));

  const effectiveEntity = entityId ?? entData?.entities?.[0]?.id ?? null;

  const { data: overview, isLoading } = useSWR(
    effectiveEntity ? `ov-${effectiveEntity}-${quarters}` : null,
    () => api<{ overview: Overview }>(`/api/workspaces/${wid}/analytics/overview${`?entityId=${effectiveEntity}&quarters=${quarters}`}`),
  );

  const { data: repData, mutate: refetchReports } = useSWR(wid ? `rep-${wid}` : null,
    () => api<{ reports: Report[] }>(`/api/workspaces/${wid}/analytics/reports`));

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Analytics</div>
          <div className="page-desc">Quarterly metrics per entity — reported values, calculated figures, and AI-inferred data, each labeled honestly.</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="tabs">
            <button className={`tab ${quarters === 4 ? 'active' : ''}`} onClick={() => setQuarters(4)}>4Q</button>
            <button className={`tab ${quarters === 8 ? 'active' : ''}`} onClick={() => setQuarters(8)}>8Q</button>
          </div>
          {can('EDITOR') ? <button className="btn btn-primary" onClick={() => setReportOpen(true)}><Plus size={15} /> New report</button> : null}
        </div>
      </div>

      {/* Entity selector */}
      {entData?.entities?.length ? (
        <div className="card" style={{ padding: '10px 12px', marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {entData.entities.map((e) => (
            <button key={e.id} className={`btn btn-sm ${effectiveEntity === e.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setEntityId(e.id)}>
              <Building2 size={13} /> {e.name}
            </button>
          ))}
        </div>
      ) : null}

      {!entData || entData.entities.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<LineChart size={20} />}
            title="No entities yet"
            sub="Entities are companies, funds, or plants you track. Create one, then add reported metrics or feed them from verified extractions."
          />
        </div>
      ) : isLoading || !overview ? (
        <LoadingBlock label="Loading metrics…" />
      ) : (
        <div className="grid-2">
          {overview.overview.metrics.map((m) => (
            <MetricCard key={m.key} metric={m} quarters={overview.overview.quarters} />
          ))}
          {overview.overview.metrics.length === 0 ? (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <EmptyState icon={<LineChart size={20} />} title="No observations yet"
                sub="Add reported figures or run an extraction and send its verified values to analytics." />
            </div>
          ) : null}
        </div>
      )}

      {/* Reports */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-title">Reports</div>
          <span className="card-sub">on-demand and scheduled</span>
        </div>
        {!repData || repData.reports.length === 0 ? (
          <div style={{ padding: '24px 20px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
            No reports yet. Create one to snapshot an entity's metrics on demand or on a schedule.
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>Report</th><th>Type</th><th>Schedule</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {repData.reports.map((r) => (
                <tr key={r.id}>
                  <td className="strong">{r.title}</td>
                  <td>{r.type}</td>
                  <td>{r.schedule ? <span className="badge badge-blue"><CalendarClock size={11} /> {r.schedule}</span> : <span style={{ color: 'var(--text-muted)' }}>On demand</span>}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{timeAgo(r.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {can('EDITOR') ? (
                      <button className="btn btn-ghost btn-sm" onClick={async () => {
                        await api(`/api/analytics/reports/${r.id}`, { method: 'DELETE' }); refetchReports();
                      }}><Trash2 size={13} /></button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New report modal */}
      <NewReport open={reportOpen} onClose={() => setReportOpen(false)}
        workspaceId={wid} entityId={effectiveEntity} entities={entData?.entities ?? []}
        onCreated={() => { setReportOpen(false); refetchReports(); }} />
    </main>
  );
}

function MetricCard({ metric, quarters }: { metric: Overview['metrics'][number]; quarters: string[] }) {
  const series = metric.series;
  const max = Math.max(...series.map((s) => Math.abs(s.value)), 0.0001);
  const min = Math.min(...series.map((s) => s.value), 0);
  const range = max - min || 1;
  const latest = series[series.length - 1];
  const prev = series[series.length - 2];
  const delta = latest && prev && prev.value !== 0 ? ((latest.value - prev.value) / Math.abs(prev.value)) * 100 : null;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">{metric.label}</div>
          <div className="card-sub mono">{metric.unit}</div>
        </div>
        {delta != null ? (
          <span className={`badge ${delta >= 0 ? 'badge-success' : 'badge-error'}`}>
            {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% QoQ
          </span>
        ) : null}
      </div>
      <div style={{ padding: '16px 20px 18px' }}>
        {/* Minimal bar chart, CSS only */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 110 }}>
          {series.map((s) => (
            <div key={s.period} style={{ flex: 1, textAlign: 'center' }} title={`${s.period}: ${s.value} ${metric.unit} (${s.derivation})`}>
              <div style={{
                height: `${Math.max(((s.value - min) / range) * 90, 6)}px`,
                background: s === latest ? 'var(--blue)' : 'var(--blue-light)',
                borderRadius: '4px 4px 2px 2px',
                opacity: s.derivation === 'AI_INFERRED' ? 0.55 : 1,
                transition: 'height 0.3s var(--ease)',
              }} />
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6, whiteSpace: 'nowrap' }}>{s.period}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {latest ? (
            <>
              <span className="mono" style={{ fontSize: 15, fontWeight: 640 }}>{latest.value}</span>
              <DerivationBadge d={latest.derivation} />
            </>
          ) : null}
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{quarters.length}-quarter view</span>
        </div>
      </div>
    </div>
  );
}

function NewReport({ open, onClose, workspaceId, entityId, entities, onCreated }: {
  open: boolean; onClose: () => void; workspaceId?: string; entityId?: string | null;
  entities: Entity[]; onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [ent, setEnt] = useState(entityId ?? entities[0]?.id ?? '');
  const [schedule, setSchedule] = useState('none');
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/workspaces/${workspaceId}/analytics/reports`, {
        method: 'POST', body: { title, entityId: ent, schedule },
      });
      setTitle(''); onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New report">
      <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Title">
          <input className="input" required maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. “Halden — Quarterly review”" autoFocus />
        </Field>
        <Field label="Entity">
          <select className="select" value={ent} onChange={(e) => setEnt(e.target.value)}>
            {entities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Schedule" hint="Scheduled reports re-run automatically in the background worker.">
          <select className="select" value={schedule} onChange={(e) => setSchedule(e.target.value)}>
            <option value="none">On demand</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} type="submit">Create report</button>
        </div>
      </form>
    </Modal>
  );
}
