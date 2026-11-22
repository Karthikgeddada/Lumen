'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { Shell } from '../../components/Shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/sign-in');
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="auth-wrap">
        <div className="spinner" />
      </div>
    );
  }

  return <Shell>{children}</Shell>;
}
