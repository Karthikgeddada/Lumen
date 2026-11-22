'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useWorkspace } from '../../lib/workspace';
import { ErrorBanner, Field } from '../../components/ui';

const INDUSTRIES = ['Finance', 'Technology', 'Industrial', 'Legal', 'Research', 'Business'];

// Steps: welcome → workspace → invite team → first upload → done.
export default function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, reload } = useAuth();
  const { switchTo, workspaces } = useWorkspace();

  const [step, setStep] = useState(() => {
    if (params.get('create')) return 1;
    if (user?.onboardingStep === 1) return 0;
    if (user?.onboardingStep === 2) return 1;
    if (user?.onboardingStep === 3) return 2;
    return 0;
  });
  const [wsName, setWsName] = useState('');
  const [industry, setIndustry] = useState('Finance');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('EDITOR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api<{ workspace: { id: string; name: string } }>('/api/workspaces', {
        method: 'POST',
        body: { name: wsName, industry },
      });
      await reload();
      switchTo(res.workspace.id);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace.');
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return setStep(3);
    setBusy(true); setError(null);
    try {
      const ws = workspaces[0];
      if (ws) {
        await api(`/api/workspaces/${ws.workspace.id}/invitations`, {
          method: 'POST',
          body: { email: inviteEmail, role: inviteRole },
        });
      }
      setInviteEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await api('/api/auth/me', { method: 'PATCH', body: { onboardingStep: 4 } });
      await reload();
    } catch {}
    router.replace('/library?upload=1');
  }

  const TITLES = ['Welcome to Lumen', 'Create your workspace', 'Invite your team', 'Almost there'];
  const SUBS = [
    'Document intelligence for teams that need answers they can verify.',
    'A workspace holds your documents, extractions, and analytics — one per team or client.',
    'Collaboration is built in. Invite colleagues now or skip this step.',
    'Add your first document and Lumen will extract its structure, tables, and key facts.',
  ];

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <div className="auth-brand"><span className="mark">L</span> Lumen</div>
        <div className="card card-pad" style={{ padding: 26 }}>
          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 20 }}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} style={{
                width: 22, height: 4, borderRadius: 2,
                background: i <= step ? 'var(--blue)' : 'var(--sunken)',
              }} />
            ))}
          </div>
          <div className="auth-title">{TITLES[step]}</div>
          <div className="auth-sub" style={{ marginBottom: 22 }}>{SUBS[step]}</div>
          <ErrorBanner message={error} />

          {step === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card" style={{ padding: '14px 16px', boxShadow: 'none', background: 'var(--sunken)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{user ? `${user.firstName} ${user.lastName}` : 'Your account'}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{user?.email}</div>
              </div>
              <button className="btn btn-primary btn-lg btn-block" onClick={() => setStep(1)}>
                Get started
              </button>
            </div>
          ) : null}

          {step === 1 ? (
            <form onSubmit={createWorkspace} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Workspace name" hint="e.g. “Northwind Capital” or “Corp Dev Team”.">
                <input className="input" required minLength={2} maxLength={80} value={wsName}
                  onChange={(e) => setWsName(e.target.value)} placeholder="Acme Research" autoFocus />
              </Field>
              <Field label="Industry">
                <select className="select" value={industry} onChange={(e) => setIndustry(e.target.value)}>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
              <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">
                {busy ? 'Creating…' : 'Create workspace'}
              </button>
            </form>
          ) : null}

          {step === 2 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" type="email" placeholder="teammate@company.com" value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)} />
                <select className="select" style={{ width: 130 }} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="ADMIN">Admin</option>
                  <option value="EDITOR">Editor</option>
                  <option value="REVIEWER">Reviewer</option>
                  <option value="VIEWER">Viewer</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-secondary btn-lg" onClick={sendInvite} disabled={busy} style={{ flex: 1 }}>
                  Send invite
                </button>
                <button className="btn btn-primary btn-lg" onClick={() => setStep(3)} style={{ flex: 1 }}>
                  Skip for now
                </button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                Lumen processes PDFs, Word, Excel, and CSV files — text, tables, and structure —
                so every answer and extraction comes with a page-level citation you can check.
              </div>
              <button className="btn btn-primary btn-lg btn-block" onClick={finish} disabled={busy}>
                {busy ? 'Finishing…' : 'Upload my first document'}
              </button>
              <Link href="/dashboard" style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                Explore the empty dashboard first
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
