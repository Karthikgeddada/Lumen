'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth, type Membership } from './auth';

interface WorkspaceState {
  workspace: Membership | null;
  workspaces: Membership[];
  role: string | null;
  switchTo: (id: string) => void;
  can: (min: 'VIEWER' | 'REVIEWER' | 'EDITOR' | 'ADMIN') => boolean;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);
const LS_KEY = 'lumen.workspace';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const workspaces = user?.memberships ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Restore last-used workspace once user loads; fall back to first.
  useEffect(() => {
    if (!workspaces.length) return;
    const stored = localStorage.getItem(LS_KEY);
    if (stored && workspaces.some((m) => m.workspace.id === stored)) {
      setSelectedId(stored);
    } else {
      setSelectedId(workspaces[0].workspace.id);
    }
  }, [workspaces]);

  const workspace = useMemo(
    () => workspaces.find((m) => m.workspace.id === selectedId) ?? workspaces[0] ?? null,
    [workspaces, selectedId],
  );

  const value = useMemo<WorkspaceState>(
    () => ({
      workspace,
      workspaces,
      role: workspace?.role ?? null,
      switchTo: (id) => {
        localStorage.setItem(LS_KEY, id);
        setSelectedId(id);
      },
      can: (min) => (workspace ? roleAtLeast(workspace.role, min) : false),
      loading,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspace, workspaces, loading],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

function roleAtLeast(role: string, min: string): boolean {
  const rank: Record<string, number> = { VIEWER: 1, REVIEWER: 2, EDITOR: 3, ADMIN: 4, OWNER: 5 };
  return (rank[role] ?? 0) >= (rank[min] ?? 0);
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
