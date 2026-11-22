'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowLeft, Plus, Upload, Download, Sparkles, Trash2, Check, X, AlertTriangle, FileSpreadsheet,
} from 'lucide-react';
import { api, API_BASE } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import {
  Confidence, EmptyState, ErrorBanner, Field, LoadingBlock, Modal, timeAgo,
} from '../../../../components/ui';

interface Answer {
  id: string; draftAnswer: string | null; finalAnswer: string | null;
  confidence: number | null; status: string; comment: string | null;
  evidence: { id: string; documentId: string; page: number | null; kind: string; tableRef: string | null; excerpt: string; document: { name: string } }[];
}
interface Question {
  id: string; section: string; type: string; prompt: string;
  options: string[] | null; required: boolean; order: number;
  answer: Answer | null;
}
interface QDetail {
  questionnaire: { id: string; title: string; description: string | null; status: string; source: string };
  questions: Question[];
  rules: { requireCitations: boolean; lowConfidenceThreshold: number; autoApproveHighConfidence: boolean };
}

const ANSWER_STATUS: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: 'Approved', cls: 'badge-success' },
  AI_DRAFTED: { label: 'AI drafted', cls: 'badge-blue' },
  NEEDS_REVIEW: { label: 'Needs review', cls: 'badge-warning' },
  REJECTED: { label: 'Rejected', cls: 'badge-error' },
  MISSING: { label: 'No answer', cls: 'badge-neutral' },
};

export default function QuestionnaireDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useWorkspace();

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [evidence, setEvidence] = useState<Answer['evidence'][number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, mutate } = useSWR(id, (qid: string) => api<QDetail>(`/api/questionnaires/${qid}`), {
    refreshInterval: 15000,
  });
  const q = data?.questionnaire;
  const questions = data?.questions ?? [];
  const sections = [...new Set(questions.map((x) => x.section))];

  async function draft() {
    setDrafting(true); setError(null);
    try {
      await api(`/api/questionnaires/${id}/generate`, { method: 'POST' });
      // Answers stream in as the worker processes; poll handles the rest.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start drafting.');
    } finally {
      setDrafting(false);
    }
  }

  async function review(answerId: string, status: string, finalAnswer?: string) {
    await api(`/api/answers/${answerId}`, { method: 'PATCH', body: { status, ...(finalAnswer !== undefined ? { finalAnswer } : {}) } });
    mutate();
  }

  if (isLoading) return <main className="content"><LoadingBlock /></main>;
  if (!q) {
    return <main className="content"><EmptyState icon={<FileSpreadsheet size={20} />} title="Questionnaire not found"
      action={<Link href="/questionnaires" className="btn btn-secondary btn-sm"><ArrowLeft size={13} /> Back</Link>} /></main>;
  }

  const answeredCount = questions.filter((x) => x.answer && ['AI_DRAFTED', 'APPROVED'].includes(x.answer.status)).length;

  return (
    <main className="content">
      <Link href="/questionnaires" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 10, color: 'var(--text-muted)' }}>
        <ArrowLeft size={13} /> Questionnaires
      </Link>
      <div className="page-head">
        <div>
          <div className="page-title">{q.questionnaire.title}</div>
          <div className="page-desc">
            {questions.length} questions · {answeredCount} answered
            {data?.rules?.lowConfidenceThreshold
              ? ` · answers under ${Math.round(data.rules.lowConfidenceThreshold * 100)}% confidence require review`
              : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <a className="btn btn-secondary" href={`${API_BASE}/api/questionnaires/${id}/export`} target="_blank" rel="noreferrer">
            <Download size={14} /> Export
          </a>
          {can('EDITOR') ? (
            <>
              <button className="btn btn-secondary" onClick={() => setImportOpen(true)}><Upload size={14} /> Import Excel</button>
              <button className="btn btn-secondary" onClick={() => setAddOpen(true)}><Plus size={14} /> Add question</button>
              <button className="btn btn-primary" onClick={draft} disabled={drafting}>
                <Sparkles size={14} /> {drafting ? 'Drafting…' : 'Draft answers with AI'}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <ErrorBanner message={error} />

      {questions.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FileSpreadsheet size={20} />}
            title="No questions yet"
            sub="Import from an Excel file (Section, Question, Type, Options, Required) or add questions manually."
            action={can('EDITOR') ? (
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => setImportOpen(true)}><Upload size={14} /> Import Excel</button>
                <button className="btn btn-primary" onClick={() => setAddOpen(true)}><Plus size={14} /> Add question</button>
              </div>
            ) : undefined}
          />
        </div>
      ) : (
        sections.map((section) => (
          <div className="card" key={section} style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title">{section}</div>
              <span className="card-sub">
                {questions.filter((x) => x.section === section).length} questions
              </span>
            </div>
            {questions.filter((x) => x.section === section).map((question) => (
              <div key={question.id} style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 560, lineHeight: 1.5 }}>{question.prompt}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                      {question.type.replace('_', ' ')}{question.required ? ' · required' : ' · optional'}
                    </div>
                  </div>
                  {question.answer ? (
                    <span className={`badge ${ANSWER_STATUS[question.answer.status]?.cls ?? 'badge-neutral'}`}>
                      {ANSWER_STATUS[question.answer.status]?.label ?? question.answer.status}
                    </span>
                  ) : (
                    <span className="badge badge-neutral">Unanswered</span>
                  )}
                  {can('EDITOR') ? (
                    <button className="btn btn-ghost btn-sm" style={{ padding: '0 5px', color: 'var(--text-muted)' }}
                      onClick={async () => { await api(`/api/questions/${question.id}`, { method: 'DELETE' }); mutate(); }}>
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>

                {question.answer ? (
                  <div style={{ marginTop: 12, paddingLeft: 14, borderLeft: '2px solid var(--border)' }}>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                      {question.answer.finalAnswer ?? question.answer.draftAnswer ?? (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No answer found — review manually.</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
                      <Confidence value={question.answer.confidence} />
                      {question.answer.evidence.map((ev) => (
                        <button key={ev.id} className="cite-chip" onClick={() => setEvidence(ev)}>
                          {ev.document.name.length > 24 ? `${ev.document.name.slice(0, 22)}…` : ev.document.name}
                          {ev.page ? ` · p.${ev.page}` : ''}
                        </button>
                      ))}
                      {can('REVIEWER') && question.answer.status !== 'APPROVED' ? (
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                          <button className="btn btn-danger btn-sm" onClick={() => review(question.answer!.id, 'REJECTED')}><X size={13} /> Reject</button>
                          <button className="btn btn-primary btn-sm" onClick={() => review(question.answer!.id, 'APPROVED')}><Check size={13} /> Approve</button>
                        </span>
                      ) : null}
                      {question.answer.status === 'MISSING' && !question.answer.draftAnswer ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--warning)' }}>
                          <AlertTriangle size={12} /> No supporting evidence found in workspace documents.
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))
      )}

      {/* Add question modal */}
      <AddQuestionModal open={addOpen} onClose={() => setAddOpen(false)} questionnaireId={id} onAdded={() => { setAddOpen(false); mutate(); }} />

      {/* Import modal */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import questions from Excel">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.6 }}>
          Upload an .xlsx or .csv file with columns:
          <span className="mono" style={{ display: 'block', marginTop: 6, padding: '8px 10px', background: 'var(--sunken)', borderRadius: 'var(--r-sm)' }}>
            Section, Question, Type (yes_no | multiple_choice | text), Options (semicolon-separated), Required (true/false)
          </span>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const fd = new FormData();
          fd.append('file', file);
          try {
            const res = await api<{ imported: number }>(`/api/questionnaires/${id}/import`, { method: 'POST', body: fd });
            setImportOpen(false);
              mutate();
            void res;
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Import failed.');
          }
        }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setImportOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()}><Upload size={14} /> Choose file</button>
        </div>
      </Modal>

      {/* Evidence modal */}
      <Modal open={!!evidence} onClose={() => setEvidence(null)} title="Evidence" width={520}>
        {evidence ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {evidence.page ? <span className="badge badge-blue">Page {evidence.page}</span> : null}
              <span className="badge badge-neutral">{evidence.kind}</span>
            </div>
            <div className="card" style={{ padding: 14, background: 'var(--sunken)', boxShadow: 'none', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {evidence.excerpt}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <Link href={`/documents/${evidence.documentId}`} className="btn btn-secondary" onClick={() => setEvidence(null)}>
                Open in document viewer
              </Link>
            </div>
          </>
        ) : null}
      </Modal>
    </main>
  );
}

function AddQuestionModal({ open, onClose, questionnaireId, onAdded }: {
  open: boolean; onClose: () => void; questionnaireId: string; onAdded: () => void;
}) {
  const [section, setSection] = useState('General');
  const [type, setType] = useState('text');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(true);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/questionnaires/${questionnaireId}/questions`, {
        method: 'POST',
        body: {
          section, type, prompt, required,
          ...(type === 'multiple_choice' && options.trim()
            ? { options: options.split(';').map((o) => o.trim()).filter(Boolean) }
            : {}),
        },
      });
      setPrompt(''); setOptions('');
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add question">
      <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Section">
            <input className="input" value={section} maxLength={80} onChange={(e) => setSection(e.target.value)} required />
          </Field>
          <Field label="Type">
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="text">Text</option>
              <option value="yes_no">Yes / No</option>
              <option value="multiple_choice">Multiple choice</option>
            </select>
          </Field>
        </div>
        <Field label="Question">
          <textarea className="textarea" required maxLength={2000} value={prompt} onChange={(e) => setPrompt(e.target.value)} autoFocus />
        </Field>
        {type === 'multiple_choice' ? (
          <Field label="Options" hint="Separate with semicolons — e.g. Yes; No; Not applicable">
            <input className="input" value={options} onChange={(e) => setOptions(e.target.value)} />
          </Field>
        ) : null}
        <label style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'center', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} style={{ accentColor: 'var(--blue)' }} />
          Required
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !prompt.trim()} type="submit"><Plus size={14} /> Add question</button>
        </div>
      </form>
    </Modal>
  );
}
