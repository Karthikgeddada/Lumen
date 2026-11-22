'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { Upload, FileText, Plus, X, FolderOpen, ChevronRight, Trash2, RotateCcw } from 'lucide-react';
import { api, qs } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import {
  DocStatusBadge, DemoTag, EmptyState, ErrorBanner, Field, LoadingBlock, Modal,
  formatBytes, formatDate, timeAgo,
} from '../../../components/ui';

interface Doc {
  id: string; name: string; fileType: string; sizeBytes: number; pageCount: number | null;
  status: string; error: string | null; isDemo: boolean; uploadedAt: string;
  collection: { id: string; name: string } | null;
  owner: { firstName: string; lastName: string } | null;
}

interface Collection { id: string; name: string; description: string | null; _count: { documents: number } }

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';

export default function Library() {
  const router = useRouter();
  const params = useSearchParams();
  const { workspace, can } = useWorkspace();
  const wid = workspace?.workspace.id;

  const [q, setQ] = useState('');
  const [collection, setCollection] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('uploadedAt');

  const [uploadOpen, setUploadOpen] = useState(params.get('upload') === '1');
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  const key = wid ? `/api/workspaces/${wid}/documents${qs({ q, collectionId: collection, status, sort })}` : null;
  const { data, isLoading, mutate, error } = useSWR(key, (k: string) => api<{ documents: Doc[]; meta: { total: number; page: number; pages: number } }>(k), {
    refreshInterval: 8000,
  });
  const { data: collData, mutate: refetchColls } = useSWR(
    wid ? `/api/workspaces/${wid}/collections` : null,
    (k: string) => api<{ collections: Collection[] }>(k),
  );

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Document Library</div>
          <div className="page-desc">
            {data ? `${data.meta.total} document${data.meta.total === 1 ? '' : 's'} in ${workspace?.workspace.name}` : 'All workspace documents'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => setNewCollectionOpen(true)}><FolderOpen size={15} /> New collection</button>
          <button className="btn btn-primary" onClick={() => setUploadOpen(true)} disabled={!can('EDITOR')}><Upload size={15} /> Upload</button>
        </div>
      </div>

      <ErrorBanner message={error ? 'Could not load documents.' : null} />

      {/* Filters */}
      <div className="card" style={{ padding: '10px 12px', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input className="input" style={{ width: 260 }} placeholder="Search by name…" value={q}
          onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ width: 190 }} value={collection} onChange={(e) => setCollection(e.target.value)}>
          <option value="">All collections</option>
          {(collData?.collections ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
            title={q || status || collection ? 'No documents match these filters' : 'No documents yet'}
            sub={q || status || collection
              ? 'Try clearing a filter or changing the search term.'
              : 'Upload PDFs, Word, Excel, or CSV files. Lumen extracts text, tables, and structure automatically.'}
            action={!q && !status && !collection && can('EDITOR') ? (
              <button className="btn btn-primary" onClick={() => setUploadOpen(true)}><Upload size={15} /> Upload documents</button>
            ) : undefined}
          />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Document</th><th>Collection</th><th>Pages</th><th>Size</th><th>Status</th><th>Uploaded</th><th></th></tr>
            </thead>
            <tbody>
              {data.documents.map((doc) => (
                <tr key={doc.id}>
                  <td className="strong">
                    <Link href={`/documents/${doc.id}`} style={{ color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <FileText size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340, display: 'inline-block' }}>{doc.name}</span>
                    </Link>
                    {doc.isDemo ? <span style={{ marginLeft: 7 }}><DemoTag /></span> : null}
                  </td>
                  <td>{doc.collection?.name ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td className="mono" style={{ fontSize: 12.5 }}>{doc.pageCount ?? '—'}</td>
                  <td style={{ fontSize: 12.5 }}>{formatBytes(doc.sizeBytes)}</td>
                  <td><DocStatusBadge status={doc.status} /></td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{timeAgo(doc.uploadedAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {doc.status === 'FAILED' && can('EDITOR') && !doc.isDemo ? (
                      <button className="btn btn-ghost btn-sm" title="Retry processing"
                        onClick={async () => { await api(`/api/workspaces/${wid}/documents/${doc.id}/retry`, { method: 'POST' }); mutate(); }}>
                        <RotateCcw size={13} /> Retry
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Upload modal */}
      <UploadModal
        open={uploadOpen}
        onClose={() => { setUploadOpen(false); router.replace('/library'); }}
        workspaceId={wid}
        collections={collData?.collections ?? []}
        defaultCollection={collection}
        onUploaded={() => { mutate(); refetchColls(); }}
      />

      {/* New collection modal */}
      <Modal open={newCollectionOpen} onClose={() => setNewCollectionOpen(false)} title="New collection">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newCollectionName.trim() || !wid) return;
            await api(`/api/workspaces/${wid}/collections`, { method: 'POST', body: { name: newCollectionName.trim() } });
            setNewCollectionName('');
            setNewCollectionOpen(false);
            refetchColls();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <Field label="Collection name" hint="e.g. “Earnings 2026” or “Vendor contracts”.">
            <input className="input" required maxLength={60} value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)} autoFocus />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setNewCollectionOpen(false)}>Cancel</button>
            <button className="btn btn-primary" type="submit"><Plus size={14} /> Create collection</button>
          </div>
        </form>
      </Modal>
    </main>
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
            <div className="badge badge-warning" style={{ alignSelf: 'flex-start' }}>
              {result.rejected.length} file{result.rejected.length === 1 ? '' : 's'} skipped (unsupported type)
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
                {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
