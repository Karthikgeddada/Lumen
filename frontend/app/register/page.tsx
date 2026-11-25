'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, storeTokens } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ErrorBanner, Field } from '../../components/ui';

// Registration → inline 6-digit email verification → signed in.
export default function Register() {
  return (
    <Suspense fallback={null}>
      <RegisterInner />
    </Suspense>
  );
}

function RegisterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { setUser } = useAuth();

  const [step, setStep] = useState<'form' | 'verify'>('form');
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', acceptTerms: false });
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const codeInput = (i: number, val: string) => {
    const digits = val.replace(/\D/g, '').slice(-1);
    const next = [...code];
    next[i] = digits;
    setCode(next);
    if (digits && i < 5) {
      const el = document.getElementById(`code-${i + 1}`) as HTMLInputElement | null;
      el?.focus();
    }
  };

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const data = await api<{ user?: unknown; accessToken?: string; refreshToken?: string }>('/api/auth/register', {
        method: 'POST',
        body: { ...form, acceptTerms: true },
      });
      // New flow: the backend creates verified accounts and returns a session
      // immediately — go straight into the app, no email needed. Fall back to
      // the code flow for accounts that predate this change.
      if (data.accessToken && data.refreshToken) {
        storeTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        router.replace('/onboarding');
        return;
      }
      setStep('verify');
      setInfo(`We sent a 6-digit code to ${form.email}. It expires in 15 minutes.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setError(null);
    try {
      const data = await api<{ user: unknown; accessToken: string; refreshToken: string }>('/api/auth/verify', {
        method: 'POST',
        body: { email: form.email, code: code.join('') },
      });
      storeTokens(data);
      router.replace('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true); setError(null);
    try {
      await api('/api/auth/resend', { method: 'POST', body: { email: form.email } });
      setInfo('A new code is on its way.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'verify') {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="auth-brand"><span className="mark">L</span> Lumen</div>
          <div className="card card-pad">
            <div className="auth-title">Check your email</div>
            <div className="auth-sub" style={{ marginBottom: 22 }}>{info ?? `Enter the 6-digit code sent to ${form.email}.`}</div>
            <ErrorBanner message={error} />
            <form onSubmit={verify}>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 18 }}>
                {code.map((c, i) => (
                  <input key={i} id={`code-${i}`} className="input mono" value={c} onChange={(e) => codeInput(i, e.target.value)}
                    inputMode="numeric" autoComplete="one-time-code" autoFocus={i === 0} required
                    style={{ width: 46, height: 52, fontSize: 20, textAlign: 'center', fontWeight: 600 }} />
                ))}
              </div>
              <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.some((c) => !c)} type="submit">
                {busy ? 'Verifying…' : 'Verify and continue'}
              </button>
            </form>
            <div className="auth-foot">
              Didn't get it? <button className="btn btn-ghost btn-sm" onClick={resend} disabled={busy} style={{ padding: 0, color: 'var(--blue-text)' }}>Resend code</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><span className="mark">L</span> Lumen</div>
        <div className="card card-pad">
          <div className="auth-title">Create your account</div>
          <div className="auth-sub" style={{ marginBottom: 22 }}>Upload credit agreements and borrower financials — Lumen reads, extracts, and tests them, with citations for every number.</div>
          <ErrorBanner message={error} />
          {params.get('invite') ? (
            <div className="badge badge-blue" style={{ marginBottom: 14 }}>You have a pending team invitation</div>
          ) : null}
          <form onSubmit={register} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="First name">
                <input className="input" required maxLength={60} value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoComplete="given-name" />
              </Field>
              <Field label="Last name">
                <input className="input" required maxLength={60} value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })} autoComplete="family-name" />
              </Field>
            </div>
            <Field label="Email">
              <input className="input" type="email" required value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
            </Field>
            <Field label="Password" hint="At least 10 characters.">
              <input className="input" type="password" required minLength={10} value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            </Field>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" required checked={form.acceptTerms}
                onChange={(e) => setForm({ ...form, acceptTerms: e.target.checked })} style={{ accentColor: 'var(--blue)', marginTop: 2 }} />
              <span>I agree to the <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.</span>
            </label>
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || !form.acceptTerms} type="submit">
              {busy ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          <div style={{ height: 1, background: 'var(--border)', margin: '20px 0' }} />
          <div className="auth-foot" style={{ marginTop: 0 }}>
            Already have an account? <Link href="/sign-in">Sign in</Link>
          </div>
        </div>
        <div className="auth-foot">© 2026 Lumen — Covenant & Portfolio Intelligence</div>
      </div>
    </div>
  );
}
