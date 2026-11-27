'use client';

import Link from 'next/link';
import useSWR from 'swr';
import {
  FileText, MessagesSquare, ClipboardCheck, Upload, ArrowRight,
  FileSpreadsheet, Users, Trash2, CheckCircle2, Sparkles, Scale, ShieldAlert, ShieldCheck, Building2,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import {
  DocStatusBadge, DemoTag, EmptyState, LoadingBlock, Avatar,
  formatDate, timeAgo, formatBytes,
} from '../../../components/ui';
import EChart, { CHART, type EChartOption } from '../../../components/EChart';

interface CovenantBoardItem {
  id: string; label: string; entityName: string;
  comparator: 'LTE' | 'GTE'; threshold: number; unit: string; needsReview: boolean;
  latest: { period: string; status: 'PASS' | 'FAIL' | 'NOT_TESTED' | 'WAIVED'; value: number | null; headroom: number | null; previousStatus: 'PASS' | 'FAIL' | 'NOT_TESTED' | 'WAIVED' | null } | null;
}
interface DashboardData {
  kpis: {
    documents: number; pagesUnderstood: number; extractions: number; openReviews: number;
    covenants: number; breaches: number; covenantPeriods: string[];
  };
  covenants: CovenantBoardItem[];
  portfolio: { entities: number; observations: number };
  recentDocuments: {
    id: string; name: string; fileType: string; status: string; pageCount: number | null;
    uploadedAt: string; isDemo: boolean;
    collection: { name: string } | null;
    owner: { firstName: string; lastName: string };
  }[];
  activeProcessing: { id: string; name: string; status: string; uploadedAt: string }[];
  recentActivity: {
    id: string; action: string; meta: Record<string, unknown> | null; createdAt: string;
    actor: { firstName: string; lastName: string } | null;
  }[];
  recentConversations: { id: string; title: string; updatedAt: string }[];
}

const ACTION_LABELS: Record<string, string> = {
  'workspace.created': 'created the workspace',
  'document.uploaded': 'uploaded a document',
  'document.deleted': 'deleted a document',
  'document.completed': 'finished processing',
  'invitation.sent': 'sent an invitation',
  'invitation.accepted': 'joined the workspace',
  'member.role_changed': 'changed a member role',
  'member.removed': 'removed a member',
  'extraction.run': 'started an extraction',
  'questionnaire.drafted': 'drafted a questionnaire',
  'extraction.verified': 'verified an extraction',
  'answer.approved': 'approved an answer',
};

// Covenant status at a glance: a donut over ALL covenants (the list below
// shows only the first six). Colors match the app's status semantics —
// green pass, red breach, gray untested — so the shape is readable before
// any label.
function CovenantDonut({ covenants }: { covenants: CovenantBoardItem[] }) {
  const counts: Record<string, number> = { PASS: 0, FAIL: 0, NOT_TESTED: 0, WAIVED: 0 };
  for (const c of covenants) if (c.latest?.status) counts[c.latest.status] += 1;
  const total = covenants.length;

  const option: EChartOption = {
    tooltip: {
      trigger: 'item',
      backgroundColor: CHART.surface,
      borderColor: CHART.hairline,
      textStyle: { color: '#1d1d1f', fontSize: 12 },
      formatter: (p: unknown) => {
        const { name, value, percent } = p as { name: string; value: number; percent: number };
        return `<b>${name}</b>: ${value} of ${total} (${percent}%)`;
      },
    },
    series: [{
      type: 'pie',
      radius: ['62%', '88%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: false,
      label: { show: false },
      labelLine: { show: false },
      data: [
        { name: 'Pass', value: counts.PASS, itemStyle: { color: CHART.success } },
        { name: 'Breach', value: counts.FAIL, itemStyle: { color: CHART.error } },
        { name: 'Not tested', value: counts.NOT_TESTED, itemStyle: { color: CHART.textMuted } },
        { name: 'Waived', value: counts.WAIVED, itemStyle: { color: CHART.blueLight } },
      ].filter((d) => d.value > 0),
    }],
  };

  const legend = [
    { label: 'Pass', n: counts.PASS, color: CHART.success },
    { label: 'Breach', n: counts.FAIL, color: CHART.error },
    { label: 'Not tested', n: counts.NOT_TESTED, color: CHART.textMuted },
    { label: 'Waived', n: counts.WAIVED, color: CHART.blueLight },
  ].filter((l) => l.n > 0);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px 10px 20px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 118, flexShrink: 0 }}>
        <EChart option={option} height={112} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{total} covenants tracked</span>
        {legend.map((l) => (
          <span key={l.label} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color, flexShrink: 0 }} />
            {l.label} <b className="mono">{l.n}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { workspace } = useWorkspace();
  const wid = workspace?.workspace.id;

  const { data, isLoading, error } = useSWR(
    wid ? `/api/workspaces/${wid}/dashboard` : null,
    () => api<{ dashboard: DashboardData }>(`/api/workspaces/${wid}/dashboard`),
    { refreshInterval: 15000 },
  );
  const d = data?.dashboard;

  if (!wid) {
    return (
      <main className="content">
        <EmptyState
          icon={<Users size={20} />}
          title="No workspace yet"
          sub="Create your first workspace to start uploading documents."
          action={<Link className="btn btn-primary" href="/onboarding?create=1">Create workspace</Link>}
        />
      </main>
    );
  }

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Good day.</div>
          <div className="page-desc">{workspace.workspace.name} · {workspace.role}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/library?upload=1" className="btn btn-primary"><Upload size={15} /> Upload documents</Link>
        </div>
      </div>

      {isLoading ? <LoadingBlock /> : null}
      {error ? (
        <div className="badge badge-error">Could not load the dashboard — the API may be unreachable.</div>
      ) : null}

      {d ? (
        <>
          {/* KPIs */}
          <div className="grid-kpi" style={{ marginBottom: 16 }}>
            <Kpi label="Covenants tracked" value={d.kpis.covenants.toLocaleString()} icon={<Scale size={16} />}
              accent={d.kpis.breaches > 0 ? 'var(--error)' : undefined} />
            <Kpi label="Breached (latest tests)" value={d.kpis.breaches.toLocaleString()} icon={<ShieldAlert size={16} />}
              accent={d.kpis.breaches > 0 ? 'var(--error)' : 'var(--success, #1d9a4b)'} />
            <Kpi label="Open reviews" value={d.kpis.openReviews.toLocaleString()} icon={<ClipboardCheck size={16} />} />
            <Kpi label="Pages understood" value={d.kpis.pagesUnderstood.toLocaleString()} icon={<FileText size={16} />} />
          </div>

          <div className="grid-2" style={{ gridTemplateColumns: '1.55fr 1fr' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Covenant status board */}
              {d.covenants.length > 0 ? (
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">Covenant status</div>
                    <Link href="/covenants" className="btn btn-ghost btn-sm">All covenants <ArrowRight size={13} /></Link>
                  </div>
                  <CovenantDonut covenants={d.covenants} />
                  {d.covenants.slice(0, 6).map((c) => (
                    <Link key={c.id} href="/covenants" style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px',
                      borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit',
                    }}>
                      {c.latest?.status === 'FAIL'
                        ? <ShieldAlert size={15} color="var(--error)" style={{ flexShrink: 0 }} />
                        : c.latest?.status === 'PASS'
                          ? <ShieldCheck size={15} color="var(--success, #1d9a4b)" style={{ flexShrink: 0 }} />
                          : <Scale size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 560, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          {c.label}
                          {c.needsReview ? <span className="badge badge-blue">review</span> : null}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                          <Building2 size={10} /> {c.entityName}
                        </div>
                      </div>
                      {c.latest ? (
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div className="mono" style={{ fontSize: 13, fontWeight: 640, color: c.latest.status === 'FAIL' ? 'var(--error)' : 'inherit' }}>
                            {c.latest.value ?? '—'} vs {c.comparator === 'LTE' ? '≤' : '≥'}{c.threshold}{c.unit}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {c.latest.period}{c.latest.headroom != null
                              ? ` · ${c.latest.headroom >= 0 ? '+' : ''}${Math.abs(c.latest.headroom) < 10 ? c.latest.headroom.toFixed(2) : `${(c.latest.headroom / 1_000_000).toFixed(1)}M`}${c.unit} headroom`
                              : ''}
                            {c.latest.status === 'NOT_TESTED' && c.latest.previousStatus && c.latest.previousStatus !== 'NOT_TESTED'
                              ? ` · was ${c.latest.previousStatus.toLowerCase()}` : ''}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>not tested</span>
                      )}
                    </Link>
                  ))}
                  {d.portfolio.entities > 0 ? (
                    <div style={{ padding: '9px 20px', fontSize: 11.5, color: 'var(--text-muted)', background: 'var(--sunken)' }}>
                      {d.portfolio.entities} portfolio {d.portfolio.entities === 1 ? 'company' : 'companies'} · {d.portfolio.observations} quarterly metrics tracked
                    </div>
                  ) : null}
                </div>
              ) : null}
              {/* Processing now */}
              {d.activeProcessing.length > 0 ? (
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">Processing now</div>
                    <span className="card-sub">live · updates every 15s</span>
                  </div>
                  {d.activeProcessing.map((doc) => (
                    <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
                      <div className="spinner" style={{ width: 14, height: 14 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 560, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeAgo(doc.uploadedAt)}</div>
                      </div>
                      <DocStatusBadge status={doc.status} />
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Recent documents */}
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Recent documents</div>
                  <Link href="/library" className="btn btn-ghost btn-sm">View all <ArrowRight size={13} /></Link>
                </div>
                {d.recentDocuments.length === 0 ? (
                  <EmptyState
                    icon={<FileText size={20} />}
                    title="No documents yet"
                    sub="Upload a PDF, Word file, or spreadsheet and Lumen will extract its structure, tables, and key facts."
                    action={<Link href="/library?upload=1" className="btn btn-primary btn-sm"><Upload size={14} /> Upload your first document</Link>}
                  />
                ) : (
                  <table className="table">
                    <thead>
                      <tr><th>Document</th><th>Collection</th><th>Owner</th><th>Status</th><th>Uploaded</th></tr>
                    </thead>
                    <tbody>
                      {d.recentDocuments.map((doc) => (
                        <tr key={doc.id}>
                          <td className="strong">
                            <Link href={`/documents/${doc.id}`} style={{ color: 'inherit' }}>{doc.name}</Link>
                            {doc.isDemo ? <span style={{ marginLeft: 7 }}><DemoTag /></span> : null}
                          </td>
                          <td>{doc.collection?.name ?? '—'}</td>
                          <td style={{ color: 'var(--text-muted)' }}>
                            {doc.owner ? `${doc.owner.firstName} ${doc.owner.lastName}`.trim() : '—'}
                          </td>
                          <td><DocStatusBadge status={doc.status} /></td>
                          <td className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatDate(doc.uploadedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Recent conversations */}
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Recent conversations</div>
                  <Link href="/assistant" className="btn btn-ghost btn-sm">Open assistant <ArrowRight size={13} /></Link>
                </div>
                {d.recentConversations.length === 0 ? (
                  <EmptyState
                    icon={<MessagesSquare size={20} />}
                    title="Ask your first question"
                    sub="The assistant answers from your documents with page-level citations."
                    action={<Link href="/assistant" className="btn btn-primary btn-sm"><Sparkles size={14} /> Open AI Assistant</Link>}
                  />
                ) : (
                  d.recentConversations.map((c) => (
                    <Link key={c.id} href={`/assistant?c=${c.id}`} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
                      borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit',
                    }}>
                      <MessagesSquare size={15} color="var(--text-muted)" />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 540 }}>{c.title}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeAgo(c.updatedAt)}</span>
                    </Link>
                  ))
                )}
              </div>
            </div>

            {/* Right column: activity */}
            <div className="card" style={{ height: 'fit-content' }}>
              <div className="card-header">
                <div className="card-title">Workspace activity</div>
              </div>
              {d.recentActivity.length === 0 ? (
                <div style={{ padding: '30px 20px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                  Activity will appear here as your team works.
                </div>
              ) : (
                d.recentActivity.map((ev) => (
                  <div key={ev.id} style={{ display: 'flex', gap: 10, padding: '11px 20px', borderBottom: '1px solid var(--border)' }}>
                    <ActionIcon action={ev.action} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.8, lineHeight: 1.45 }}>
                        <strong style={{ fontWeight: 590 }}>
                          {ev.actor ? `${ev.actor.firstName} ${ev.actor.lastName}`.trim() : 'Someone'}
                        </strong>{' '}
                        {ACTION_LABELS[ev.action] ?? ev.action.replace(/[._]/g, ' ')}
                        {ev.action === 'document.uploaded' && ev.meta?.name ? (
                          <span style={{ color: 'var(--text-muted)' }}> — {String(ev.meta.name)}</span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{timeAgo(ev.createdAt)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}

function Kpi({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: accent }}>
        <span style={{ color: accent ?? 'var(--text-muted)' }}>{icon}</span>
      </div>
      <div className="kpi-value" style={{ marginTop: 10, color: accent }}>{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function ActionIcon({ action }: { action: string }) {
  if (action.startsWith('document')) return action === 'document.deleted' ? <Trash2 size={14} color="var(--text-muted)" /> : <FileText size={14} color="var(--text-muted)" />;
  if (action.startsWith('extraction')) return <CheckCircle2 size={14} color="var(--success)" />;
  if (action.startsWith('invitation') || action.startsWith('member')) return <Users size={14} color="var(--text-muted)" />;
  return <ClipboardCheck size={14} color="var(--text-muted)" />;
}
