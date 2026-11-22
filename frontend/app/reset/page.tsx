'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { ErrorBanner, Field } from '../../components/ui';

export default function Reset() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();

  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/api/auth/reset', { method: 'POST', body: { email, code, password } });
      router.replace('/sign-in?reset=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset your password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><span className="mark">L</span> Lumen</div>
        <div className="card card-pad">
          <div className="auth-title">Enter your recovery code</div>
          <div className="auth-sub" style={{ marginBottom: 22 }}>
            Enter the 6-digit code we sent, then choose a new password.
          </div>
          <ErrorBanner message={error} />
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Email">
              <input className="input" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Recovery code">
              <input className="input mono" required inputMode="numeric" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456" style={{ letterSpacing: 3, fontSize: 16 }} autoFocus />
            </Field>
            <Field label="New password" hint="At least 10 characters. Resets all other sessions.">
              <input className="input" type="password" required minLength={10} value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
          <div className="auth-foot"><Link href="/forgot">Send a different code</Link></div>
        </div>
      </div>
    </div>
  );
}
