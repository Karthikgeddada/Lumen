'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { ErrorBanner, Field } from '../../components/ui';

export default function Forgot() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/api/auth/forgot', { method: 'POST', body: { email } });
      // Server always answers OK (no account enumeration); move to code entry.
      router.push(`/reset?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start password recovery.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><span className="mark">L</span> Lumen</div>
        <div className="card card-pad">
          <div className="auth-title">Reset your password</div>
          <div className="auth-sub" style={{ marginBottom: 22 }}>
            Enter your account email and we'll send a 6-digit recovery code.
          </div>
          <ErrorBanner message={error} />
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Email">
              <input className="input" type="email" required autoFocus value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
            </Field>
            <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">
              {busy ? 'Sending…' : 'Send recovery code'}
            </button>
          </form>
          <div className="auth-foot"><Link href="/sign-in">Back to sign in</Link></div>
        </div>
      </div>
    </div>
  );
}
