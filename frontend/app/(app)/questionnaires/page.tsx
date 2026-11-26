'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { FileSpreadsheet, Plus, Upload, ArrowRight, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import { EmptyState, Field, LoadingBlock, Modal, formatDate, timeAgo } from '../../../components/ui';

interface Q {
  id: string; title: string; description: string | null; status: string; source: string;
  createdAt: string; updatedAt: string;
  _count: { questions: number };
  answeredCount: number;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'badge-neutral' },
  in_progress: { label: 'In progress', cls: 'badge-blue' },
  completed: { label: 'Completed', cls: 'badge-success' },
};

export default function Questionnaires() {
  const { workspace, can } = useWorkspace();
  const wid = workspace?.workspace.id;
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [docIds, setDocIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { data, isLoading, mutate } = useSWR(
    wid ? `q-${wid}` : null,
    () => api<{ questionnaires: Q[] }>(`/api/workspaces/${wid}/questionnaires`),
  );
  const { data: docData } = useSWR(
    wid ? `qdocs-${wid}` : null,
    () => api<{ documents: { id: string; name: string; status: string }[] }>(`/api/workspaces/${wid}/documents?status=COMPLETED&take=200`),
  );

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ questionnaire: { id: string } }>(`/api/workspaces/${wid}/questionnaires`, {
        method: 'POST', body: { title, description, documentIds: docIds },
      });
      setCreateOpen(false);
      setTitle(''); setDescription(''); setDocIds([]);
      window.location.href = `/questionnaires/${res.questionnaire.id}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Diligence Questionnaires</div>
          <div className="page-desc">DDQs and portfolio questionnaires — import from Excel, build in-app, or let Lumen draft answers from your documents. Every answer carries evidence.</div>
        </div>
        {can('EDITOR') ? (
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> New questionnaire</button>
        ) : null}
      </div>

      {isLoading ? <LoadingBlock /> : !data || data.questionnaires.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FileSpreadsheet size={20} />}
            title="No questionnaires yet"
            sub="Create one from scratch, import questions from an Excel file, or start with a vendor security template."
            action={can('EDITOR') ? (
              <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> Create questionnaire</button>
            ) : undefined}
          />
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead><tr><th>Questionnaire</th><th>Source</th><th>Questions</th><th>Answered</th><th>Status</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              {data.questionnaires.map((q) => {
                const total = q._count.questions;
                const answered = q.answeredCount;
                const pct = total ? Math.round((answered / total) * 100) : 0;
                return (
                  <tr key={q.id}>
                    <td className="strong">
                      <Link href={`/questionnaires/${q.id}`} style={{ color: 'inherit' }}>{q.title}</Link>
                      {q.description ? (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{q.description}</div>
                      ) : null}
                    </td>
                    <td>{q.source === 'imported' ? 'Excel import' : 'In-app'}</td>
                    <td>{total}</td>
                    <td style={{ minWidth: 120 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                        {answered}/{total}
                        <div className="meter" style={{ flex: 1 }}><i style={{ width: `${pct}%` }} /></div>
                      </div>
                    </td>
                    <td><span className={`badge ${STATUS[q.status]?.cls ?? 'badge-neutral'}`}>{STATUS[q.status]?.label ?? q.status}</span></td>
                    <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{timeAgo(q.updatedAt)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Link href={`/questionnaires/${q.id}`} className="btn btn-ghost btn-sm">Open <ArrowRight size={13} /></Link>
                      {can('EDITOR') ? (
                        <button className="btn btn-ghost btn-sm" title="Delete questionnaire" style={{ color: '#c0392b' }}
                          onClick={async () => {
                            if (!window.confirm(`Delete questionnaire "${q.title}"? Its questions and answers are removed. This cannot be undone.`)) return;
                            await api(`/api/questionnaires/${q.id}`, { method: 'DELETE' });
                            mutate();
                          }}>
                          <Trash2 size={13} /> Delete
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New questionnaire">
        <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Title">
            <input className="input" required maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. “Vendor security assessment 2026”" autoFocus />
          </Field>
          <Field label="Description (optional)">
            <textarea className="textarea" maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What this questionnaire is for" />
          </Field>
          <Field label="Answer from (optional)" hint="Pick data-room documents the AI may answer from — none selected means all workspace documents.">
            <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 4 }}>
              {(docData?.documents ?? []).length === 0 ? (
                <div style={{ padding: 8, fontSize: 12.5, color: 'var(--text-muted)' }}>No processed documents yet — upload some in the Data Room.</div>
              ) : docData!.documents.map((d) => (
                <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', fontSize: 13, borderRadius: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={docIds.includes(d.id)} onChange={(e) =>
                    setDocIds(e.target.checked ? [...docIds, d.id] : docIds.filter((x) => x !== d.id))} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                </label>
              ))}
            </div>
          </Field>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            After creating, you can import questions from Excel or add them manually.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy} type="submit"><Plus size={14} /> Create</button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
