'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';

export default function Entry() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/sign-in');
    else router.replace('/dashboard');
  }, [user, loading, router]);

  return (
    <div className="auth-wrap">
      <div className="spinner" />
    </div>
  );
}
