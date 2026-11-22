'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { ErrorBanner, Spinner } from '../../../components/ui';

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true); setError(null);
    try {
      const res = await api<{ workspaceId: string }>('/api/workspaces/invitations/accept', {
        method: 'POST',
        body: { token },
      });
      await fetch('/api/auth/me', { credentials: 'include' }); // refresh memberships via /me on next load
      router.replace(`/dashboard?ws=${res.workspaceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invitation.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!loading && !user) {
      // Not signed in: register/sign-in first, then come back to this URL.
      router.replace(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
    }
  }, [loading, user, router, token]);

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><span className="mark">L</span> Lumen</div>
        <div className="card card-pad">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Spinner /></div>
          ) : (
            <>
              <div className="auth-title">You've been invited to a workspace</div>
              <div className="auth-sub" style={{ marginBottom: 22 }}>
                Accepting will add you as a member of the workspace this invitation belongs to.
              </div>
              <ErrorBanner message={error} />
              <button className="btn btn-primary btn-lg btn-block" onClick={accept} disabled={busy}>
                {busy ? 'Joining…' : 'Accept invitation'}
              </button>
              <div className="auth-foot">
                Wrong account? <Link href="/sign-in">Sign in as a different user</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
