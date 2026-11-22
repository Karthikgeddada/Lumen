'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { UserPlus, Trash2, Users } from 'lucide-react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useWorkspace } from '../../../lib/workspace';
import {
  Avatar, EmptyState, ErrorBanner, Field, LoadingBlock, Modal, formatDate, timeAgo,
} from '../../../components/ui';

interface Member {
  id: string; role: string; createdAt: string;
  user: { id: string; email: string; firstName: string; lastName: string; lastLoginAt: string | null };
}
interface Invitation { id: string; email: string; role: string; status: string; createdAt: string }
interface ActivityEvent {
  id: string; action: string; meta: Record<string, unknown> | null; createdAt: string;
  actor: { firstName: string; lastName: string } | null;
}

const ROLE_INFO: Record<string, { label: string; desc: string }> = {
  OWNER: { label: 'Owner', desc: 'Full control, including billing and workspace deletion.' },
  ADMIN: { label: 'Admin', desc: 'Manage members, settings, and all content.' },
  EDITOR: { label: 'Editor', desc: 'Upload documents, run extractions, edit content.' },
  REVIEWER: { label: 'Reviewer', desc: 'Review and approve AI answers and extractions.' },
  VIEWER: { label: 'Viewer', desc: 'Read-only access to documents and results.' },
};

export default function Team() {
  const { can, workspace, workspaces, switchTo } = useWorkspace();
  const { user } = useAuth();
  const wid = workspace?.workspace.id;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('EDITOR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: wsData } = useSWR(wid ? `ws-${wid}` : null, () => api<{ workspace: Record<string, unknown> }>(`/api/workspaces/${wid}`));
  const { data: memData, mutate: refetchMembers } = useSWR(
    wid ? `mem-${wid}` : null,
    () => api<{ members: Member[] }>(`/api/workspaces/${wid}/members`),
  );
  const { data: invData, mutate: refetchInvites } = useSWR(
    can('ADMIN') && wid ? `inv-${wid}` : null,
    () => api<{ invitations: Invitation[] }>(`/api/workspaces/${wid}/invitations`),
  );
  const { data: actData } = useSWR(
    wid ? `act-${wid}` : null,
    () => api<{ events: ActivityEvent[] }>(`/api/workspaces/${wid}/activity`),
  );

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(`/api/workspaces/${wid}/invitations`, { method: 'POST', body: { email: inviteEmail, role: inviteRole } });
      setInviteEmail('');
      setInviteOpen(false);
      refetchInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member: Member, role: string) {
    try {
      await api(`/api/workspaces/${wid}/members/${member.user.id}`, { method: 'PATCH', body: { role } });
      refetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the role.');
    }
  }

  async function removeMember(member: Member) {
    try {
      await api(`/api/workspaces/${wid}/members/${member.user.id}`, { method: 'DELETE' });
      refetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the member.');
    }
  }

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Workspaces & Team</div>
          <div className="page-desc">Members, roles, and invitations for {workspace?.workspace.name}.</div>
        </div>
        {can('ADMIN') ? (
          <button className="btn btn-primary" onClick={() => setInviteOpen(true)}><UserPlus size={15} /> Invite member</button>
        ) : null}
      </div>

      <ErrorBanner message={error} />

      {/* Workspace switcher cards */}
      {workspaces.length > 1 || true ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {workspaces.map((m) => (
            <button key={m.workspace.id} className="card card-pad" onClick={() => switchTo(m.workspace.id)}
              style={{
                textAlign: 'left', cursor: 'pointer', minWidth: 220, border: 'none',
                boxShadow: m.workspace.id === wid ? 'inset 0 0 0 2px var(--blue)' : 'var(--shadow-1)',
              }}>
              <div style={{ fontWeight: 640, fontSize: 14 }}>{m.workspace.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {m.workspace.industry} · you are {ROLE_INFO[m.role]?.label ?? m.role}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid-2" style={{ gridTemplateColumns: '1.55fr 1fr' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Members */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Members ({memData?.members.length ?? '…'})</div>
            </div>
            {!memData ? <LoadingBlock /> : (
              <table className="table">
                <thead><tr><th>Member</th><th>Role</th><th>Joined</th><th>Last active</th><th></th></tr></thead>
                <tbody>
                  {memData.members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar first={m.user.firstName} last={m.user.lastName} />
                          <div>
                            <div style={{ fontWeight: 560, fontSize: 13 }}>{m.user.firstName} {m.user.lastName}{m.user.id === user?.id ? ' (you)' : ''}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {can('ADMIN') && m.role !== 'OWNER' ? (
                          <select className="select" style={{ height: 30, fontSize: 12.5, width: 120 }}
                            value={m.role} onChange={(e) => changeRole(m, e.target.value)}>
                            {Object.entries(ROLE_INFO).filter(([k]) => k !== 'OWNER').map(([k, v]) => (
                              <option key={k} value={k}>{v.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="badge badge-neutral">{ROLE_INFO[m.role]?.label ?? m.role}</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{formatDate(m.createdAt)}</td>
                      <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{m.user.lastLoginAt ? timeAgo(m.user.lastLoginAt) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {can('ADMIN') && m.role !== 'OWNER' && m.user.id !== user?.id ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => removeMember(m)} title="Remove member">
                            <Trash2 size={13} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Role legend */}
          <div className="card">
            <div className="card-header"><div className="card-title">Roles & permissions</div></div>
            <div style={{ padding: '6px 20px' }}>
              {Object.entries(ROLE_INFO).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: `1px solid var(--border)` }}>
                  <span className="badge badge-neutral" style={{ minWidth: 72, justifyContent: 'center' }}>{v.label}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{v.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Pending invitations */}
          {can('ADMIN') ? (
            <div className="card">
              <div className="card-header"><div className="card-title">Pending invitations</div></div>
              {!invData || invData.invitations.length === 0 ? (
                <div style={{ padding: '24px 20px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                  No pending invitations.
                </div>
              ) : (
                invData.invitations.map((inv) => (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 540, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.email}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ROLE_INFO[inv.role]?.label} · sent {timeAgo(inv.createdAt)}</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={async () => {
                      await api(`/api/workspaces/${wid}/invitations/${inv.id}`, { method: 'DELETE' });
                      refetchInvites();
                    }}>Revoke</button>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {/* Activity */}
          <div className="card">
            <div className="card-header"><div className="card-title">Recent activity</div></div>
            {!actData || actData.events.length === 0 ? (
              <div style={{ padding: '24px 20px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                Activity will appear here as your team works.
              </div>
            ) : (
              actData.events.slice(0, 12).map((ev) => (
                <div key={ev.id} style={{ display: 'flex', gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
                  <Users size={13} color="var(--text-muted)" style={{ marginTop: 3, flexShrink: 0 }} />
                  <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                    <strong style={{ fontWeight: 590 }}>
                      {ev.actor ? `${ev.actor.firstName} ${ev.actor.lastName}`.trim() : 'Someone'}
                    </strong>{' '}{ev.action.replace(/[._]/g, ' ')}
                    <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11.5, marginTop: 2 }}>{timeAgo(ev.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Invite modal */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a teammate">
        <form onSubmit={invite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Email">
            <input className="input" type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com" autoFocus />
          </Field>
          <Field label="Role">
            <select className="select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              {Object.entries(ROLE_INFO).filter(([k]) => k !== 'OWNER').map(([k, v]) => (
                <option key={k} value={k}>{v.label} — {v.desc}</option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setInviteOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy} type="submit"><UserPlus size={14} /> Send invitation</button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
