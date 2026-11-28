'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { Upload, FileText, Plus, X, FolderOpen, Trash2, RotateCcw, Mail, Copy, Check, Building2, Inbox, LayoutGrid } from 'lucide-react';
import { api, qs } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import {
  DocStatusBadge, DemoTag, EmptyState, ErrorBanner, Field, LoadingBlock, Modal,
  formatBytes, timeAgo,
} from '../../../components/ui';

interface Doc {
  id: string; name: string; fileType: string; sizeBytes: number; pageCount: number | null;
  status: string; error: string | null; isDemo: boolean; uploadedAt: string;
  source: string; emailFrom: string | null; emailSubject: string | null; assignmentStatus: string | null;
  collection: { id: string; name: string } | null;
  entity: { id: string; name: string } | null;
  owner: { firstName: string; lastName: string } | null;
}

interface Collection { id: string; name: string; description: string | null; parentId: string | null; entityId?: string | null; kind?: string; periodKey?: string | null; _count: { documents: number } }
interface TreeFolder { id: string; name: string; parentId: string | null; entityId: string | null; kind: string; periodKey: string | null; documentCount: number }
interface TreeEntity { id: string; name: string; parentId: string | null; documentCount: number; package: { period: string; expected: number; received: number } | null }
interface TreeData { entities: TreeEntity[]; folders: TreeFolder[]; unassigned: { total: number; needsConfirmation: number } }

// What the right-hand column shows, driven by the tree on the left.
type Selection = { kind: 'all' } | { kind: 'unassigned' } | { kind: 'entity'; entityId: string } | { kind: 'folder'; collectionId: string };

function folderPath(cols: Collection[], id: string | null): string {
  if (!id) return '';
  const byId = new Map(cols.map((c) => [c.id, c]));
  const parts: string[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(' / ');
}

// Row style shared by the left-panel tree buttons.
function rowStyle(active: boolean): CSSProperties {
  return {
    width: '100%', border: 'none', background: active ? 'var(--sunken)' : 'transparent', cursor: 'pointer',
    color: 'inherit', padding: '5px 8px', font: 'inherit', fontSize: 13, borderRadius: 6,
    display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left',
  };
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ border: 'none', background: 'transparent', textAlign: 'left', padding: '8px 10px', font: 'inherit', fontSize: 13, cursor: 'pointer', borderRadius: 6, color: 'inherit' }}>{label}</button>
  );
}

// Suggest a company for an emailed document: does the sender address or the
// subject line mention one? Longest names are checked first so "Acme Industrial
// Corp" wins over "Acme".
function suggestEntity(doc: Doc, entities: TreeEntity[]): TreeEntity | null {
  const hay = `${doc.emailFrom ?? ''} ${doc.emailSubject ?? ''}`.toLowerCase();
  if (!hay) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const e of [...entities].sort((a, b) => b.name.length - a.name.length)) {
    const n = norm(e.name);
    if (n && (hay.includes(e.name.toLowerCase()) || hay.includes(n))) return e;
  }
  return null;
}

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';

export default function Library() {
  const router = useRouter();
  const params = useSearchParams();
  const { workspace, can } = useWorkspace();
  const wid = workspace?.workspace.id;

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('uploadedAt');

  // Data Room selection — what the right-hand column shows.
  const [sel, setSel] = useState<Selection>({ kind: 'all' });

  const [uploadOpen, setUploadOpen] = useState(params.get('upload') === '1');
  const [addOpen, setAddOpen] = useState(false); // the “Add” menu
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionParent, setNewCollectionParent] = useState('');
  const [newCollectionEntity, setNewCollectionEntity] = useState('');
  const [newCollectionKind, setNewCollectionKind] = useState<'CUSTOM' | 'PERIOD'>('CUSTOM');
  const [newCollectionPeriod, setNewCollectionPeriod] = useState('');
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);
  // Folder import: the staging modal + which pending batch to resume.
  const [importOpen, setImportOpen] = useState(false);
  const [resumeBatch, setResumeBatch] = useState<string | null>(null);

  const { data, isLoading, mutate, error } = useSWR(key, (k: string) => api<{ documents: Doc[]; meta: { total: number; page: number; pages: number } }>(k), {
    refreshInterval: 8000,
  });
  const { data: collData, mutate: refetchColls } = useSWR(
    wid ? `/api/workspaces/${wid}/collections` : null,
    (k: string) => api<{ collections: Collection[] }>(k),
  );
  // Data Room tree — companies, subsidiaries, folders, unassigned counts.
  const { data: treeData, isLoading: treeLoading, mutate: refetchTree } = useSWR(
    wid ? `/api/workspaces/${wid}/dataroom/tree` : null,
    (k: string) => api<TreeData>(k),
  );
  // Staged folder imports waiting for a confirm decision — listed in Add.
  const { data: pendingImports, mutate: refetchImports } = useSWR(
    wid ? `imports-${wid}` : null,
    (k: string) => api<{ batches: { id: string; name: string; createdAt: string; files: number }[] }>(`/api/workspaces/${wid}/documents/folder-import`),
  );
  // Workspace detail — carries the dedicated inbound email address.
  const { data: wsData } = useSWR(
    wid ? `/api/workspaces/${wid}` : null,
    (k: string) => api<{ workspace: { name: string; inboundEmail: string | null } }>(k),
  );
  const inboundEmail = wsData?.workspace.inboundEmail ?? null;
  const [copied, setCopied] = useState(false);
  const selectedEntity = sel.kind === 'entity' ? treeData?.entities.find((e) => e.id === sel.entityId) ?? null : null;
  // Folders for the current scope: company-scoped under a selected company, workspace folders otherwise.
  const visibleFolders = sel.kind === 'entity'
    ? (treeData?.folders ?? []).filter((f) => f.entityId === sel.entityId)
    : (treeData?.folders ?? []).filter((f) => !f.entityId);
  const entityFolders = (entityId: string) => {
    const keyOf = (f: TreeFolder) => (f.kind === 'PERIOD' && f.periodKey ? 0 : 1);
    return (treeData?.folders ?? [])
      .filter((f) => f.entityId === entityId)
      .sort((a, b) => keyOf(a) - keyOf(b) || (b.periodKey ?? '').localeCompare(a.periodKey ?? '') || a.name.localeCompare(b.name));
  };
  const hasFilters = Boolean(q || status || sel.kind !== 'all');
  const selEntity = sel.kind === 'entity' ? sel.entityId : '';
  const selFolder = sel.kind === 'folder' ? sel.collectionId : '';
  const entityIdParam = sel.kind === 'unassigned' ? 'none' : selEntity;
  const key = wid ? `/api/workspaces/${wid}/documents${qs({ q, collectionId: selFolder, entityId: entityIdParam, status, sort })}` : null;

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Data Room</div>
          <div className="page-desc">
            {sel.kind === 'unassigned'
              ? `Unassigned documents${treeData && treeData.unassigned.needsConfirmation > 0 ? ` — ${treeData.unassigned.needsConfirmation} need confirmation` : ' — tag them to a company or file them into a folder'}`
              : selectedEntity
                ? `${selectedEntity.name} — documents, folders and package status`
                : data ? `${data.meta.total} document${data.meta.total === 1 ? '' : 's'} in ${workspace?.workspace.name}` : 'All workspace documents'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, position: 'relative' }}>
          {can('EDITOR') ? (
            <>
              <button className="btn btn-secondary" onClick={() => setAddOpen(!addOpen)}><Plus size={15} /> Add</button>
              {addOpen ? (
                <div
                  style={{
                    position: 'absolute', top: '100%', right: 0, zIndex: 30, background: 'var(--card, #fff)',
                    border: '1px solid var(--border, #e5e5e5)', borderRadius: 10,
                    boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 220, padding: 6,
                    display: 'flex', flexDirection: 'column', gap: 2,
                  }}
                >
                  <MenuItem label="New company" onClick={() => { setAddOpen(false); setAddCompanyOpen(true); }} />
                  <MenuItem label="Add subsidiary" onClick={() => { setAddOpen(false); setAddCompanyOpen(true); }} />
                  <MenuItem label="New folder" onClick={() => { setAddOpen(false); setNewCollectionOpen(true); }} />
                  <MenuItem label="Upload documents" onClick={() => { setAddOpen(false); setUploadOpen(true); }} />
                  <MenuItem label="Import folder" onClick={() => { setAddOpen(false); setResumeBatch(null); setImportOpen(true); }} />
                  {pendingImports?.batches?.length ? (
                    <div style={{ borderTop: '1px solid var(--border, #e5e5e5)', marginTop: 4, paddingTop: 4 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 10px 4px' }}>Staged imports — confirm or discard</div>
                      {pendingImports.batches.map((b) => (
                        <MenuItem key={b.id} label={`“${b.name}” · ${b.files} files`} onClick={() => { setAddOpen(false); setResumeBatch(b.id); setImportOpen(true); }} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
          <button className="btn btn-primary" onClick={() => setUploadOpen(true)} disabled={!can('EDITOR')}><Upload size={15} /> Upload</button>
        </div>
      </div>

      <ErrorBanner message={error ? 'Could not load documents.' : null} />

      {/* Data Room layout: company/folder tree on the left, documents on the right. */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        <aside style={{ width: 264, flexShrink: 0, position: 'sticky', top: 14 }}>
          <div className="card" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Unassigned inbox — documents with no company yet */}
            <button onClick={() => setSel({ kind: 'unassigned' })} style={rowStyle(sel.kind === 'unassigned')}>
              <Inbox size={14} color={sel.kind === 'unassigned' ? 'var(--accent)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>Unassigned</span>
              {treeData && treeData.unassigned.total > 0 ? (
                <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: 'var(--accent)', color: '#fff' }}>{treeData.unassigned.total}</span>
              ) : null}
              {treeData && treeData.unassigned.needsConfirmation > 0 ? (
                <span title={`${treeData.unassigned.needsConfirmation} emailed document${treeData.unassigned.needsConfirmation === 1 ? '' : 's'} waiting to be confirmed`} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: 'rgba(180,120,0,.15)', color: '#b47800' }}>{treeData.unassigned.needsConfirmation}</span>
              ) : null}
            </button>
            <button onClick={() => setSel({ kind: 'all' })} style={rowStyle(sel.kind === 'all')}>
              <LayoutGrid size={14} color={sel.kind === 'all' ? 'var(--accent)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>All documents</span>
            </button>

            {/* Companies → subsidiaries → folders */}
            {treeLoading && !treeData ? <LoadingBlock label="Loading companies…" /> : null}
            {(treeData?.entities ?? []).filter((e) => !e.parentId).map((co) => (
              <div key={co.id}>
                <button
                  onClick={() => setSel(sel.kind === 'entity' && sel.entityId === co.id ? { kind: 'all' } : { kind: 'entity', entityId: co.id })}
                  style={rowStyle(sel.kind === 'entity' && sel.entityId === co.id)}
                >
                  <Building2 size={14} color={sel.kind === 'entity' && sel.entityId === co.id ? 'var(--accent)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{co.documentCount}</span>
                  {co.package ? (
                    <span
                      title={`${co.package.period} package: ${co.package.received}/${co.package.expected} received`}
                      style={{
                        fontSize: 10.5, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap',
                        background: co.package.received >= co.package.expected ? 'rgba(46,160,67,.15)' : 'rgba(180,120,0,.15)',
                        color: co.package.received >= co.package.expected ? '#2ea043' : '#b47800',
                      }}
                    >
                      {co.package.received}/{co.package.expected}
                    </span>
                  ) : null}
                </button>
                {/* Subsidiaries — indented under their parent */}
                {(treeData?.entities ?? []).filter((s) => s.parentId === co.id).map((s) => (
                  <button key={s.id} onClick={() => setSel({ kind: 'entity', entityId: s.id })} style={{ ...rowStyle(sel.kind === 'entity' && sel.entityId === s.id), paddingLeft: 26 }}>
                    <Building2 size={12} color={sel.kind === 'entity' && sel.entityId === s.id ? 'var(--accent)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.documentCount}</span>
                  </button>
                ))}
                {/* Folders scoped to the selected company — period folders first, then custom */}
                {sel.kind === 'entity' && sel.entityId === co.id
                  ? entityFolders(co.id).map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setSel(sel.kind === 'folder' && sel.collectionId === f.id ? { kind: 'entity', entityId: co.id } : { kind: 'folder', collectionId: f.id })}
                        style={{ ...rowStyle(sel.kind === 'folder' && sel.collectionId === f.id), paddingLeft: 26 }}
                      >
                        <FolderOpen size={12} color={sel.kind === 'folder' && sel.collectionId === f.id ? 'var(--accent)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.kind === 'PERIOD' ? f.periodKey : f.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.documentCount}</span>
                      </button>
                    ))
                  : null}
              </div>
            ))}

            {/* Workspace-level folders (unscoped) — shown when no company is selected */}
            {sel.kind !== 'entity' && visibleFolders.length > 0 ? (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', padding: '8px 8px 2px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Folders</div>
                {visibleFolders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setSel(sel.kind === 'folder' && sel.collectionId === f.id ? { kind: 'all' } : { kind: 'folder', collectionId: f.id })}
                    style={rowStyle(sel.kind === 'folder' && sel.collectionId === f.id)}
                  >
                    <FolderOpen size={13} color={sel.kind === 'folder' && sel.collectionId === f.id ? 'var(--accent)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.documentCount}</span>
                  </button>
                ))}
              </>
            ) : null}

            {can('EDITOR') ? (
              <button className="btn btn-secondary btn-sm" style={{ marginTop: 8, alignSelf: 'flex-start' }} onClick={() => setNewCollectionOpen(true)}>
                <Plus size={13} /> New folder
              </button>
            ) : null}
          </div>
        </aside>

        <section style={{ flex: 1, minWidth: 0 }}>
          {/* Company strip — who am I looking at */}
          {selectedEntity ? (
            <div className="card" style={{ padding: '12px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Building2 size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>{selectedEntity.name}</div>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{selectedEntity.documentCount} document{selectedEntity.documentCount === 1 ? '' : 's'}</span>
              {selectedEntity.package ? (
                <span
                  style={{
                    fontSize: 12, padding: '2px 8px', borderRadius: 999,
                    background: selectedEntity.package.received >= selectedEntity.package.expected ? 'rgba(46,160,67,.15)' : 'rgba(180,120,0,.15)',
                    color: selectedEntity.package.received >= selectedEntity.package.expected ? '#2ea043' : '#b47800',
                  }}
                >
                  {selectedEntity.package.period} package {selectedEntity.package.received}/{selectedEntity.package.expected}
                </span>
              ) : null}
              <Link className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} href={`/borrowers/${selectedEntity.id}`}>Open company page</Link>
            </div>
          ) : null}

          {/* Email-in banner — attachments land unassigned, ready to file into a company */}
          {inboundEmail ? (
            <div className="card" style={{ padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Mail size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>Email documents straight into this data room</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  Send files as attachments to{' '}
                  <span className="mono" style={{ userSelect: 'all' }}>{inboundEmail}</span>{' '}
                  — they arrive under “Unassigned”, ready to file into company folders.
                </div>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inboundEmail);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch { /* clipboard unavailable */ }
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy address'}
              </button>
            </div>
          ) : null}

          {/* Filters */}
          <div className="card" style={{ padding: '10px 12px', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 260 }} placeholder="Search by name…" value={q}
              onChange={(e) => setQ(e.target.value)} />
            <select
              className="select"
              style={{ width: 190 }}
              value={sel.kind === 'folder' ? sel.collectionId : ''}
              onChange={(e) => setSel(e.target.value ? { kind: 'folder', collectionId: e.target.value } : sel.kind === 'folder' ? { kind: 'all' } : sel)}
            >
              <option value="">{sel.kind === 'entity' ? 'All company folders' : 'All folders'}</option>
              {visibleFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              <option value="COMPLETED">Ready</option>
              <option value="PROCESSING">Processing</option>
              <option value="QUEUED">Queued</option>
              <option value="FAILED">Failed</option>
            </select>
            <select className="select" style={{ width: 160, marginLeft: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="uploadedAt">Newest first</option>
              <option value="name">Name A–Z</option>
              <option value="sizeBytes">Largest</option>
            </select>
          </div>

      {/* Table */}
      <div className="card">
        {isLoading && !data ? (
          <LoadingBlock label="Loading documents…" />
        ) : !data || data.documents.length === 0 ? (
          <EmptyState
            icon={<FileText size={20} />}
            title={hasFilters ? 'No documents match these filters' : 'No documents yet'}
            sub={hasFilters
              ? 'Try clearing a filter or changing the search term.'
              : 'Upload PDFs, Word, Excel, or CSV files. Lumen extracts text, tables, and structure automatically.'}
            action={!hasFilters && can('EDITOR') ? (
              <button className="btn btn-primary" onClick={() => setUploadOpen(true)}><Upload size={15} /> Upload documents</button>
            ) : undefined}
          />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Document</th><th>Company</th><th>Collection</th><th>Pages</th><th>Size</th><th>Status</th><th>Uploaded</th><th></th></tr>
            </thead>
            <tbody>
              {(sel.kind === 'unassigned'
                ? [...data.documents].sort((a, b) => (b.assignmentStatus === 'NEEDS_CONFIRMATION' ? 1 : 0) - (a.assignmentStatus === 'NEEDS_CONFIRMATION' ? 1 : 0))
                : data.documents
              ).map((doc) => (
                <tr key={doc.id}>
                  <td className="strong">
                    <Link href={`/documents/${doc.id}`} style={{ color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <FileText size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340, display: 'inline-block' }}>{doc.name}</span>
                    </Link>
                    {doc.isDemo ? <span style={{ marginLeft: 7 }}><DemoTag /></span> : null}
                    {doc.source === 'EMAIL' ? (
                      <span
                        title={`${doc.emailFrom ? `From ${doc.emailFrom} · ` : ''}${doc.emailSubject ?? 'Received via email'}`}
                        style={{ marginLeft: 7, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--sunken)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                      >
                        <Mail size={10} /> Email
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {sel.kind === 'unassigned' && doc.source === 'EMAIL' && doc.assignmentStatus === 'NEEDS_CONFIRMATION' && can('EDITOR') && !doc.isDemo ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                        {(() => {
                          const sug = suggestEntity(doc, treeData?.entities ?? []);
                          return sug ? (
                            <button
                              className="btn btn-primary btn-sm"
                              title={`Tag to ${sug.name} and file it into its current-quarter folder`}
                              onClick={async () => {
                                await api(`/api/workspaces/${wid}/borrowers/tag-document`, { method: 'POST', body: { documentId: doc.id, entityId: sug.id, autoFile: true } });
                                mutate(); refetchTree();
                              }}
                            >
                              <Building2 size={12} /> File to {sug.name}
                            </button>
                          ) : (
                            <span style={{ fontSize: 11.5, color: '#b47800' }}>Needs confirmation</span>
                          );
                        })()}
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Keep unassigned; stop asking"
                          onClick={async () => {
                            await api(`/api/workspaces/${wid}/documents/${doc.id}`, { method: 'PATCH', body: { assignmentStatus: 'DISMISSED' } });
                            mutate();
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : null}
                    {can('EDITOR') && !doc.isDemo ? (
                      <select
                        className="select"
                        style={{ fontSize: 12, padding: '2px 6px', maxWidth: 170 }}
                        value={doc.entity?.id ?? ''}
                        title="Tag to company"
                        onChange={async (e) => {
                          await api(`/api/workspaces/${wid}/borrowers/tag-document`, { method: 'POST', body: { documentId: doc.id, entityId: e.target.value || null } });
                          mutate(); refetchTree();
                        }}
                      >
                        <option value="">Unassigned</option>
                        {(treeData?.entities ?? []).map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
                      </select>
                    ) : (doc.entity?.name ?? <span style={{ color: 'var(--text-muted)' }}>—</span>)}
                  </td>
                  <td>
                    {can('EDITOR') && !doc.isDemo ? (
                      <select
                        className="select"
                        style={{ fontSize: 12, padding: '2px 6px', maxWidth: 170 }}
                        value={doc.collection?.id ?? ''}
                        title="Move to folder"
                        onChange={async (e) => {
                          await api(`/api/workspaces/${wid}/documents/${doc.id}`, { method: 'PATCH', body: { collectionId: e.target.value || null } });
                          mutate(); refetchColls();
                        }}
                      >
                        <option value="">—</option>
                        {(collData?.collections ?? []).map((c) => <option key={c.id} value={c.id}>{folderPath(collData?.collections ?? [], c.id)}</option>)}
                      </select>
                    ) : (doc.collection?.name ?? <span style={{ color: 'var(--text-muted)' }}>—</span>)}
                  </td>
                  <td className="mono" style={{ fontSize: 12.5 }}>{doc.pageCount ?? '—'}</td>
                  <td style={{ fontSize: 12.5 }}>{formatBytes(doc.sizeBytes)}</td>
                  <td><DocStatusBadge status={doc.status} /></td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{timeAgo(doc.uploadedAt)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link className="btn btn-ghost btn-sm" href={`/documents/${doc.id}`} title="Open document details">
                      Details
                    </Link>
                    {can('EDITOR') && !doc.isDemo ? (
                      <>
                        {doc.status === 'FAILED' ? (
                          <button className="btn btn-ghost btn-sm" title="Retry processing"
                            onClick={async () => { await api(`/api/workspaces/${wid}/documents/${doc.id}/retry`, { method: 'POST' }); mutate(); }}>
                            <RotateCcw size={13} /> Retry
                          </button>
                        ) : null}
                        <button className="btn btn-ghost btn-sm" title="Delete document" style={{ color: '#c0392b' }}
                          onClick={async () => {
                            if (!window.confirm(`Delete "${doc.name}"? This removes the file, its analysis, and chat history for this document. This cannot be undone.`)) return;
                            await api(`/api/workspaces/${wid}/documents/${doc.id}`, { method: 'DELETE' });
                            mutate();
                          }}>
                          <Trash2 size={13} /> Delete
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

        </section>
      </div>

      {/* Upload modal */}
      <UploadModal
        open={uploadOpen}
        onClose={() => { setUploadOpen(false); router.replace('/library'); }}
        workspaceId={wid}
        collections={collData?.collections ?? []}
        defaultCollection={sel.kind === 'folder' ? sel.collectionId : ''}
        onUploaded={() => { mutate(); refetchColls(); }}
      />

      {/* Folder import modal — staged with a preview + confirm gate */}
      <ImportFolderModal
        open={importOpen}
        onClose={() => { setImportOpen(false); setResumeBatch(null); refetchImports(); }}
        workspaceId={wid}
        entities={treeData?.entities ?? []}
        collections={collData?.collections ?? []}
        resumeBatchId={resumeBatch}
        onDone={() => { mutate(); refetchColls(); refetchTree(); refetchImports(); }}
      />

      {/* New folder modal — custom or period folder, optionally scoped to a company */}
      <Modal open={newCollectionOpen} onClose={() => setNewCollectionOpen(false)} title="New folder">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newCollectionName.trim() || !wid) return;
            try {
              await api(`/api/workspaces/${wid}/collections`, {
                method: 'POST',
                body: {
                  name: newCollectionName.trim(),
                  parentId: newCollectionParent || null,
                  entityId: newCollectionEntity || null,
                  kind: newCollectionKind,
                  periodKey: newCollectionKind === 'PERIOD' ? newCollectionPeriod.trim() : null,
                },
              });
              setNewCollectionName('');
              setNewCollectionParent('');
              setNewCollectionEntity('');
              setNewCollectionPeriod('');
              setNewCollectionKind('CUSTOM');
              setNewCollectionOpen(false);
              refetchColls();
              refetchTree();
              mutate();
            } catch (err) {
              window.alert(err instanceof Error ? err.message : 'Could not create folder.');
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <Field label="Folder name" hint="e.g. “Financial statements” or “Vendor contracts”.">
            <input className="input" required maxLength={60} value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)} autoFocus />
          </Field>
          <Field label="Company (optional)" hint="Scope this folder to a company or subsidiary — it then lives under that company in the tree.">
            <select className="select" value={newCollectionEntity} onChange={(e) => setNewCollectionEntity(e.target.value)}>
              <option value="">No company (workspace folder)</option>
              {(treeData?.entities ?? []).map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
            </select>
          </Field>
          {newCollectionEntity ? (
            <Field label="Folder type">
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={`btn btn-sm ${newCollectionKind === 'CUSTOM' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setNewCollectionKind('CUSTOM')}>Custom</button>
                <button type="button" className={`btn btn-sm ${newCollectionKind === 'PERIOD' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setNewCollectionKind('PERIOD')}>Quarter</button>
              </div>
            </Field>
          ) : null}
          {newCollectionEntity && newCollectionKind === 'PERIOD' ? (
            <Field label="Period" hint="Which quarter these documents belong to, e.g. Q3 2026.">
              <input className="input" placeholder="Q3 2026" pattern="^Q[1-4]\\s?\\d{4}$" required
                value={newCollectionPeriod} onChange={(e) => setNewCollectionPeriod(e.target.value)} />
            </Field>
          ) : null}
          <Field label="Inside folder (optional)" hint="Create it inside another folder to build a nested structure.">
            <select className="select" value={newCollectionParent} onChange={(e) => setNewCollectionParent(e.target.value)}>
              <option value="">Top level</option>
              {(collData?.collections ?? []).map((c) => <option key={c.id} value={c.id}>{folderPath(collData?.collections ?? [], c.id)}</option>)}
            </select>
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setNewCollectionOpen(false)}>Cancel</button>
            <button className="btn btn-primary" type="submit"><Plus size={14} /> Create folder</button>
          </div>
        </form>
      </Modal>

      {/* Add company modal — create a borrower or link an existing one as a subsidiary */}
      <AddCompanyModal
        open={addCompanyOpen}
        onClose={() => setAddCompanyOpen(false)}
        workspaceId={wid}
        entities={treeData?.entities ?? []}
        defaultParent={sel.kind === 'entity' ? sel.entityId : ''}
        onSaved={() => refetchTree()}
      />
    </main>
  );
}

// ── Add company: create a borrower, or link an existing one as a subsidiary ──
function AddCompanyModal({ open, onClose, workspaceId, entities, defaultParent, onSaved }: {
  open: boolean; onClose: () => void; workspaceId?: string;
  entities: TreeEntity[]; defaultParent: string; onSaved: () => void;
}) {
  const [mode, setMode] = useState<'new' | 'link'>('new');
  const [name, setName] = useState('');
  const [existingId, setExistingId] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const topEntities = entities.filter((e) => !e.parentId);

  useEffect(() => {
    if (open) { setParentId(defaultParent); setError(null); }
    else { setMode('new'); setName(''); setExistingId(''); setParentId(''); setError(null); }
  }, [open, defaultParent]);

  async function save() {
    if (!workspaceId || busy) return;
    setBusy(true); setError(null);
    try {
      if (mode === 'new') {
        // analytics routes are short-form mounted (/api/:wid/analytics/...) —
        // the /api/workspaces/:wid/analytics form 404s.
        await api(`/api/${workspaceId}/analytics/entities`, {
          method: 'POST',
          body: { name: name.trim(), parentId: parentId || undefined },
        });
      } else {
        if (!existingId) { setBusy(false); return; }
        await api(`/api/${workspaceId}/analytics/entities/${existingId}`, {
          method: 'PATCH',
          body: { parentId: parentId || null },
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={mode === 'new' ? 'New company' : 'Add subsidiary'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ErrorBanner message={error} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={`btn btn-sm ${mode === 'new' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('new')}>New company</button>
          <button type="button" className={`btn btn-sm ${mode === 'link' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('link')}>Link existing</button>
        </div>
        {mode === 'new' ? (
          <Field label="Company name" hint="The borrower the documents and figures will belong to.">
            <input className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
        ) : (
          <Field label="Existing company" hint="Pick a company that is currently top-level — it becomes a subsidiary.">
            <select className="select" value={existingId} onChange={(e) => setExistingId(e.target.value)}>
              <option value="">Choose a company…</option>
              {topEntities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Part of (optional)" hint="Leave empty for a top-level company; pick a company to make this a subsidiary.">
          <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Top level</option>
            {topEntities.filter((e) => e.id !== existingId).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={busy || (mode === 'new' ? !name.trim() : !existingId)}
          >
            {busy ? 'Saving…' : mode === 'new' ? 'Create company' : 'Link as subsidiary'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Upload modal with drag & drop ─────────────────────────────────
function UploadModal({ open, onClose, workspaceId, collections, defaultCollection, onUploaded }: {
  open: boolean; onClose: () => void; workspaceId?: string;
  collections: Collection[]; defaultCollection: string; onUploaded: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [collectionId, setCollectionId] = useState(defaultCollection || '');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ documents: Doc[]; rejected: { file: string; reason: string }[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setFiles([]); setResult(null); setError(null); }
  }, [open]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...Array.from(list).filter((f) => !seen.has(f.name + f.size))].slice(0, 20);
    });
  }

  async function upload() {
    if (!files.length || !workspaceId) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      if (collectionId) fd.append('collectionId', collectionId);
      const res = await api<{ documents: Doc[]; rejected: { file: string; reason: string }[] }>(
        `/api/workspaces/${workspaceId}/documents`,
        { method: 'POST', body: fd },
      );
      setResult(res);
      setFiles([]);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Upload documents" width={540}>
      <ErrorBanner message={error} />
      {result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="badge badge-success" style={{ alignSelf: 'flex-start' }}>
            {result.documents.length} uploaded — processing started
          </div>
          {result.rejected.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
              <div className="badge badge-warning">
                {result.rejected.length} file{result.rejected.length === 1 ? '' : 's'} skipped
              </div>
              <ul style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, paddingLeft: 18 }}>
                {result.rejected.map((r, i) => (
                  <li key={i}><strong>{r.file}</strong> — {r.reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Documents appear in the library as “Queued”, then “Processing” while Lumen parses text,
            tables and structure. You'll be notified when each one is ready.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={() => setResult(null)}>Upload more</button>
          </div>
        </div>
      ) : (
        <>
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            role="button" tabIndex={0}
          >
            <Upload size={22} color="var(--text-muted)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>Drag files here or click to browse</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5 }}>
              PDF, DOC, DOCX, XLS, XLSX, CSV, TXT — up to 20 files, 50 MB each
            </div>
            <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden
              onChange={(e) => addFiles(e.target.files)} />
          </div>

          {files.length ? (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map((f) => (
                <div key={f.name + f.size} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                  <FileText size={14} color="var(--text-muted)" />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatBytes(f.size)}</span>
                  <button className="btn btn-ghost btn-sm" style={{ padding: '0 5px' }}
                    onClick={() => setFiles(files.filter((x) => x !== f))}><X size={13} /></button>
                </div>
              ))}
            </div>
          ) : null}

          <div style={{ marginTop: 16 }}>
            <Field label="Collection (optional)">
              <select className="select" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
                <option value="">No collection</option>
                {collections.map((c) => <option key={c.id} value={c.id}>{folderPath(collections, c.id)}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" onClick={upload} disabled={busy || !files.length}>
              {busy ? 'Uploading…' : `Upload ${files.length || ''} file${files.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}


// ── Folder import: pick → stage → preview → confirm ────────────────────
// A directory pick uploads into a staging batch — stored and deduped, but
// held out of the Data Room until the user reviews the tree preview and
// confirms where it lands. Discard drops it (and its storage) cleanly.
interface PreviewNode {
  name: string; path: string;
  files: { id: string; name: string; sizeBytes: number }[];
  folders: PreviewNode[];
}
interface ImportPreview {
  batch: { id: string; name: string; createdAt: string; status: string };
  tree: PreviewNode;
  files: number;
  totalBytes: number;
  rejected: { file: string; reason: string }[];
}

const IMPORT_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'];
const IMPORT_MAX_FILES = 200;

function ImportFolderModal({ open, onClose, workspaceId, entities, collections, resumeBatchId, onDone }: {
  open: boolean; onClose: () => void; workspaceId?: string;
  entities: TreeEntity[]; collections: Collection[];
  resumeBatchId: string | null; onDone: () => void;
}) {
  const [picked, setPicked] = useState<{ file: File; path: string }[]>([]);
  const [batch, setBatch] = useState<ImportPreview | null>(null);
  const [staging, setStaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entityId, setEntityId] = useState('');
  const [folderId, setFolderId] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // The directory picker attribute is non-standard; set it on the raw node.
  useEffect(() => {
    if (inputRef.current) inputRef.current.setAttribute('webkitdirectory', '');
  }, []);

  useEffect(() => {
    if (open) {
      setPicked([]); setBatch(null); setError(null); setEntityId(''); setFolderId('');
      // Resuming: jump straight to the preview of the pending batch.
      if (resumeBatchId && workspaceId) {
        api<ImportPreview>(`/api/workspaces/${workspaceId}/documents/folder-import/${resumeBatchId}`)
          .then(setBatch)
          .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the import preview.'));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resumeBatchId]);

  function onPick(list: FileList | null) {
    if (!list) return;
    const out: { file: File; path: string }[] = [];
    for (const f of Array.from(list)) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
      if (IMPORT_EXTS.includes(ext)) out.push({ file: f, path: rel });
    }
    setPicked(out.slice(0, IMPORT_MAX_FILES));
  }

  async function stage() {
    if (!workspaceId || !picked.length) return;
    setStaging(true); setError(null);
    try {
      const fd = new FormData();
      for (const p of picked) fd.append('files', p.file);
      fd.append('paths', JSON.stringify(picked.map((p) => p.path)));
      const res = await api<{ batchId: string; name: string; staged: number; rejected: { file: string; reason: string }[] }>(
        `/api/workspaces/${workspaceId}/documents/folder-import`,
        { method: 'POST', body: fd },
      );
      setPicked([]);
      setBatch(await api<ImportPreview>(`/api/workspaces/${workspaceId}/documents/folder-import/${res.batchId}`));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Staging failed.');
    } finally {
      setStaging(false);
    }
  }

  async function confirm() {
    if (!workspaceId || !batch) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/workspaces/${workspaceId}/documents/folder-import/${batch.batch.id}/confirm`, {
        method: 'POST',
        body: { entityId: entityId || null, collectionId: folderId || null },
      });
      onDone(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm the import.');
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!workspaceId || !batch) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/workspaces/${workspaceId}/documents/folder-import/${batch.batch.id}`, { method: 'DELETE' });
      onDone(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not discard the import.');
    } finally {
      setBusy(false);
    }
  }

  // Destination folders: the picked company's own folders, or workspace-level
  // folders when no company is chosen.
  const destCollections = collections.filter((c) => (entityId ? c.entityId === entityId : !c.entityId));

  return (
    <Modal open={open} onClose={busy || staging ? () => {} : onClose} title="Import folder" width={560}>
      <ErrorBanner message={error} />
      <input ref={inputRef} type="file" multiple style={{ display: 'none' }}
        onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
      {batch ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              <strong>{batch.batch.name}</strong> — {batch.files} file{batch.files === 1 ? '' : 's'} · {formatBytes(batch.totalBytes)} staged.
              Nothing enters the Data Room until you confirm.
            </div>
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border, #e5e5e5)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5 }}>
              <PreviewTree node={batch.tree} />
            </div>
          </div>
          {batch.rejected?.length ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              <strong>{batch.rejected.length} skipped:</strong>{' '}
              {batch.rejected.slice(0, 5).map((r) => `${r.file} — ${r.reason}`).join('; ')}
              {batch.rejected.length > 5 ? ` …and ${batch.rejected.length - 5} more` : ''}
            </div>
          ) : null}
          <Field label="File under company (optional)" hint="Scoped folders land under the company in the Data Room tree, and its documents are tagged to it.">
            <select className="select" value={entityId} onChange={(e) => { setEntityId(e.target.value); setFolderId(''); }}>
              <option value="">No company (workspace level)</option>
              {entities.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
            </select>
          </Field>
          <Field label="Inside folder (optional)" hint="The import's folders are created inside this one. Empty = top level (or the company's own new folder).">
            <select className="select" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">Top level</option>
              {destCollections.map((c) => <option key={c.id} value={c.id}>{folderPath(collections, c.id)}</option>)}
            </select>
          </Field>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <button className="btn btn-secondary" onClick={discard} disabled={busy} style={{ color: '#c0392b' }}>Discard import</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Decide later</button>
              <button className="btn btn-primary" onClick={confirm} disabled={busy}>Confirm &amp; process</button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            className="dropzone"
            onClick={() => inputRef.current?.click()}
            role="button" tabIndex={0}
            style={{ padding: 28, textAlign: 'center', cursor: 'pointer' }}
          >
            <FolderOpen size={22} color="var(--text-muted)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 13.5 }}>Pick a folder to import — its subfolders become Data Room folders.</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              PDF, DOC, DOCX, XLS, XLSX, CSV, TXT · up to {IMPORT_MAX_FILES} files · duplicates are skipped
            </div>
          </div>
          {picked.length ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {picked.length} file{picked.length === 1 ? '' : 's'} · {formatBytes(picked.reduce((n, p) => n + p.file.size, 0))} ready to stage
            </div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={stage} disabled={!picked.length || staging}>
              {staging ? 'Staging…' : 'Stage for review'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Recursive preview tree: folders nested, files counted.
function PreviewTree({ node, depth = 0 }: { node: PreviewNode; depth?: number }) {
  return (
    <div style={{ marginLeft: depth ? 14 : 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {depth > 0 ? <FolderOpen size={12} color="var(--text-muted)" /> : null}
        <span style={{ fontWeight: depth === 0 ? 600 : 500 }}>{node.name}</span>
        {node.files.length ? (
          <span style={{ color: 'var(--text-muted)' }}>· {node.files.length} file{node.files.length === 1 ? '' : 's'}</span>
        ) : null}
      </div>
      {node.folders.map((f) => <PreviewTree key={f.path} node={f} depth={depth + 1} />)}
    </div>
  );
}
