'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { Plus, MessagesSquare, Sparkles, Library, AlertTriangle } from 'lucide-react';
import { api, streamSSE } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';
import { EmptyState, ErrorBanner, Modal, Spinner } from '../../../components/ui';

interface Citation {
  ref: number; kind: string; page: number | null; sheet: string | null; tableRef: string | null;
  excerpt: string; documentId: string; document: { name: string };
}
interface Message {
  id: string; role: 'USER' | 'ASSISTANT'; content: string;
  citations?: Citation[];
}
interface Conversation {
  id: string; title: string; documentIds: string[] | null; collectionId: string | null;
  updatedAt: string;
  messages?: { content: string }[];
}
interface Doc { id: string; name: string; status: string }
interface Collection { id: string; name: string }

export default function Assistant() {
  const router = useRouter();
  const params = useSearchParams();
  const { workspace } = useWorkspace();
  const wid = workspace?.workspace.id;

  const [conversationId, setConversationId] = useState<string | null>(params.get('c'));
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scope, setScope] = useState<{ docIds: string[]; label: string }>(() => {
    const doc = params.get('doc');
    return doc ? { docIds: [doc], label: 'Selected document' } : { docIds: [], label: 'All workspace documents' };
  });
  const [evidenceCite, setEvidenceCite] = useState<Citation | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { data: convData } = useSWR(
    wid ? `/api/${wid}/conversations` : null,
    () => api<{ conversations: Conversation[] }>(`/api/workspaces/${wid}/conversations`),
    { refreshInterval: 30000 },
  );
  const { data: docData } = useSWR(
    wid ? `/docs-${wid}` : null,
    () => api<{ documents: Doc[] }>(`/api/workspaces/${wid}/documents?status=COMPLETED&take=200`),
  );
  const { data: collData } = useSWR(
    wid ? `/colls-${wid}` : null,
    () => api<{ collections: Collection[] }>(`/api/workspaces/${wid}/collections`),
  );

  // Load messages when opening a conversation.
  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    let cancelled = false;
    api<{ messages: Message[] }>(`/api/conversations/${conversationId}`).then((res) => {
      if (!cancelled) setMessages(res.messages);
    }).catch(() => setMessages([]));
    return () => { cancelled = true; };
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamText]);

  async function newConversation() {
    if (!wid) return;
    const res = await api<{ conversation: Conversation }>(`/api/workspaces/${wid}/conversations`, {
      method: 'POST',
      body: scope.docIds.length ? { documentIds: scope.docIds } : {},
    });
    setConversationId(res.conversation.id);
    setMessages([]);
    router.replace(`/assistant?c=${res.conversation.id}`, undefined, { shallow: true });
    return res.conversation.id;
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const content = input.trim();
    if (!content || streaming) return;
    setInput('');
    setError(null);
    let convId = conversationId;
    try {
      if (!convId) convId = await newConversation();

      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'USER', content }]);
      setStreaming(true);
      setStreamText('');

      let acc = '';
      await streamSSE(`/api/conversations/${convId}/messages`, { content, stream: true }, (ev) => {
        if (ev.error) {
          setError(ev.error);
          return;
        }
        if (ev.delta) {
          acc += ev.delta;
          setStreamText(acc);
        }
        if (ev.done && ev.message) {
          setMessages((m) => [...m, ev.message as Message]);
          setStreamText('');
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assistant could not answer.');
    } finally {
      setStreaming(false);
      setStreamText('');
      // Refresh conversation titles in the sidebar.
      if (convId) void api(`/api/workspaces/${wid}/conversations`).then(() => {});
    }
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - var(--topbar-h))', overflow: 'hidden' }}>
      {/* Conversation list */}
      <aside style={{
        width: 250, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--sidebar)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '14px 14px 10px' }}>
          <button className="btn btn-secondary btn-sm btn-block" onClick={newConversation}>
            <Plus size={14} /> New conversation
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 8px 12px', flex: 1 }}>
          {(convData?.conversations ?? []).length === 0 ? (
            <div style={{ padding: '20px 12px', fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center' }}>
              Your conversations will appear here.
            </div>
          ) : (
            convData!.conversations.map((c) => (
              <button key={c.id} className="nav-item" style={{
                width: '100%', border: 'none', background: c.id === conversationId ? 'var(--surface)' : 'transparent',
                cursor: 'pointer', boxShadow: c.id === conversationId ? 'var(--shadow-1)' : 'none',
                alignItems: 'flex-start',
              }} onClick={() => { setConversationId(c.id); router.replace(`/assistant?c=${c.id}`, undefined, { shallow: true }); }}>
                <MessagesSquare size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.title}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Chat */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && !streamText && !streaming ? (
            <EmptyState
              icon={<Sparkles size={20} />}
              title="Ask anything about your documents"
              sub={`Answers come from ${scope.label.toLowerCase()} — with citations to the page, table, or row every claim came from. If the documents don't contain the answer, the assistant says so.`}
            />
          ) : null}

          {messages.map((m) => (
            <div key={m.id} className={`chat-row ${m.role.toLowerCase()}`}>
              <div className="chat-bubble">
                {m.content}
                {m.citations?.length ? (
                  <div className="chat-cites">
                    {m.citations.map((c) => (
                      <button key={c.ref} className="cite-chip" onClick={() => setEvidenceCite(c)}>
                        [{c.ref}] {c.document.name.length > 26 ? `${c.document.name.slice(0, 24)}…` : c.document.name}
                        {c.page ? ` · p.${c.page}` : c.sheet ? ` · ${c.sheet}` : ''}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {streaming ? (
            <div className="chat-row assistant">
              <div className="chat-bubble">
                {streamText || <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--text-muted)' }}><Spinner size={12} /> Reading passages…</span>}
              </div>
            </div>
          ) : null}
        </div>

        <div className="composer">
          <ErrorBanner message={error} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setScopeOpen(true)} style={{ color: 'var(--text-secondary)' }}>
              <Library size={13} /> {scope.label}
            </button>
            <span>Enter to send · Shift+Enter for a new line</span>
          </div>
          <form className="composer-inner" onSubmit={send}>
            <textarea
              placeholder="Ask a question — e.g. “What are Halden's leverage covenants?”"
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              style={{ background: 'transparent' }}
            />
            <button className="btn btn-primary" style={{ height: 32 }} disabled={!input.trim() || streaming} type="submit">
              {streaming ? <Spinner size={13} /> : 'Ask'}
            </button>
          </form>
        </div>
      </div>

      {/* Scope picker */}
      <Modal open={scopeOpen} onClose={() => setScopeOpen(false)} title="Answer from" width={460}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
          Choose which documents the assistant may use. Only documents in this workspace are ever reachable.
        </div>
        <button
          className="nav-item" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', marginBottom: 8, cursor: 'pointer', background: scope.docIds.length === 0 ? 'var(--blue-tint)' : 'transparent' }}
          onClick={() => { setScope({ docIds: [], label: 'All workspace documents' }); setScopeOpen(false); }}>
          <Library size={15} /> Everything in this workspace
        </button>
        <div className="nav-label" style={{ marginTop: 10 }}>Individual documents</div>
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {(docData?.documents ?? []).map((d) => (
            <button key={d.id} className="nav-item" style={{
              width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 'var(--r-sm)',
            }} onClick={() => {
              setScope({ docIds: [d.id], label: d.name.length > 32 ? `${d.name.slice(0, 30)}…` : d.name });
              setScopeOpen(false);
            }}>
              <MessagesSquare size={14} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
            </button>
          ))}
        </div>
        {collData?.collections?.length ? (
          <>
            <div className="nav-label" style={{ marginTop: 10 }}>Collections</div>
            {collData.collections.map((c) => (
              <button key={c.id} className="nav-item" style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={() => { setScope({ docIds: [], label: `Collection: ${c.name}` }); setScopeOpen(false); }}>
                <Library size={14} /> {c.name}
              </button>
            ))}
          </>
        ) : null}
      </Modal>

      {/* Evidence panel */}
      <Modal open={!!evidenceCite} onClose={() => setEvidenceCite(null)} title={`Evidence — [${evidenceCite?.ref}] ${evidenceCite?.document?.name ?? ''}`} width={520}>
        {evidenceCite ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {evidenceCite.page ? <span className="badge badge-blue">Page {evidenceCite.page}</span> : null}
              {evidenceCite.sheet ? <span className="badge badge-blue">Sheet {evidenceCite.sheet}</span> : null}
              {evidenceCite.tableRef ? <span className="badge badge-neutral">{evidenceCite.tableRef}</span> : null}
              <span className="badge badge-neutral">{evidenceCite.kind}</span>
            </div>
            <div className="card" style={{ padding: 16, background: 'var(--sunken)', boxShadow: 'none', fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {evidenceCite.excerpt}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => { router.push(`/documents/${evidenceCite!.documentId}`); setEvidenceCite(null); }}>
                Open in document viewer
              </button>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
