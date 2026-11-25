'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  LayoutGrid, Library, MessagesSquare, ClipboardCheck, FileSpreadsheet,
  LineChart, Users, Settings, Search, Bell, ChevronsUpDown, Plus, LogOut,
  Check, FileText, PanelLeftClose, PanelLeftOpen, Scale,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useWorkspace } from '../lib/workspace';
import { api } from '../lib/api';
import { Avatar, timeAgo } from './ui';

interface SearchResults {
  documents: { id: string; name: string; fileType: string; status: string; pageCount: number | null }[];
  passages: { chunkId: string; documentId: string; documentName: string; page: number | null; sheet: string | null; headingPath: string[] | null; excerpt: string }[];
}

interface Notification {
  id: string; kind: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string;
}

function useOutsideClose(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose]);
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { workspace, workspaces, switchTo } = useWorkspace();

  const [wsMenu, setWsMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [notifMenu, setNotifMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Sidebar collapse — remembered across reloads. Read after mount so the
  // server-rendered HTML matches the first client paint.
  useEffect(() => {
    if (localStorage.getItem('lumen:sidebar') === 'closed') setSidebarOpen(false);
  }, []);
  const toggleSidebar = () => {
    setSidebarOpen((v) => {
      localStorage.setItem('lumen:sidebar', v ? 'closed' : 'open');
      return !v;
    });
  };

  const wsRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  useOutsideClose(wsRef, () => setWsMenu(false));
  useOutsideClose(userRef, () => setUserMenu(false));
  useOutsideClose(notifRef, () => setNotifMenu(false));

  const { data: notifData, mutate: refetchNotifs } = useSWR(
    user ? '/api/notifications' : null,
    () => api<{ notifications: Notification[]; unreadCount: number }>('/api/notifications'),
    { refreshInterval: 30000 },
  );
  const unread = notifData?.unreadCount ?? 0;

  // ⌘K opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const nav = [
    { section: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutGrid }] },
    {
      section: 'Workspace',
      items: [
        { href: '/library', label: 'Document Library', icon: Library },
        { href: '/assistant', label: 'AI Assistant', icon: MessagesSquare },
        { href: '/extraction', label: 'Data Extraction', icon: ClipboardCheck },
        { href: '/questionnaires', label: 'Questionnaires', icon: FileSpreadsheet },
        { href: '/analytics', label: 'Analytics', icon: LineChart },
        { href: '/covenants', label: 'Covenants', icon: Scale },
      ],
    },
    { section: 'Manage', items: [{ href: '/team', label: 'Workspaces & Team', icon: Users }, { href: '/settings', label: 'Settings', icon: Settings }] },
  ];

  async function markAllRead() {
    await api('/api/notifications/read', { method: 'POST', body: {} });
    refetchNotifs();
  }

  return (
    <div className={`shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="mark">L</span> Lumen
        </div>

        {/* Workspace switcher */}
        <div ref={wsRef} style={{ position: 'relative', padding: '0 4px' }}>
          <button className="ws-switch" style={{ width: '100%' }} onClick={() => setWsMenu((v) => !v)}>
            <span style={{
              width: 20, height: 20, borderRadius: 6, flexShrink: 0,
              background: 'var(--graphite)', color: '#fff', fontSize: 10, fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {workspace?.workspace.name?.[0]?.toUpperCase() ?? '+'}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
              {workspace?.workspace.name ?? 'No workspace'}
            </span>
            <ChevronsUpDown size={13} color="var(--text-muted)" />
          </button>
          {wsMenu ? (
            <div className="card" style={{ position: 'absolute', top: 40, left: 4, right: 4, zIndex: 60, padding: 5, boxShadow: 'var(--shadow-3)' }}>
              {workspaces.map((m) => (
                <button key={m.workspace.id} className="nav-item" style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer' }}
                  onClick={() => { switchTo(m.workspace.id); setWsMenu(false); }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                    background: 'var(--sunken)', color: 'var(--text-secondary)', fontSize: 9, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>{m.workspace.name[0]?.toUpperCase()}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.workspace.name}</span>
                  {m.workspace.id === workspace?.workspace.id ? <Check size={13} color="var(--blue)" style={{ marginLeft: 'auto' }} /> : null}
                </button>
              ))}
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
              <Link href="/onboarding?create=1" className="nav-item" onClick={() => setWsMenu(false)}>
                <Plus size={14} /> Create workspace
              </Link>
            </div>
          ) : null}
        </div>

        {nav.map((group) => (
          <div className="nav-section" key={group.section}>
            <div className="nav-label">{group.section}</div>
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link key={item.href} href={item.href} className={`nav-item ${active ? 'active' : ''}`}>
                  <item.icon size={15.5} strokeWidth={1.9} /> {item.label}
                </Link>
              );
            })}
          </div>
        ))}

        <div className="sidebar-foot">
          <Link href="/library?upload=1" className="nav-item">
            <Plus size={15.5} strokeWidth={1.9} /> Upload document
          </Link>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            className="btn btn-ghost btn-sm"
            style={{ padding: '0 7px' }}
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            {sidebarOpen ? <PanelLeftClose size={16} strokeWidth={1.9} /> : <PanelLeftOpen size={16} strokeWidth={1.9} />}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSearchOpen(true)} style={{ gap: 8, color: 'var(--text-muted)', width: 220, justifyContent: 'flex-start' }}>
            <Search size={14} /> Search documents…
            <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, opacity: 0.7 }}>⌘K</span>
          </button>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Notifications */}
            <div ref={notifRef} style={{ position: 'relative' }}>
              <button className="btn btn-ghost btn-sm" style={{ padding: '0 8px' }} onClick={() => setNotifMenu((v) => !v)} aria-label="Notifications">
                <Bell size={16} strokeWidth={1.9} />
                {unread > 0 ? (
                  <span style={{
                    position: 'absolute', top: 2, right: 2, minWidth: 14, height: 14,
                    background: 'var(--error)', color: '#fff', borderRadius: 999,
                    fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                  }}>{unread > 9 ? '9+' : unread}</span>
                ) : null}
              </button>
              {notifMenu ? (
                <div className="card" style={{ position: 'absolute', right: 0, top: 40, width: 320, zIndex: 60, boxShadow: 'var(--shadow-3)' }}>
                  <div className="card-header">
                    <div className="card-title">Notifications</div>
                    {unread > 0 ? <button className="btn btn-ghost btn-sm" onClick={markAllRead}>Mark all read</button> : null}
                  </div>
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {(notifData?.notifications ?? []).length === 0 ? (
                      <div style={{ padding: '28px 20px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>No notifications yet.</div>
                    ) : (
                      notifData!.notifications.map((n) => (
                        <Link key={n.id} href={n.link ?? '#'} onClick={() => setNotifMenu(false)} style={{
                          display: 'block', padding: '12px 18px', borderBottom: '1px solid var(--border)', textDecoration: 'none',
                          background: n.readAt ? 'transparent' : 'rgba(0,113,227,0.03)',
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 540, color: 'var(--text-primary)' }}>{n.title}</div>
                          {n.body ? <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{n.body}</div> : null}
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{timeAgo(n.createdAt)}</div>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* User menu */}
            <div ref={userRef} style={{ position: 'relative' }}>
              <button onClick={() => setUserMenu((v) => !v)} style={{
                display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: 'none', cursor: 'pointer', padding: 2,
              }} aria-label="Account menu">
                {user ? <Avatar first={user.firstName} last={user.lastName} /> : null}
              </button>
              {userMenu ? (
                <div className="card" style={{ position: 'absolute', right: 0, top: 40, width: 230, zIndex: 60, padding: 5, boxShadow: 'var(--shadow-3)' }}>
                  <div style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.firstName} {user?.lastName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
                  </div>
                  <Link href="/settings" className="nav-item" onClick={() => setUserMenu(false)}>
                    <Settings size={14} /> Settings
                  </Link>
                  <button className="nav-item" style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }} onClick={() => signOut()}>
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {children}
      </div>

      {/* Global search modal */}
      {searchOpen ? (
        <GlobalSearch workspaceId={workspace?.workspace.id} onClose={() => setSearchOpen(false)} query={query} setQuery={setQuery} />
      ) : null}
    </div>
  );
}

function GlobalSearch({ workspaceId, onClose, query, setQuery }: {
  workspaceId?: string; onClose: () => void; query: string; setQuery: (q: string) => void;
}) {
  const router = useRouter();
  const { data } = useSWR(
    workspaceId && query.trim().length >= 2
      ? `/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(query)}`
      : null,
    (key: string) => api<SearchResults>(key),
    { keepPreviousData: true },
  );

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560, padding: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <Search size={16} color="var(--text-muted)" />
          <input
            autoFocus
            className="input" style={{ border: 'none', boxShadow: 'none', background: 'transparent', fontSize: 15 }}
            placeholder="Search document names and content…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div style={{ maxHeight: 440, overflowY: 'auto', padding: 8 }}>
          {query.trim().length < 2 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              Type at least two characters. Results cover document names and every passage inside processed documents.
            </div>
          ) : !data ? (
            <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
          ) : (
            <>
              {data.documents.length === 0 && data.passages.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                  No matches in this workspace.
                </div>
              ) : null}
              {data.documents.map((d) => (
                <button key={d.id} className="nav-item" style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer' }}
                  onClick={() => { onClose(); router.push(`/documents/${d.id}`); }}>
                  <FileText size={15} color="var(--text-muted)" />
                  <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.pageCount ? `${d.pageCount} pp` : 'sheet'}</span>
                </button>
              ))}
              {data.passages.map((p) => (
                <button key={p.chunkId} className="nav-item" style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', alignItems: 'flex-start', padding: '10px 9px' }}
                  onClick={() => { onClose(); router.push(`/documents/${p.documentId}`); }}>
                  <FileText size={15} color="var(--blue)" style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 590, color: 'var(--text-primary)' }}>
                      {p.documentName} · {p.page ? `p. ${p.page}` : p.sheet ? `sheet “${p.sheet}”` : 'text'}
                    </span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.45 }}>{p.excerpt}</span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
