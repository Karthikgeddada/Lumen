'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  Scale, Plus, FileSearch, Play, Trash2, ShieldCheck, ShieldAlert, FileText, Building2, History, Sigma, ClipboardList,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import { EmptyState, Field, LoadingBlock, Modal } from '../../../components/ui';

interface Entity { id: string; name: string; _count: { observations: number; reports: number } }
interface Doc { id: string; name: string; status: string }
type TermInput = { key: string; metricKey: string; kind: 'flow' | 'stock' | 'ratio' };
type CureEvent = { at: string; byName: string | null; period: string | null; note: string };

interface CovenantResult {
  id: string; period: string; value: number | null; status: 'PASS' | 'FAIL' | 'NOT_TESTED' | 'WAIVED';
  headroom: number | null; computedAt: string; reason: string | null; previousStatus: string | null;
  nearBreach: { headroom: number; headroomPct: number | null; withinPct: boolean } | null;
}
interface CovenantDefinition {
  id: string; key: string; label: string; description: string | null;
  metricKey: string; comparator: 'LTE' | 'GTE'; threshold: number; unit: string;
  period: string; sourceExcerpt: string | null; sourcePage: number | null;
  confidence: number; status: 'AI_INFERRED' | 'REVIEWED';
  entity: { id: string; name: string };
  document: { id: string; name: string } | null;
  formula: string | null;
  terms: { inputs: TermInput[]; where: string | null } | null;
  schedule: { effectiveFrom: string; threshold: number }[] | null;
  nearBreachPct: number | null;
  cure: { events?: CureEvent[] } | null;
  results: CovenantResult[]; // newest first
}

function statusBadge(status: CovenantResult['status']) {
  if (status === 'PASS') return <span className="badge badge-success"><ShieldCheck size={11} /> Pass</span>;
  if (status === 'FAIL') return <span className="badge badge-error"><ShieldAlert size={11} /> Breach</span>;
  if (status === 'WAIVED') return <span className="badge">Waived</span>;
  return <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>Not tested</span>;
}

export default function Covenants() {
  const { workspace, can } = useWorkspace();
  const wid = workspace?.workspace.id;
  const [entityId, setEntityId] = useState<string | null>(null);
  const [extractOpen, setExtractOpen] = useState(false);
  const [defineOpen, setDefineOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const { data: entData } = useSWR(wid ? `ent-${wid}` : null,
    () => api<{ entities: Entity[] }>(`/api/${wid}/analytics/entities`));

  const effectiveEntity = entityId ?? entData?.entities?.[0]?.id ?? null;

  const { data: covData, isLoading, mutate: refetch } = useSWR(
    wid ? `cov-${wid}-${effectiveEntity ?? 'all'}` : null,
    () => api<{ definitions: CovenantDefinition[]; periods: string[] }>(
      `/api/workspaces/${wid}/covenants${effectiveEntity ? `?entityId=${effectiveEntity}` : ''}`),
  );

  const defs = covData?.definitions ?? [];
  const latest = (d: CovenantDefinition) => d.results[0];
  const passed = defs.filter((d) => latest(d)?.status === 'PASS').length;
  const failed = defs.filter((d) => latest(d)?.status === 'FAIL').length;
  const pending = defs.filter((d) => d.status === 'AI_INFERRED').length;
  const reviewDef = defs.find((d) => d.id === reviewId) ?? null;

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Covenants</div>
          <div className="page-desc">Extract covenant tests from credit agreements, then test every quarter automatically — every threshold traced to its clause.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Certificates is a tab of this page per the spec — routed to its own
              placeholder page until the tab content is built. */}
          <div className="tabs" style={{ marginRight: 4 }}>
            <Link href="/covenants" className="tab active">Covenant tests</Link>
            <Link href="/certificates" className="tab">Certificates</Link>
          </div>
          {defs.length > 0 && can('EDITOR') ? (
            <button className="btn btn-secondary" onClick={() => setTestOpen(true)}><Play size={14} /> Run tests</button>
          ) : null}
          {can('EDITOR') ? <button className="btn btn-secondary" onClick={() => setDefineOpen(true)}><Plus size={14} /> Define manually</button> : null}
          {can('EDITOR') ? <button className="btn btn-primary" onClick={() => setExtractOpen(true)}><FileSearch size={15} /> Extract from agreement</button> : null}
        </div>
      </div>

      {/* Entity selector */}
      {entData?.entities?.length ? (
        <div className="card" style={{ padding: '10px 12px', marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${!entityId ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setEntityId(null)}>All entities</button>
          {entData.entities.map((e) => (
            <button key={e.id} className={`btn btn-sm ${effectiveEntity === e.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setEntityId(e.id)}>
              <Building2 size={13} /> {e.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* KPI strip */}
      {defs.length > 0 ? (
        <div className="grid-kpi" style={{ marginBottom: 16 }}>
          <div className="card" style={{ padding: '16px 20px' }}><div className="kpi-value">{defs.length}</div><div className="kpi-label">Covenants tracked</div></div>
          <div className="card" style={{ padding: '16px 20px' }}><div className="kpi-value" style={{ color: 'var(--success, #1d9a4b)' }}>{passed}</div><div className="kpi-label">Passing (latest period)</div></div>
          <div className="card" style={{ padding: '16px 20px' }}><div className="kpi-value" style={{ color: 'var(--error)' }}>{failed}</div><div className="kpi-label">Breached (latest period)</div></div>
          <div className="card" style={{ padding: '16px 20px' }}><div className="kpi-value">{pending}</div><div className="kpi-label">Pending review</div></div>
        </div>
      ) : null}

      {!covData ? (
        <LoadingBlock label="Loading covenants…" />
      ) : defs.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Scale size={20} />}
            title="No covenants yet"
            sub="Upload a credit agreement to the Library, then extract its covenant tests — or define one manually. Every quarter's metrics get tested automatically against each threshold."
          />
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Covenant tests</div>
            <span className="card-sub">every threshold traced to its source clause</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>Covenant</th><th>Test</th><th>Latest result</th><th>History</th><th>Source</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {defs.map((d) => {
                const l = latest(d);
                const cmp = d.comparator === 'LTE' ? '≤' : '≥';
                return (
                  <tr key={d.id}>
                    <td className="strong">{d.label}{!entityId && entData?.entities?.length ? <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>{d.entity.name}</span> : null}</td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {d.formula ? (
                        <span title={`Formula covenant — inputs feed it from observed metrics`}>
                          <Sigma size={11} style={{ verticalAlign: -1, color: 'var(--text-muted)' }} /> {d.formula} {cmp} {d.threshold}{d.unit}
                        </span>
                      ) : (
                        <>{d.metricKey} {cmp} {d.threshold}{d.unit}</>
                      )}
                      {d.nearBreachPct != null ? (
                        <span style={{ color: '#9a6700' }}> · alert within {d.nearBreachPct}%</span>
                      ) : null}
                    </td>
                    <td>
                      {l ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          {statusBadge(l.status)}
                          {l.nearBreach?.withinPct ? (
                            <span className="badge" style={{ background: 'rgba(154, 103, 0, 0.12)', color: '#9a6700' }}>Near breach</span>
                          ) : null}
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.period}: {l.value ?? '—'}{l.headroom != null ? ` · ${l.headroom >= 0 ? '+' : ''}${l.headroom.toFixed(2)}${d.unit} headroom` : ''}</span>
                          {l.reason ? <span style={{ fontSize: 11.5, color: '#9a6700' }}>⚑ {l.reason}</span> : null}
                          {l.status === 'NOT_TESTED' && l.previousStatus && l.previousStatus !== 'NOT_TESTED' ? (
                            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>· was {l.previousStatus.toLowerCase()}</span>
                          ) : null}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>Not tested</span>}
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 4 }} title="most recent periods">
                        <History size={12} color="var(--text-muted)" />
                        {d.results.slice(0, 4).reverse().map((r) => (
                          <span key={r.id} style={{
                            width: 8, height: 8, borderRadius: 999, display: 'inline-block',
                            background: r.status === 'PASS' ? 'var(--success, #1d9a4b)' : r.status === 'FAIL' ? 'var(--error)' : 'var(--border)',
                          }} title={`${r.period}: ${r.status}${r.value != null ? ` (${r.value})` : ''}`} />
                        ))}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {d.document ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <FileText size={12} color="var(--text-muted)" />
                          <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' }}>{d.document.name}</span>
                          {d.sourcePage ? <span className="mono" style={{ color: 'var(--text-muted)' }}>p.{d.sourcePage}</span> : null}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>Manual</span>}
                    </td>
                    <td>
                      {d.status === 'REVIEWED'
                        ? <span className="badge badge-success"><ShieldCheck size={11} /> Reviewed</span>
                        : <span className="badge badge-blue">Needs review</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {can('EDITOR') ? (
                        <>
                          {d.status === 'AI_INFERRED' ? (
                            <button className="btn btn-ghost btn-sm" onClick={() => setReviewId(d.id)}>Review</button>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => setReviewId(d.id)}>Edit</button>
                          )}
                          <button className="btn btn-ghost btn-sm" onClick={async () => {
                            if (!confirm(`Delete covenant "${d.label}"? Its test history is preserved.`)) return;
                            await api(`/api/covenants/${d.id}`, { method: 'DELETE' });
                            refetch();
                          }}><Trash2 size={13} /></button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ExtractModal open={extractOpen} onClose={() => setExtractOpen(false)} wid={wid}
        entities={entData?.entities ?? []} defaultEntity={effectiveEntity}
        onDone={() => { setExtractOpen(false); refetch(); }} />
      <DefineModal open={defineOpen} onClose={() => setDefineOpen(false)} wid={wid}
        entities={entData?.entities ?? []} defaultEntity={effectiveEntity}
        onDone={() => { setDefineOpen(false); refetch(); }} />
      <TestModal open={testOpen} onClose={() => setTestOpen(false)} wid={wid}
        entities={entData?.entities ?? []} defaultEntity={effectiveEntity} periods={covData?.periods ?? []}
        onDone={() => refetch()} />
      {reviewDef ? (
        <ReviewModal def={reviewDef} wid={wid} onClose={() => setReviewId(null)} onDone={() => { setReviewId(null); refetch(); }} />
      ) : null}
    </main>
  );
}

function useDocList(wid?: string) {
  return useSWR(wid ? `docs-${wid}` : null,
    () => api<{ documents: Doc[] }>(`/api/workspaces/${wid}/documents`),
  );
}

function ExtractModal({ open, onClose, wid, entities, defaultEntity, onDone }: {
  open: boolean; onClose: () => void; wid?: string; entities: Entity[];
  defaultEntity: string | null; onDone: () => void;
}) {
  const { data: docData } = useDocList(wid);
  const [entityId, setEntityId] = useState(defaultEntity ?? '');
  const [documentId, setDocumentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const docs = (docData?.documents ?? []).filter((d) => d.status === 'COMPLETED');

  async function run() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await api<{ created: number }>(`/api/workspaces/${wid}/covenants/extract`, {
        method: 'POST', body: { entityId, documentId },
      });
      setMsg(res.created > 0
        ? `Extracted ${res.created} covenant${res.created === 1 ? '' : 's'} — review them below before they count.`
        : 'No new covenants found in that document (or they were already extracted).');
      if (res.created > 0) setTimeout(onDone, 1400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Extraction failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Extract covenants from a credit agreement">
      <Field label="Entity">
        <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
          <option value="">Select entity…</option>
          {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </Field>
      <Field label="Document (processed)">
        <select className="input" value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
          <option value="">Select document…</option>
          {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        AI reads the agreement and proposes covenant tests (threshold, comparator, metric) with the source clause and page. Everything stays <strong>Needs review</strong> until you confirm it.
      </p>
      {err ? <div className="form-error">{err}</div> : null}
      {msg ? <div style={{ fontSize: 13, color: 'var(--blue)', marginTop: 6 }}>{msg}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
        <button className="btn btn-primary" disabled={busy || !entityId || !documentId} onClick={run}>
          {busy ? 'Reading agreement…' : 'Extract covenants'}
        </button>
      </div>
    </Modal>
  );
}

function DefineModal({ open, onClose, wid, entities, defaultEntity, onDone }: {
  open: boolean; onClose: () => void; wid?: string; entities: Entity[];
  defaultEntity: string | null; onDone: () => void;
}) {
  const [form, setForm] = useState({ entityId: '', key: '', label: '', metricKey: '', comparator: 'LTE' as 'LTE' | 'GTE', threshold: '', unit: 'x', formula: '', nearBreachPct: '' });
  const [inputs, setInputs] = useState<TermInput[]>([{ key: '', metricKey: '', kind: 'flow' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const entityId = form.entityId || defaultEntity || '';

  async function run() {
    setBusy(true); setErr(null);
    try {
      const validInputs = inputs.filter((t) => t.key.trim() && t.metricKey.trim());
      await api(`/api/workspaces/${wid}/covenants`, {
        method: 'POST',
        body: {
          ...form, entityId, threshold: parseFloat(form.threshold),
          formula: form.formula.trim() || null,
          ...(form.formula.trim() ? { terms: { inputs: validInputs } } : {}),
          ...(form.nearBreachPct !== '' ? { nearBreachPct: parseFloat(form.nearBreachPct) } : {}),
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create covenant.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Define a covenant manually">
      <Field label="Entity">
        <select className="input" value={entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })}>
          <option value="">Select entity…</option>
          {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Label"><input className="input" value={form.label} placeholder="Maximum net leverage" onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
        <Field label="Key (snake_case)"><input className="input mono" value={form.key} placeholder="max_net_leverage" onChange={(e) => setForm({ ...form, key: e.target.value })} /></Field>
        <Field label="Metric key"><input className="input mono" value={form.metricKey} placeholder="net_leverage" onChange={(e) => setForm({ ...form, metricKey: e.target.value })} /></Field>
        <Field label="Comparator">
          <select className="input" value={form.comparator} onChange={(e) => setForm({ ...form, comparator: e.target.value as 'LTE' | 'GTE' })}>
            <option value="LTE">≤ maximum (LTE)</option>
            <option value="GTE">≥ minimum (GTE)</option>
          </select>
        </Field>
        <Field label="Threshold"><input className="input mono" type="number" step="any" value={form.threshold} placeholder="4.5" onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></Field>
        <Field label="Unit"><input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
      </div>
      <Field label="Formula (optional — leave empty for a single-metric covenant)">
        <input className="input mono" placeholder="(debt - cash) / ebitda" value={form.formula} onChange={(e) => setForm({ ...form, formula: e.target.value })} />
      </Field>
      {form.formula.trim() ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 6px' }}>
            Inputs — flow metrics sum the last 4 consecutive quarters (TTM); stock/ratio use the period-end value. Allowed functions: min, max, abs, sum, round.
          </div>
          <FormulaInputs inputs={inputs} setInputs={setInputs} />
        </div>
      ) : null}
      <Field label="Near-breach alert band % (optional)">
        <input className="input mono" type="number" min={0} max={100} step="any" placeholder="15" style={{ width: 140 }} value={form.nearBreachPct} onChange={(e) => setForm({ ...form, nearBreachPct: e.target.value })} />
      </Field>
      {err ? <div className="form-error">{err}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !entityId || !form.key || !form.label || !form.metricKey || form.threshold === ''} onClick={run}>
          {busy ? 'Creating…' : 'Create covenant'}
        </button>
      </div>
    </Modal>
  );
}

function TestModal({ open, onClose, wid, entities, defaultEntity, periods, onDone }: {
  open: boolean; onClose: () => void; wid?: string; entities: Entity[];
  defaultEntity: string | null; periods: string[]; onDone: () => void;
}) {
  const [entityId, setEntityId] = useState(defaultEntity ?? '');
  const [period, setPeriod] = useState(periods[periods.length - 1] ?? '');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ passed: number; failed: number; notTested: number; period?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setOutcome(null);
    try {
      const res = await api<{ passed: number; failed: number; notTested: number; period: string }>(
        `/api/workspaces/${wid}/covenants/test`,
        { method: 'POST', body: { entityId, period: period || undefined } },
      );
      setOutcome(res);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Tests failed to run.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Run covenant tests">
      <Field label="Entity">
        <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
          <option value="">Select entity…</option>
          {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </Field>
      <Field label="Period (defaults to latest observed)">
        <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="">Latest observed</option>
          {periods.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Each covenant is tested against that period's observed metric value. Breaches alert the whole team and are visible on the dashboard.
      </p>
      {err ? <div className="form-error">{err}</div> : null}
      {outcome ? (
        <div style={{ fontSize: 13.5, marginTop: 6 }}>
          <strong>{outcome.period}</strong> — {outcome.passed} passed, <span style={{ color: 'var(--error)' }}>{outcome.failed} breached</span>, {outcome.notTested} without data.
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
        <button className="btn btn-primary" disabled={busy || !entityId} onClick={run}>
          {busy ? 'Testing…' : 'Run tests'}
        </button>
      </div>
    </Modal>
  );
}

// Formula input-term editor — shared by Define and Review modals.
function FormulaInputs({ inputs, setInputs }: { inputs: TermInput[]; setInputs: (v: TermInput[]) => void }) {
  const set = (i: number, patch: Partial<TermInput>) =>
    setInputs(inputs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {inputs.map((t, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr 1fr auto', gap: 6 }}>
          <input className="input mono" placeholder="name (debt)" value={t.key} onChange={(e) => set(i, { key: e.target.value })} />
          <input className="input mono" placeholder="metric key (total_debt)" value={t.metricKey} onChange={(e) => set(i, { metricKey: e.target.value })} />
          <select className="input" value={t.kind} onChange={(e) => set(i, { kind: e.target.value as TermInput['kind'] })}>
            <option value="flow">flow (quarterly)</option>
            <option value="stock">stock (period-end)</option>
            <option value="ratio">ratio</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => setInputs(inputs.filter((_, idx) => idx !== i))}>Remove</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }}
        onClick={() => setInputs([...inputs, { key: '', metricKey: '', kind: 'flow' }])}>+ Add input</button>
    </div>
  );
}

function ReviewModal({ def, wid, onClose, onDone }: {
  def: CovenantDefinition; wid?: string; onClose: () => void; onDone: () => void;
}) {
  const [form, setForm] = useState({
    label: def.label, metricKey: def.metricKey, comparator: def.comparator,
    threshold: String(def.threshold), unit: def.unit,
    formula: def.formula ?? '',
    nearBreachPct: def.nearBreachPct != null ? String(def.nearBreachPct) : '',
  });
  const [inputs, setInputs] = useState<TermInput[]>(
    def.terms?.inputs?.length ? def.terms.inputs : [{ key: '', metricKey: '', kind: 'flow' }],
  );
  const [cureNote, setCureNote] = useState('');
  const [curePeriod, setCurePeriod] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reviewed = def.status === 'REVIEWED';
  const validInputs = inputs.filter((t) => t.key.trim() && t.metricKey.trim());

  async function save(status?: 'REVIEWED') {
    setBusy(true); setErr(null);
    try {
      await api(`/api/covenants/${def.id}`, {
        method: 'PATCH',
        body: {
          label: form.label, metricKey: form.metricKey, comparator: form.comparator,
          threshold: parseFloat(form.threshold), unit: form.unit,
          formula: form.formula.trim() || null,
          ...(form.formula.trim() ? { terms: { inputs: validInputs } } : { terms: null }),
          ...(form.nearBreachPct !== '' ? { nearBreachPct: parseFloat(form.nearBreachPct) } : { nearBreachPct: null }),
          ...(status ? { status } : {}),
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  // Cure events are display-only context — never auto-applied to a result.
  async function recordCure() {
    setBusy(true); setErr(null);
    try {
      await api(`/api/covenants/${def.id}/cure`, {
        method: 'POST',
        body: { note: cureNote.trim(), ...(curePeriod.trim() ? { period: curePeriod.trim() } : {}) },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record cure.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`${reviewed ? 'Edit' : 'Review'} covenant — ${def.label}`}>
      {def.sourceExcerpt ? (
        <div className="card" style={{ padding: '12px 14px', marginBottom: 12, background: 'var(--sunken)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            Source{def.document ? `: ${def.document.name}` : ''}{def.sourcePage ? ` · page ${def.sourcePage}` : ''} · confidence {(def.confidence * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', maxHeight: 120, overflowY: 'auto', lineHeight: 1.5 }}>
            {def.sourceExcerpt}
          </div>
        </div>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Label"><input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
        <Field label="Metric key"><input className="input mono" value={form.metricKey} onChange={(e) => setForm({ ...form, metricKey: e.target.value })} /></Field>
        <Field label="Comparator">
          <select className="input" value={form.comparator} onChange={(e) => setForm({ ...form, comparator: e.target.value as 'LTE' | 'GTE' })}>
            <option value="LTE">≤ maximum (LTE)</option>
            <option value="GTE">≥ minimum (GTE)</option>
          </select>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
          <Field label="Threshold"><input className="input mono" type="number" step="any" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></Field>
          <Field label="Unit"><input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
        </div>
      </div>
      <Field label="Formula (optional)">
        <input className="input mono" placeholder="(debt - cash) / ebitda" value={form.formula} onChange={(e) => setForm({ ...form, formula: e.target.value })} />
      </Field>
      {form.formula.trim() ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 6px' }}>
            Inputs — flow metrics sum the last 4 consecutive quarters (TTM); stock/ratio use the period-end value. Allowed functions: min, max, abs, sum, round.
          </div>
          <FormulaInputs inputs={inputs} setInputs={setInputs} />
        </div>
      ) : null}
      <Field label="Near-breach alert band % (optional)">
        <input className="input mono" type="number" min={0} max={100} step="any" placeholder="15" style={{ width: 140 }} value={form.nearBreachPct} onChange={(e) => setForm({ ...form, nearBreachPct: e.target.value })} />
      </Field>
      {def.schedule?.length ? (
        <div className="card" style={{ padding: '10px 12px', background: 'var(--sunken)', fontSize: 12.5, marginBottom: 10 }}>
          <strong>Step-down schedule</strong> — base {def.threshold}
          {def.unit}: {def.schedule.map((s) => `${s.effectiveFrom} → ${s.threshold}`).join(', ')}
        </div>
      ) : null}
      <div className="card" style={{ padding: '10px 12px', background: 'var(--sunken)', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          <ClipboardList size={12} style={{ verticalAlign: -2 }} /> Cure history (display only — never auto-applied to a result)
        </div>
        {(def.cure?.events ?? []).length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No cures recorded.</div>
        ) : (
          (def.cure!.events ?? []).slice().reverse().map((e, i) => (
            <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>
              <strong>{e.period ?? new Date(e.at).toLocaleDateString()}</strong> — {e.note}
              {e.byName ? <span style={{ color: 'var(--text-muted)' }}> · {e.byName}</span> : null}
            </div>
          ))
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input className="input" placeholder="Cure note (e.g. equity cure of $2M)" value={cureNote} onChange={(e) => setCureNote(e.target.value)} />
          <input className="input mono" style={{ width: 100 }} placeholder="Q3 2026" value={curePeriod} onChange={(e) => setCurePeriod(e.target.value)} />
          <button className="btn btn-secondary" disabled={busy || !cureNote.trim()} onClick={recordCure}>Record</button>
        </div>
      </div>
      {err ? <div className="form-error">{err}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {!reviewed ? (
          <button className="btn btn-primary" disabled={busy} onClick={() => save('REVIEWED')}>
            <ShieldCheck size={14} /> Confirm & approve
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
