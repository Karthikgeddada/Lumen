'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useWorkspace } from '../../../lib/workspace';
import { ErrorBanner, Field, LoadingBlock, formatBytes } from '../../../components/ui';

const INDUSTRIES = ['Finance', 'Technology', 'Industrial', 'Legal', 'Research', 'Business'];

interface Rules { requireCitations: boolean; lowConfidenceThreshold: number; autoApproveHighConfidence: boolean }

export default function Settings() {
  const { user, reload } = useAuth();
  const { workspace, can } = useWorkspace();
  const wid = workspace?.workspace.id;

  const [wsName, setWsName] = useState('');
  const [industry, setIndustry] = useState('');
  const [rules, setRules] = useState<Rules | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedWs, setSavedWs] = useState(false);
  const [savedMe, setSavedMe] = useState(false);
  const [savedRules, setSavedRules] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: wsData, isLoading } = useSWR(wid ? `wsd-${wid}` : null, () =>
    api<{ workspace: { name: string; industry: string; storageUsedBytes: number; _count: { memberships: number; documents: number } } }>(`/api/workspaces/${wid}`));
  const { data: rulesData } = useSWR(can('ADMIN') && wid ? `rules-${wid}` : null, () =>
    api<{ settings: { key: string; value: unknown }[] }>(`/api/workspaces/${wid}/settings`));

  useEffect(() => {
    if (wsData?.workspace) {
      setWsName(wsData.workspace.name);
      setIndustry(wsData.workspace.industry);
    }
  }, [wsData]);

  useEffect(() => {
    const found = rulesData?.settings?.find((s) => s.key === 'questionnaires.rules')?.value as Rules | undefined;
    if (found) setRules(found);
  }, [rulesData]);

  useEffect(() => {
    if (user) { setFirstName(user.firstName); setLastName(user.lastName); }
  }, [user]);

  async function saveWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(`/api/workspaces/${wid}`, { method: 'PATCH', body: { name: wsName, industry } });
      setSavedWs(true); setTimeout(() => setSavedWs(false), 2000); await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally { setBusy(false); }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/api/auth/me', { method: 'PATCH', body: { firstName, lastName } });
      await reload();
      setSavedMe(true); setTimeout(() => setSavedMe(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally { setBusy(false); }
  }

  async function saveRules() {
    if (!rules) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/workspaces/${wid}/settings/questionnaires.rules`, {
        method: 'PUT', body: { value: rules },
      });
      setSavedRules(true); setTimeout(() => setSavedRules(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save rules.');
    } finally { setBusy(false); }
  }

  if (isLoading) return <main className="content"><LoadingBlock /></main>;

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-desc">Your profile, this workspace, and AI review rules.</div>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
        {/* Profile */}
        <div className="card">
          <div className="card-header"><div className="card-title">Your profile</div></div>
          <form onSubmit={saveProfile} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="First name">
                <input className="input" required maxLength={60} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </Field>
              <Field label="Last name">
                <input className="input" required maxLength={60} value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </Field>
            </div>
            <Field label="Email" hint="Email changes are not supported in this release.">
              <input className="input" value={user?.email ?? ''} disabled />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" disabled={busy} type="submit">{savedMe ? 'Saved ✓' : 'Save profile'}</button>
            </div>
          </form>
        </div>

        {/* Workspace */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Workspace</div>
            <span className="card-sub">Admin only</span>
          </div>
          <form onSubmit={saveWorkspace} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Workspace name">
              <input className="input" required minLength={2} maxLength={80} value={wsName}
                onChange={(e) => setWsName(e.target.value)} disabled={!can('ADMIN')} />
            </Field>
            <Field label="Industry">
              <select className="select" value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={!can('ADMIN')}>
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-sub">
                {wsData?.workspace ? `${wsData.workspace._count.documents} documents · ${wsData.workspace._count.memberships} members · ${formatBytes(wsData.workspace.storageUsedBytes)} stored` : ''}
              </span>
              {can('ADMIN') ? (
                <button className="btn btn-primary" disabled={busy} type="submit">{savedWs ? 'Saved ✓' : 'Save changes'}</button>
              ) : null}
            </div>
          </form>
        </div>

        {/* Questionnaire rules */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">AI answer rules</div>
            <span className="card-sub">Applied to every questionnaire in this workspace</span>
          </div>
          {can('ADMIN') ? (
            rules ? (
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Toggle
                  label="Require citations"
                  desc="AI answers must include evidence from workspace documents."
                  checked={rules.requireCitations}
                  onChange={(v) => setRules({ ...rules, requireCitations: v })}
                />
                <Toggle
                  label="Flag low-confidence answers for review"
                  desc="Answers below the confidence threshold are marked “Needs review” instead of auto-accepted."
                  checked={rules.lowConfidenceThreshold > 0}
                  onChange={(v) => setRules({ ...rules, lowConfidenceThreshold: v ? 0.85 : 0 })}
                />
                {rules.lowConfidenceThreshold > 0 ? (
                  <Field label={`Confidence threshold — ${Math.round(rules.lowConfidenceThreshold * 100)}%`}>
                    <input type="range" min={0.5} max={0.99} step={0.01} value={rules.lowConfidenceThreshold}
                      onChange={(e) => setRules({ ...rules, lowConfidenceThreshold: Number(e.target.value) })}
                      style={{ width: '100%', accentColor: 'var(--blue)' }} />
                  </Field>
                ) : null}
                <Toggle
                  label="Auto-approve high-confidence answers"
                  desc="Answers at or above the threshold are approved automatically without human review."
                  checked={rules.autoApproveHighConfidence}
                  onChange={(v) => setRules({ ...rules, autoApproveHighConfidence: v })}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary" onClick={saveRules} disabled={busy}>
                    {savedRules ? 'Saved ✓' : 'Save rules'}
                  </button>
                </div>
              </div>
            ) : <LoadingBlock label="Loading rules…" />
          ) : (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>
              Only workspace admins can change AI answer rules.
            </div>
          )}
        </div>

        {/* Security notice */}
        <div className="card card-pad" style={{ background: 'var(--sunken)', boxShadow: 'none' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>Security & sessions</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Sessions are device-scoped with rotating refresh tokens; signing out revokes this device's session.
            Changing your password revokes all sessions. Access tokens live in memory only — never in localStorage.
          </div>
        </div>
      </div>
    </main>
  );
}

function Toggle({ label, desc, checked, onChange }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', gap: 12, cursor: 'pointer', alignItems: 'flex-start' }}>
      <div style={{
        width: 36, height: 21, borderRadius: 999, background: checked ? 'var(--blue)' : 'var(--border-strong)',
        position: 'relative', flexShrink: 0, transition: 'background 0.2s var(--ease)', marginTop: 1,
      }} onClick={(e) => { e.preventDefault(); onChange(!checked); }}>
        <span style={{
          position: 'absolute', top: 2, left: checked ? 17 : 2, width: 17, height: 17, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(29,29,31,.25)', transition: 'left 0.2s var(--ease)',
        }} />
      </div>
      <span onClick={(e) => { e.preventDefault(); onChange(!checked); }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 560 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} hidden />
    </label>
  );
}
