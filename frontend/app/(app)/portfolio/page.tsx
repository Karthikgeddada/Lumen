'use client';

// Portfolio — the across-the-portfolio monitoring view. Covenants is
// per-entity; this is the one screen that rolls every company up: a heatmap
// of borrowers × covenants (pass, near-breach, fail, not tested, waived),
// a company table, and drilldown into each borrower's company page.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Briefcase, Building2, Plus, ShieldCheck, ShieldAlert, ArrowUpRight } from 'lucide-react';
import { api } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import { EmptyState, Field, LoadingBlock, Modal } from '../../../components/ui';

interface Entity { id: string; name: string; _count: { observations: number; reports: number } }
interface CovenantResult {
  id: string; period: string; value: number | null;
  status: 'PASS' | 'FAIL' | 'NOT_TESTED' | 'WAIVED';
  headroom: number | null; computedAt: string;
  nearBreach: { withinPct: boolean } | null;
}

// Heatmap cell colors — pass/near-breach/fail/not-tested/waived, per spec.
const HEAT: Record<string, { bg: string; fg: string; label: string }> = {
  PASS: { bg: 'var(--success-bg)', fg: 'var(--success)', label: 'Pass' },
  FAIL: { bg: 'var(--error-bg)', fg: 'var(--error)', label: 'Breach' },
  NEAR: { bg: '#fff3dd', fg: '#9a6700', label: 'Near breach' },
  NOT_TESTED: { bg: 'var(--sunken)', fg: 'var(--text-muted)', label: 'Not tested' },
  WAIVED: { bg: 'var(--blue-tint)', fg: 'var(--blue-text)', label: 'Waived' },
};
const MAX_HEAT_COLS = 8;
interface CovenantDefinition {
  id: string;
  label: string;
  entity: { id: string; name: string };
  results: CovenantResult[]; // newest first
}

// Latest-period covenant rollup for one entity.
function rollup(defs: CovenantDefinition[], entityId: string) {
  const mine = defs.filter((d) => d.entity.id === entityId);
  const latest = mine.map((d) => d.results[0]).filter(Boolean) as CovenantResult[];
  return {
    covenants: mine.length,
    tested: latest.length,
    passes: latest.filter((r) => r.status === 'PASS').length,
    fails: latest.filter((r) => r.status === 'FAIL').length,
    near: latest.some((r) => r.nearBreach?.withinPct),
    period: latest[0]?.period ?? null,
  };
}

export default function Portfolio() {
  const { workspace, can } = useWorkspace();
  const wid = workspace?.workspace.id;
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same SWR keys the Analytics and Covenants pages (and the nav prefetch)
  // use — navigating between them reuses the cache instead of refetching.
  const { data: entData, isLoading, mutate: refetchEntities } = useSWR(
    wid ? `ent-${wid}` : null,
    () => api<{ entities: Entity[] }>(`/api/${wid}/analytics/entities`),
  );
  const { data: covData } = useSWR(
    wid ? `cov-${wid}-all` : null,
    () => api<{ definitions: CovenantDefinition[] }>(`/api/workspaces/${wid}/covenants`),
  );

  const entities = entData?.entities ?? [];
  const defs = covData?.definitions ?? [];

  const rows = useMemo(
    () => entities.map((e) => ({ entity: e, cov: rollup(defs, e.id) })),
    [entities, defs],
  );
  const totals = useMemo(() => {
    const latestAll = defs.map((d) => d.results[0]).filter(Boolean) as CovenantResult[];
    return {
      covenants: defs.length,
      passes: latestAll.filter((r) => r.status === 'PASS').length,
      fails: latestAll.filter((r) => r.status === 'FAIL').length,
    };
  }, [defs]);

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!wid) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/${wid}/analytics/entities`, { method: 'POST', body: { name } });
      setName(''); setAddOpen(false); refetchEntities();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the company.');
    } finally { setBusy(false); }
  }

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Portfolio</div>
          <div className="page-desc">Every company in this workspace — data coverage and covenant standing at a glance.</div>
        </div>
        {can('EDITOR') ? (
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}><Plus size={15} /> Add company</button>
        ) : null}
      </div>

      {/* KPI strip */}
      {entities.length > 0 ? (
        <div className="grid-kpi" style={{ marginBottom: 16 }}>
          <div className="card" style={{ padding: '16px 20px' }}><div className="kpi-value">{entities.length}</div><div className="kpi-label">Companies</div></div>
          <div className="card" style={{ padding: '16px 20px' }}><div className="kpi-value">{totals.covenants}</div><div className="kpi-label">Covenants tracked</div></div>
          <div className="card" style={{ padding: '16px 20px' }}>
            <div className="kpi-value" style={{ color: totals.passes > 0 ? 'var(--success)' : undefined }}>{totals.passes}</div>
            <div className="kpi-label">Passing (latest period)</div>
          </div>
          <div className="card" style={{ padding: '16px 20px' }}>
            <div className="kpi-value" style={{ color: totals.fails > 0 ? 'var(--error)' : undefined }}>{totals.fails}</div>
            <div className="kpi-label">Breached (latest period)</div>
          </div>
        </div>
      ) : null}

      {!entData || !covData ? (
        <LoadingBlock label="Loading portfolio…" />
      ) : entities.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Briefcase size={20} />}
            title="No companies yet"
            sub="Add a company to start tracking it — then feed it numbers from verified extractions, extract its covenant tests from credit agreements, and watch everything here."
          />
        </div>
      ) : (
        <>
          {/* Heatmap — borrowers × covenants. A covenant definition belongs to
              one borrower, so each row lights up only on its own covenants;
              empty cells show where covenants haven't been defined yet. */}
          {(() => {
            const cols: { key: string; label: string }[] = [];
            for (const d of defs) {
              if (cols.length >= MAX_HEAT_COLS) break;
              if (!cols.some((c) => c.key === d.label)) cols.push({ key: d.label, label: d.label });
            }
            const overflow = new Set(defs.map((d) => d.label)).size - cols.length;
            if (defs.length === 0) return null;
            return (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div className="card-title">Covenant heatmap</div>
                  <span className="card-sub">latest tested period per covenant{overflow > 0 ? ` · ${overflow} more covenant${overflow === 1 ? '' : 's'} in Covenants` : ''}</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Borrower</th>
                        {cols.map((c) => <th key={c.key} style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.label}>{c.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {entities.map((e) => (
                        <tr key={e.id}>
                          <td className="strong" style={{ whiteSpace: 'nowrap' }}>
                            <Link href={`/borrowers/${e.id}`} style={{ color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <Building2 size={13} color="var(--text-muted)" /> {e.name}
                            </Link>
                          </td>
                          {cols.map((c) => {
                            const def = defs.find((d) => d.entity.id === e.id && d.label === c.key);
                            const r = def?.results[0];
                            const key = r ? (r.nearBreach?.withinPct ? 'NEAR' : r.status) : null;
                            const style = key ? HEAT[key] : null;
                            return (
                              <td key={c.key} style={{ textAlign: 'center' }}>
                                <span
                                  title={def && r ? `${e.name} · ${c.label}: ${style?.label ?? r.status} (${r.period})` : `${e.name} · no “${c.label}” covenant`}
                                  style={{
                                    display: 'inline-block', width: 22, height: 22, borderRadius: 6,
                                    background: style?.bg ?? 'transparent',
                                    color: style?.fg ?? 'var(--border-strong)',
                                    fontSize: 11, fontWeight: 650, lineHeight: '22px',
                                    boxShadow: style ? 'inset 0 0 0 1px rgba(29,29,31,0.05)' : 'inset 0 0 0 1px var(--border)',
                                  }}>
                                  {key === 'FAIL' ? '!' : key ? '✓' : '·'}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '10px 20px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {(['PASS', 'NEAR', 'FAIL', 'NOT_TESTED', 'WAIVED'] as const).map((k) => (
                    <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 4, background: HEAT[k].bg, boxShadow: 'inset 0 0 0 1px rgba(29,29,31,0.08)', display: 'inline-block' }} />
                      {HEAT[k].label}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="card">
          <div className="card-header">
            <div className="card-title">Companies</div>
            <span className="card-sub">covenant standing in each company's latest tested period</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>Company</th><th>Metric data</th><th>Covenants</th><th>Latest test</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(({ entity: e, cov }) => (
                <tr key={e.id}>
                  <td className="strong">
                    <Link href={`/borrowers/${e.id}`} style={{ color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Building2 size={14} color="var(--text-muted)" /> {e.name}
                    </Link>
                    {cov.near ? (
                      <span className="badge" style={{ marginLeft: 10, background: 'rgba(154, 103, 0, 0.12)', color: '#9a6700' }}>Near breach</span>
                    ) : null}
                  </td>
                  <td style={{ fontSize: 12.5, color: e._count.observations === 0 ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                    {e._count.observations === 0 ? 'No data yet' : `${e._count.observations} observation${e._count.observations === 1 ? '' : 's'}`}
                  </td>
                  <td style={{ fontSize: 12.5, color: cov.covenants === 0 ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                    {cov.covenants === 0 ? '—' : cov.covenants}
                  </td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{cov.period ?? '—'}</td>
                  <td>
                    {cov.covenants === 0 ? (
                      <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No covenants</span>
                    ) : cov.fails > 0 ? (
                      <span className="badge badge-error"><ShieldAlert size={11} /> {cov.fails} breach{cov.fails === 1 ? '' : 'es'}</span>
                    ) : cov.passes > 0 ? (
                      <span className="badge badge-success"><ShieldCheck size={11} /> All passing</span>
                    ) : (
                      <span className="badge badge-neutral">Not tested</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link href={`/borrowers/${e.id}`} className="btn btn-ghost btn-sm" title={`Open ${e.name}'s company page`}>
                      Company page
                    </Link>
                    <Link href="/analytics" className="btn btn-ghost btn-sm" title={`Open ${e.name} in Analytics`}>
                      Analytics <ArrowUpRight size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
      )}

      {/* Add company */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add company">
        <form onSubmit={addCompany} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Company name">
            <input className="input" required autoFocus maxLength={120} value={name}
              placeholder="e.g. Northwind Foods"
              onChange={(e) => setName(e.target.value)} />
          </Field>
          {error ? <div style={{ fontSize: 12.5, color: 'var(--error)' }}>{error}</div> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setAddOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add company'}</button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
