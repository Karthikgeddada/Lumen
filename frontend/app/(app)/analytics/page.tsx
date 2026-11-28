'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { LineChart, Building2, Plus, Trash2, CalendarClock, Lightbulb, Bookmark } from 'lucide-react';
import { api, qs } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import { DerivationBadge, EmptyState, Field, LoadingBlock, Modal, timeAgo } from '../../../components/ui';
import EChart, { baseAxis, CHART, type EChartOption } from '../../../components/EChart';

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

// ── Explore tab (spec's "later" item, now built) ──
interface ExploreSeries {
  entityId: string; entityName: string; metricKey: string; label: string; unit: string;
  points: { period: string; value: number; derivation: string; confidence: number | null }[];
}
interface ExploreData {
  series: ExploreSeries[];
  periods: string[];
  recommendation: { type: 'LINE' | 'BAR' | 'INDEX' | 'NONE'; why: string };
  metrics: { key: string; label: string; unit: string }[];
}
interface SavedView {
  id: string; title: string;
  spec: { entityIds: string[]; metricKeys: string[]; quarters: number };
  createdAt: string;
}

const SERIES_COLORS = ['#0071e3', '#0e9c8a', '#8b5cf6', '#d97706', '#e05780', '#5a6acf', '#64748b'];

export default function Analytics() {
  const { workspace, can } = useWorkspace();
  const wid = workspace?.workspace.id;
  const [entityId, setEntityId] = useState<string | null>(null);
  const [quarters, setQuarters] = useState(4);
  const [reportOpen, setReportOpen] = useState(false);
  const [tab, setTab] = useState<'overview' | 'explore'>('overview');

  const { data: entData } = useSWR(wid ? `ent-${wid}` : null,
    () => api<{ entities: Entity[] }>(`/api/${wid}/analytics/entities`));

  const effectiveEntity = entityId ?? entData?.entities?.[0]?.id ?? null;

  const { data: overview, isLoading } = useSWR(
    effectiveEntity ? `ov-${effectiveEntity}-${quarters}` : null,
    () => api<{ overview: Overview }>(`/api/${wid}/analytics/overview${`?entityId=${effectiveEntity}&quarters=${quarters}`}`),
  );

  const { data: repData, mutate: refetchReports } = useSWR(wid ? `rep-${wid}` : null,
    () => api<{ reports: Report[] }>(`/api/${wid}/analytics/reports`));

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Portfolio Analytics</div>
          <div className="page-desc">Quarterly metrics per portfolio company — reported values, calculated figures, and AI-inferred data, each labeled honestly.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="tabs">
            <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
            <button className={`tab ${tab === 'explore' ? 'active' : ''}`} onClick={() => setTab('explore')}>Explore</button>
          </div>
          {tab === 'overview' ? (
            <>
              <div className="tabs">
                <button className={`tab ${quarters === 4 ? 'active' : ''}`} onClick={() => setQuarters(4)}>4Q</button>
                <button className={`tab ${quarters === 8 ? 'active' : ''}`} onClick={() => setQuarters(8)}>8Q</button>
              </div>
              {can('EDITOR') ? <button className="btn btn-primary" onClick={() => setReportOpen(true)}><Plus size={15} /> New report</button> : null}
            </>
          ) : null}
        </div>
      </div>

      {/* Entity selector — Overview only; Explore has its own multi-select */}
      {tab === 'overview' && entData?.entities?.length ? (
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
      ) : tab === 'explore' ? (
        <Explore wid={wid} entities={entData.entities} can={can} />
      ) : isLoading || !overview ? (
        <LoadingBlock label="Loading metrics…" />
      ) : (
        <>
          {/* Trend overview first — the one chart that compares every metric
              on a shared (indexed) scale, so the user reads trajectories, not
              raw incommensurable units. */}
          <TrendOverview metrics={overview.overview.metrics} />
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
        </>
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

// Compact number for axis labels: 1234567 -> "1.2M".
function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return String(v);
}

// All-metric trend comparison: each metric is indexed to its first quarter
// (= 100), which puts wildly different units (USD millions, ratios, %) on
// one honest scale. Tooltips still show the real values. Data-zoom lets the
// user focus a range; the legend toggles metrics.
function TrendOverview({ metrics }: { metrics: Overview['metrics'] }) {
  const withData = metrics.filter((m) => m.series.length >= 2);
  if (withData.length < 2) return null;
  const byLabel = new Map(withData.map((m) => [m.label, m]));

  const option: EChartOption = {
    grid: { left: 10, right: 14, top: 8, bottom: 44, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: CHART.surface,
      borderColor: CHART.hairline,
      textStyle: { color: '#1d1d1f', fontSize: 12 },
      formatter: (params: unknown) => {
        const arr = Array.isArray(params) ? params : [params];
        const rows = (arr as { seriesName: string; dataIndex: number; marker: string }[])
          .map((p) => {
            const m = byLabel.get(p.seriesName);
            const s = m?.series[p.dataIndex];
            if (!m || !s) return '';
            return `${p.marker} ${m.label}: <b>${s.value}</b> ${m.unit}${s.derivation === 'AI_INFERRED' ? ' <span style="color:' + CHART.textMuted + '">(AI-inferred)</span>' : ''}`;
          })
          .filter(Boolean);
        const period = withData[0].series[(arr as { dataIndex: number }[])[0]?.dataIndex]?.period;
        return period ? `<b>${period}</b><br/>${rows.join('<br/>')}` : '';
      },
    },
    legend: { top: 0, textStyle: { color: CHART.textMuted, fontSize: 11 }, type: 'scroll' },
    xAxis: { type: 'category', data: withData[0].series.map((s) => s.period), ...baseAxis(), splitLine: { show: false } },
    yAxis: { type: 'value', ...baseAxis(), name: 'Indexed (first qtr = 100)', nameTextStyle: { color: CHART.textMuted, fontSize: 10.5 } },
    dataZoom: [
      { type: 'inside' },
      { type: 'slider', height: 14, bottom: 6, borderColor: CHART.hairline, fillerColor: CHART.blueTint, handleStyle: { color: CHART.blue } },
    ],
    series: withData.map((m, i) => {
      const base = m.series[0].value;
      const data = m.series.map((s) => (base !== 0 ? +((s.value / base) * 100).toFixed(1) : null));
      return {
        name: m.label,
        type: 'line' as const,
        data,
        symbolSize: 6,
        lineStyle: { width: 2 },
        itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
        emphasis: { focus: 'series' as const },
      };
    }),
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-title">Trend overview</div>
          <div className="card-sub">every metric indexed to its first quarter (100) — compare trajectories across units; hover for real values</div>
        </div>
      </div>
      <div style={{ padding: '4px 12px 8px' }}>
        <EChart option={option} height={280} />
      </div>
    </div>
  );
}

function MetricCard({ metric, quarters }: { metric: Overview['metrics'][number]; quarters: string[] }) {
  const series = metric.series;
  const latest = series[series.length - 1];
  const prev = series[series.length - 2];
  const delta = latest && prev && prev.value !== 0 ? ((latest.value - prev.value) / Math.abs(prev.value)) * 100 : null;

  const option: EChartOption = {
    grid: { left: 8, right: 8, top: 10, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: CHART.surface,
      borderColor: CHART.hairline,
      textStyle: { color: '#1d1d1f', fontSize: 12 },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params;
        const s = series[(p as { dataIndex: number }).dataIndex];
        if (!s) return '';
        const src = s.sourcePage != null ? ` · p.${s.sourcePage}` : '';
        const d = s.derivation === 'AI_INFERRED' ? 'AI-inferred' : s.derivation === 'CALCULATED' ? 'calculated' : 'reported';
        return `<b>${s.period}</b><br/>${s.value} ${metric.unit}<br/><span style="color:${CHART.textMuted}">${d}${src}</span>`;
      },
    },
    xAxis: {
      type: 'category',
      data: series.map((s) => s.period),
      ...baseAxis(),
      splitLine: { show: false },
      axisLabel: { ...baseAxis().axisLabel, rotate: series.length > 6 ? 40 : 0, interval: 0 },
    },
    yAxis: { type: 'value', ...baseAxis(), axisLabel: { ...baseAxis().axisLabel, formatter: compact } },
    series: [{
      type: 'bar',
      barMaxWidth: 34,
      data: series.map((s, i) => ({
        value: s.value,
        itemStyle: {
          color: i === series.length - 1 ? CHART.blue : CHART.blueLight,
          // Honesty first: AI-inferred figures render faded — you can see
          // provenance in the chart itself, not just the badge below.
          opacity: s.derivation === 'AI_INFERRED' ? 0.55 : 1,
          borderRadius: [4, 4, 2, 2],
        },
      })),
    }],
  };

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
        <EChart option={option} height={140} />
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
      await api(`/api/${workspaceId}/analytics/reports`, {
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

// ── Explore tab ─────────────────────────────────────────────────────────
// The spec's Explore tab: pick a dataset (companies × metrics × window),
// get the recommended chart with its reasoning ("Why this chart?"), and save
// the view for one-click reload. Saved views store the question, not a frozen
// picture — the chart re-recommends itself every load.
function Explore({ wid, entities, can }: { wid?: string; entities: Entity[]; can: (r: 'VIEWER' | 'REVIEWER' | 'EDITOR' | 'ADMIN') => boolean }) {
  const [entityIds, setEntityIds] = useState<string[]>([]); // [] → default first company
  const [metricKeys, setMetricKeys] = useState<string[]>([]); // [] → all metrics
  const [quarters, setQuarters] = useState(4);
  const [saveOpen, setSaveOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const effEntityIds = entityIds.length ? entityIds : entities[0] ? [entities[0].id] : [];

  const { data, isLoading } = useSWR(
    wid && effEntityIds.length ? `exp-${wid}-${effEntityIds.join(',')}|${metricKeys.join(',')}|${quarters}` : null,
    () => api<ExploreData>(`/api/${wid}/analytics/explore${qs({
      entityIds: effEntityIds.join(','), metricKeys: metricKeys.join(','), quarters,
    })}`),
  );
  const { data: viewData, mutate: refetchViews } = useSWR(wid ? `views-${wid}` : null,
    () => api<{ views: SavedView[] }>(`/api/${wid}/analytics/views`));
  const d = data;

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  async function saveView(e: React.FormEvent) {
    e.preventDefault();
    if (!wid || !d?.series.length) return;
    setBusy(true);
    try {
      await api(`/api/${wid}/analytics/views`, {
        method: 'POST',
        body: { title, spec: { entityIds: effEntityIds, metricKeys, quarters } },
      });
      setTitle(''); setSaveOpen(false); refetchViews();
    } finally { setBusy(false); }
  }

  async function delView(id: string) {
    await api(`/api/analytics/views/${id}`, { method: 'DELETE' });
    refetchViews();
  }

  function loadView(v: SavedView) {
    setEntityIds(v.spec.entityIds);
    setMetricKeys(v.spec.metricKeys);
    setQuarters(v.spec.quarters);
  }

  // Recommended chart, rendered per the backend's rule — periods are the
  // shared x-axis; missing observations render as gaps, never as zeros.
  let option: EChartOption | null = null;
  if (d && d.series.length && d.recommendation.type !== 'NONE') {
    const multiEnt = effEntityIds.length > 1;
    const tooltipBase = {
      trigger: 'axis' as const,
      backgroundColor: CHART.surface,
      borderColor: CHART.hairline,
      textStyle: { color: '#1d1d1f', fontSize: 12 },
    };
    if (d.recommendation.type === 'INDEX') {
      const nameOf = (s: ExploreSeries) => (multiEnt ? `${s.entityName} · ${s.label}` : s.label);
      option = {
        grid: { left: 10, right: 14, top: 26, bottom: 8, containLabel: true },
        tooltip: {
          ...tooltipBase,
          formatter: (params: unknown) => {
            const arr = Array.isArray(params) ? params : [params];
            const rows = (arr as { seriesName: string; dataIndex: number; marker: string }[]).map((p) => {
              const s = d.series.find((x) => nameOf(x) === p.seriesName);
              const pt = s?.points.find((x) => x.period === d.periods[p.dataIndex]);
              return pt && s ? `${p.marker} ${p.seriesName}: <b>${pt.value}</b> ${s.unit}` : '';
            }).filter(Boolean);
            return d.periods[(arr as { dataIndex: number }[])[0]?.dataIndex]
              ? `<b>${d.periods[(arr as { dataIndex: number }[])[0].dataIndex]}</b><br/>${rows.join('<br/>')}`
              : '';
          },
        },
        legend: { top: 0, textStyle: { color: CHART.textMuted, fontSize: 11 }, type: 'scroll' },
        xAxis: { type: 'category', data: d.periods, ...baseAxis(), splitLine: { show: false } },
        yAxis: { type: 'value', ...baseAxis(), name: 'Indexed (first = 100)', nameTextStyle: { color: CHART.textMuted, fontSize: 10.5 } },
        series: d.series.map((s, i) => {
          const base = s.points[0]?.value ?? 0;
          return {
            name: nameOf(s),
            type: 'line' as const,
            data: d.periods.map((p) => {
              const pt = s.points.find((x) => x.period === p);
              return pt && base !== 0 ? +((pt.value / base) * 100).toFixed(1) : null;
            }),
            symbolSize: 6, lineStyle: { width: 2 },
            itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
            emphasis: { focus: 'series' as const },
          };
        }),
      };
    } else if (d.recommendation.type === 'BAR') {
      const latest = d.periods[d.periods.length - 1];
      option = {
        grid: { left: 10, right: 14, top: 26, bottom: 8, containLabel: true },
        tooltip: {
          ...tooltipBase,
          trigger: 'item' as const,
          formatter: (params: unknown) => {
            const p = params as { dataIndex: number; marker: string };
            const s = d.series[p.dataIndex];
            const pt = s?.points.find((x) => x.period === latest);
            return s && pt ? `${p.marker} ${s.entityName} · <b>${pt.value}</b> ${s.unit}` : '';
          },
        },
        xAxis: { type: 'category', data: d.series.map((s) => s.entityName), ...baseAxis(), splitLine: { show: false } },
        yAxis: { type: 'value', ...baseAxis(), axisLabel: { ...baseAxis().axisLabel, formatter: compact } },
        series: [{
          type: 'bar',
          barMaxWidth: 34,
          data: d.series.map((s) => {
            const pt = s.points.find((x) => x.period === latest);
            return { value: pt?.value ?? null, itemStyle: { color: CHART.blue, borderRadius: [4, 4, 2, 2] } };
          }),
        }],
      };
    } else {
      // LINE — one metric over time, one line per company.
      const unit = d.series[0]?.unit ?? '';
      option = {
        grid: { left: 10, right: 14, top: 26, bottom: 8, containLabel: true },
        tooltip: {
          ...tooltipBase,
          formatter: (params: unknown) => {
            const arr = Array.isArray(params) ? params : [params];
            const rows = (arr as { seriesName: string; dataIndex: number; marker: string }[]).map((p) => {
              const s = d.series.find((x) => x.entityName === p.seriesName);
              const pt = s?.points.find((x) => x.period === d.periods[p.dataIndex]);
              return pt ? `${p.marker} ${p.seriesName}: <b>${pt.value}</b> ${unit}` : '';
            }).filter(Boolean);
            return d.periods[(arr as { dataIndex: number }[])[0]?.dataIndex]
              ? `<b>${d.periods[(arr as { dataIndex: number }[])[0].dataIndex]}</b><br/>${rows.join('<br/>')}`
              : '';
          },
        },
        legend: { top: 0, textStyle: { color: CHART.textMuted, fontSize: 11 }, type: 'scroll' },
        xAxis: { type: 'category', data: d.periods, ...baseAxis(), splitLine: { show: false } },
        yAxis: { type: 'value', ...baseAxis(), name: unit, nameTextStyle: { color: CHART.textMuted, fontSize: 10.5 } },
        series: d.series.map((s, i) => ({
          name: s.entityName,
          type: 'line' as const,
          data: d.periods.map((p) => s.points.find((x) => x.period === p)?.value ?? null),
          symbolSize: 6, lineStyle: { width: 2 },
          itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
          emphasis: { focus: 'series' as const },
        })),
      };
    }
  }

  return (
    <>
      {/* Dataset + filters */}
      <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Companies</span>
          {entities.map((e) => (
            <button key={e.id} className={`btn btn-sm ${effEntityIds.includes(e.id) ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setEntityIds(toggle(entityIds, e.id))}>
              <Building2 size={13} /> {e.name}
            </button>
          ))}
          <div className="tabs" style={{ marginLeft: 'auto' }}>
            <button className={`tab ${quarters === 4 ? 'active' : ''}`} onClick={() => setQuarters(4)}>4Q</button>
            <button className={`tab ${quarters === 8 ? 'active' : ''}`} onClick={() => setQuarters(8)}>8Q</button>
            <button className={`tab ${quarters === 1 ? 'active' : ''}`} onClick={() => setQuarters(1)}>Latest</button>
          </div>
        </div>
        {d?.metrics?.length ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 5 }}>Metrics</span>
            {metricKeys.length === 0
              ? <span style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5 }}>all ({d.metrics.length})</span>
              : null}
            {d.metrics.map((m) => (
              <button key={m.key} className={`btn btn-sm ${metricKeys.includes(m.key) ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 12 }} onClick={() => setMetricKeys(toggle(metricKeys, m.key))}>
                {m.label}
              </button>
            ))}
            {metricKeys.length
              ? <button className="btn btn-ghost btn-sm" onClick={() => setMetricKeys([])}>Reset</button>
              : null}
          </div>
        ) : null}
      </div>

      {/* Recommended chart + its reasoning */}
      {isLoading || (!d && wid) ? (
        <LoadingBlock label="Exploring…" />
      ) : option && d ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-header">
            <div>
              <div className="card-title">Recommended chart</div>
              <div className="card-sub">{d.series.length} series · {d.periods.length} {d.periods.length === 1 ? 'period' : 'periods'}</div>
            </div>
            {can('EDITOR') ? (
              <button className="btn btn-secondary btn-sm" onClick={() => setSaveOpen(true)}>
                <Bookmark size={13} /> Save view
              </button>
            ) : null}
          </div>
          <div style={{ padding: '4px 12px 8px' }}>
            <EChart option={option} height={300} />
          </div>
          <div style={{ display: 'flex', gap: 8, margin: '0 20px 14px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <Lightbulb size={14} style={{ flexShrink: 0, marginTop: 1, color: '#d97706' }} />
            <span><strong>Why this chart?</strong> {d.recommendation.why}</span>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 12 }}>
          <EmptyState icon={<LineChart size={20} />} title="Nothing to chart yet"
            sub={d?.recommendation.why ?? 'Pick companies and metrics to explore.'} />
        </div>
      )}

      {/* Saved views */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Saved views</div>
          <span className="card-sub">reload a dataset + filters in one click</span>
        </div>
        {!viewData || viewData.views.length === 0 ? (
          <div style={{ padding: '24px 20px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
            No saved views yet. Configure a chart above and save it for one-click access.
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>View</th><th>Companies</th><th>Metrics</th><th>Window</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {viewData.views.map((v) => (
                <tr key={v.id}>
                  <td className="strong">{v.title}</td>
                  <td>{v.spec.entityIds.length}</td>
                  <td>{v.spec.metricKeys.length ? v.spec.metricKeys.length : 'all'}</td>
                  <td>{v.spec.quarters}Q</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{timeAgo(v.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost btn-sm" style={{ marginRight: 6 }} onClick={() => loadView(v)}>Load</button>
                    {can('EDITOR') ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => delView(v.id)}><Trash2 size={13} /></button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Save-view modal */}
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save this view">
        <form onSubmit={saveView} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Title" hint="The saved view stores companies, metrics and window — the chart re-recommends itself on load.">
            <input className="input" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. “EBITDA across the group”" autoFocus />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setSaveOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !d?.series.length} type="submit">Save view</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
