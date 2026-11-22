'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { ErrorBanner, Field } from '../../components/ui';

export default function ResendVerification() {
  return (
    <Suspense fallback={null}>
      <ResendVerificationInner />
    </Suspense>
  );
}

function ResendVerificationInner() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/api/auth/resend', { method: 'POST', body: { email } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><span className="mark">L</span> Lumen</div>
        <div className="card card-pad">
          <div className="auth-title">Resend verification code</div>
          <div className="auth-sub" style={{ marginBottom: 22 }}>
            We'll email a fresh 6-digit code if your address has a pending verification.
          </div>
          <ErrorBanner message={error} />
          {done ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <span className="badge badge-success">Code sent</span>
              <div className="auth-foot" style={{ marginTop: 16 }}>
                Enter it on the <Link href={`/register?email=${encodeURIComponent(email)}#verify`}>verification screen</Link>, or try signing in again.
              </div>
            </div>
          ) : (
            <form onSubmit={resend} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Email">
                <input className="input" type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} autoFocus />
              </Field>
              <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">
                {busy ? 'Sending…' : 'Send new code'}
              </button>
            </form>
          )}
          <div className="auth-foot"><Link href="/sign-in">Back to sign in</Link></div>
        </div>
      </div>
    </div>
  );
}
