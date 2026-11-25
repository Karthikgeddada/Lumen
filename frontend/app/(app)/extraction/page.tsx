'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ClipboardCheck, Plus, Play, Download, Trash2, RotateCcw, Sparkles, ArrowRight, FileText,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import {
  Confidence, EmptyState, ErrorBanner, Field, LoadingBlock, Modal,
  formatDate, timeAgo,
} from '../../../components/ui';

interface Task {
  id: string; name: string; status: string; error: string | null;
  createdAt: string; completedAt: string | null;
  documentIds: string[];
  _count: { fields: number } & Record<string, unknown>;
}
interface Template {
  id: string; name: string; description: string | null;
  fields: { key: string; label: string; type: string; description?: string }[];
}
interface Doc { id: string; name: string; status: string; isDemo: boolean }

interface ExtractField { key: string; label: string; type: 'text' | 'number' | 'currency' | 'percent' | 'date'; description?: string }

const RESULT_STATUS: Record<string, { label: string; cls: string }> = {
  VERIFIED: { label: 'Verified', cls: 'badge-success' },
  NEEDS_REVIEW: { label: 'Needs review', cls: 'badge-warning' },
  REJECTED: { label: 'Rejected', cls: 'badge-error' },
  MISSING: { label: 'Not found', cls: 'badge-neutral' },
};

export default function Extraction() {
  const { workspace, can } = useWorkspace();
  const wid = workspace?.workspace.id;

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading, mutate } = useSWR(
    wid ? `ext-${wid}` : null,
    () => api<{ tasks: Task[] }>(`/api/workspaces/${wid}/extractions`),
    { refreshInterval: 10000 },
  );

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Data Extraction</div>
          <div className="page-desc">Turn borrower documents into structured, citable financial data — every value with its source page, sheet, or cell.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)} disabled={!can('EDITOR')}>
          <Plus size={15} /> New extraction
        </button>
      </div>

      {isLoading ? <LoadingBlock /> : !data || data.tasks.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ClipboardCheck size={20} />}
            title="No extractions yet"
            sub="Define fields — or start from a template — and Lumen will find each value across your documents, with confidence scores and evidence you can verify."
            action={can('EDITOR') ? (
              <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> Create your first extraction</button>
            ) : undefined}
          />
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead><tr><th>Extraction</th><th>Documents</th><th>Fields</th><th>Status</th><th>Needs review</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {data.tasks.map((t) => {
                const needsReview = Number((t._count as { results?: number }).results ?? 0);
                return (
                  <tr key={t.id}>
                    <td className="strong">
                      <button className="btn btn-ghost btn-sm" style={{ padding: 0, fontWeight: 600, color: 'var(--text-primary)' }}
                        onClick={() => setDetailId(t.id)}>{t.name}</button>
                    </td>
                    <td>{(t.documentIds as string[]).length}</td>
                    <td>{t._count.fields}</td>
                    <td><span className={`badge ${t.status === 'COMPLETED' ? 'badge-success' : t.status === 'FAILED' ? 'badge-error' : 'badge-blue'}`}>{t.status}</span></td>
                    <td>{needsReview > 0 ? <span className="badge badge-warning">{needsReview} to review</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{timeAgo(t.createdAt)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {can('EDITOR') ? (
                        <>
                          <button className="btn btn-ghost btn-sm" title="Re-run"
                            onClick={async () => { await api(`/api/extraction-tasks/${t.id}/rerun`, { method: 'POST' }); mutate(); }}>
                            <RotateCcw size={13} />
                          </button>
                          <button className="btn btn-ghost btn-sm" title="Delete"
                            onClick={async () => { await api(`/api/extraction-tasks/${t.id}`, { method: 'DELETE' }); mutate(); }}>
                            <Trash2 size={13} />
                          </button>
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

      <CreateExtraction
        open={createOpen} onClose={() => setCreateOpen(false)} workspaceId={wid} canEdit={can('EDITOR')}
        onCreated={(id) => { setCreateOpen(false); setDetailId(id); mutate(); }}
      />

      <TaskDetail taskId={detailId} onClose={() => { setDetailId(null); mutate(); }} canEdit={can('EDITOR')} canReview={can('REVIEWER')} />
    </main>
  );
}

// ── Create extraction ───────────────────────────────────────────
function CreateExtraction({ open, onClose, workspaceId, canEdit, onCreated }: {
  open: boolean; onClose: () => void; workspaceId?: string; canEdit: boolean;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [fields, setFields] = useState<ExtractField[]>([]);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: tplData } = useSWR(open && workspaceId ? `tpl-${workspaceId}` : null,
    () => api<{ templates: Template[] }>(`/api/workspaces/${workspaceId}/extractions/templates`));
  const { data: docData } = useSWR(open && workspaceId ? `docs-${workspaceId}-done` : null,
    () => api<{ documents: Doc[] }>(`/api/workspaces/${workspaceId}/documents?status=COMPLETED`));

  function useTemplate(t: Template) {
    setName(t.name);
    setFields(t.fields.map((f) => ({ key: f.key, label: f.label, type: f.type as ExtractField['type'], description: f.description })));
  }

  async function create() {
    setBusy(true); setError(null);
    try {
      const res = await api<{ task: { id: string } }>(`/api/workspaces/${workspaceId}/extractions`, {
        method: 'POST',
        body: { name, documentIds: docIds, fields },
      });
      onCreated(res.task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the extraction.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New extraction" width={620}>
      <ErrorBanner message={error} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Extraction name">
          <input className="input" placeholder="e.g. “Credit agreement terms — Q4”" value={name}
            onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>

        {tplData?.templates?.length ? (
          <div>
            <div className="nav-label" style={{ padding: 0 }}>Start from a template</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tplData.templates.map((t) => (
                <button key={t.id} className="btn btn-secondary btn-sm" onClick={() => useTemplate(t)}>
                  <FileText size={13} /> {t.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <Field label="Source documents" hint="Only processed documents can be extracted.">
          <div className="card" style={{ maxHeight: 180, overflowY: 'auto', padding: 6 }}>
            {(docData?.documents ?? []).length === 0 ? (
              <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                No processed documents yet — upload some first.
              </div>
            ) : docData!.documents.map((d) => (
              <label key={d.id} className="nav-item" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={docIds.includes(d.id)} style={{ accentColor: 'var(--blue)' }}
                  onChange={(e) => setDocIds(e.target.checked ? [...docIds, d.id] : docIds.filter((x) => x !== d.id))} />
                <span style={{ flex: 1, fontSize: 13 }}>{d.name}</span>
              </label>
            ))}
          </div>
        </Field>

        <div>
          <div className="nav-label" style={{ padding: 0, marginBottom: 6 }}>Fields to extract ({fields.length})</div>
          {fields.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '8px 0' }}>
              No fields yet — start from a template above, or add your own below.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {fields.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="input" style={{ flex: 1.4 }} placeholder="Label" value={f.label}
                    onChange={(e) => setFields(fields.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                  <select className="select" style={{ width: 110 }} value={f.type}
                    onChange={(e) => setFields(fields.map((x, j) => j === i ? { ...x, type: e.target.value as ExtractField['type'] } : x))}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="currency">Currency</option>
                    <option value="percent">Percent</option>
                    <option value="date">Date</option>
                  </select>
                  <button className="btn btn-ghost btn-sm" style={{ padding: '0 6px' }}
                    onClick={() => setFields(fields.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}
            onClick={() => setFields([...fields, { key: `field_${Date.now()}`, label: '', type: 'text' }])}>
            <Plus size={13} /> Add field
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={create}
            disabled={busy || !name.trim() || fields.length === 0 || fields.some((f) => !f.label.trim()) || docIds.length === 0}>
            {busy ? 'Starting…' : <><Play size={14} /> Run extraction</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Task detail with results review ───────────────────────────────
interface Result {
  id: string; fieldId: string; documentId: string; value: string | null; unit: string | null;
  confidence: number | null; status: string; page: number | null; sheet: string | null;
  cell: string | null; excerpt: string | null; flagged: boolean;
  field: { key: string; label: string; type: string };
  document: { id: string; name: string };
}

function TaskDetail({ taskId, onClose, canEdit, canReview }: {
  taskId: string | null; onClose: () => void; canEdit: boolean; canReview: boolean;
}) {
  const [editing, setEditing] = useState<Result | null>(null);
  const [editValue, setEditValue] = useState('');

  const { data, mutate } = useSWR(taskId, (id: string) =>
    api<{ task: { id: string; name: string; status: string; fields: { id: string; label: string }[]; results: Result[] } }>(`/api/extraction-tasks/${id}`),
    { refreshInterval: 12000 },
  );
  const task = data?.task;

  async function setReview(result: Result, patch: Partial<Pick<Result, 'status' | 'value' | 'flagged'>>) {
    await api(`/api/extraction-results/${result.id}`, { method: 'PATCH', body: patch });
    mutate();
  }

  return (
    <Modal open={!!taskId} onClose={onClose} title={task?.name ?? 'Extraction'} width={760}>
      {!task ? <LoadingBlock /> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span className={`badge ${task.status === 'COMPLETED' ? 'badge-success' : task.status === 'FAILED' ? 'badge-error' : 'badge-blue'}`}>
              {task.status}
            </span>
            <span className="card-sub">{task.results.length} values across {task.fields.length} fields</span>
            <a className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }}
              href={`${process.env.NEXT_PUBLIC_API_URL}/api/extraction-tasks/${task.id}/export?format=xlsx`}
              target="_blank" rel="noreferrer">
              <Download size={13} /> Export
            </a>
            {canEdit ? (
              <button className="btn btn-secondary btn-sm" onClick={async () => {
                await api(`/api/extraction-tasks/${task.id}/ingest-analytics`, { method: 'POST' });
              }}>
                <Sparkles size={13} /> Send to analytics
              </button>
            ) : null}
          </div>

          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>Field</th><th>Document</th><th>Value</th><th>Confidence</th><th>Source</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {task.results.map((r) => (
                  <tr key={r.id}>
                    <td className="strong">{r.field.label}</td>
                    <td style={{ fontSize: 12.5 }}>
                      <Link href={`/documents/${r.document.id}`} style={{ color: 'inherit' }}>{r.document.name}</Link>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>{r.value ?? '—'}</td>
                    <td><Confidence value={r.confidence} /></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {r.page ? `p.${r.page}` : r.sheet ? `${r.sheet}${r.cell ? ` ${r.cell}` : ''}` : '—'}
                    </td>
                    <td><span className={`badge ${RESULT_STATUS[r.status]?.cls ?? 'badge-neutral'}`}>{RESULT_STATUS[r.status]?.label ?? r.status}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.excerpt ? (
                        <button className="btn btn-ghost btn-sm" title="View evidence"
                          onClick={() => { setEditing({ ...r, value: r.value }); setEditValue(r.value ?? ''); }}>Evidence</button>
                      ) : null}
                      {canReview && r.status !== 'VERIFIED' ? (
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--success)' }}
                          onClick={() => setReview(r, { status: 'VERIFIED' })}>Verify</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Evidence / edit modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `${editing.field.label} — evidence` : ''} width={520}>
        {editing ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {editing.page ? <span className="badge badge-blue">Page {editing.page}</span> : null}
              {editing.sheet ? <span className="badge badge-blue">Sheet {editing.sheet}</span> : null}
              {editing.cell ? <span className="badge badge-neutral mono">{editing.cell}</span> : null}
              <Confidence value={editing.confidence} />
            </div>
            <div className="card" style={{ padding: 14, background: 'var(--sunken)', boxShadow: 'none', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 14 }}>
              {editing.excerpt ?? 'No excerpt captured.'}
            </div>
            {canReview ? (
              <>
                <Field label="Corrected value (optional)">
                  <input className="input" value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                </Field>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                  <button className="btn btn-danger btn-sm" onClick={() => { setReview(editing, { status: 'REJECTED' }); setEditing(null); }}>Reject</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setReview(editing, { value: editValue }); setEditing(null); }}>Save value</button>
                  <button className="btn btn-primary btn-sm" onClick={() => { setReview(editing, { value: editValue, status: 'VERIFIED' }); setEditing(null); }}>
                    Verify
                  </button>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </Modal>
    </Modal>
  );
}
