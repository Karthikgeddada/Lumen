'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { ErrorBanner, Field } from '../../components/ui';

export default function SignIn() {
  const { signIn } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setUnverified(false);
    try {
      await signIn(email, password, keep);
      // Straight to the dashboard after login — no onboarding or other steps
      // in between. The dashboard handles workspace-less users gracefully.
      router.replace('/dashboard');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed.';
      setError(msg);
      if ((err as { code?: string }).code === 'EMAIL_UNVERIFIED') setUnverified(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><span className="mark">L</span> Lumen</div>
        <div className="card card-pad">
          <div className="auth-title">Sign in to Lumen</div>
          <div className="auth-sub" style={{ marginBottom: 22 }}>Welcome back. Enter your credentials to continue.</div>
          <ErrorBanner message={error} />
          {unverified ? (
            <div style={{ marginBottom: 12, fontSize: 13 }}>
              Need a new code? <Link href={`/resend?email=${encodeURIComponent(email)}`}>Resend verification email</Link>
            </div>
          ) : null}
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Email">
              <input className="input" type="email" required autoComplete="email"
                placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            <Field label="Password">
              <input className="input" type="password" required autoComplete="current-password"
                placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} style={{ accentColor: 'var(--blue)' }} />
                Keep me signed in
              </label>
              <Link href="/forgot" style={{ fontSize: 13 }}>Forgot password?</Link>
            </div>
            <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div style={{ height: 1, background: 'var(--border)', margin: '20px 0' }} />
          <div className="auth-foot" style={{ marginTop: 0 }}>
            New to Lumen? <Link href="/register">Create an account</Link>
          </div>
        </div>
        <div className="auth-foot">© 2026 Lumen Document Intelligence</div>
      </div>
    </div>
  );
}
