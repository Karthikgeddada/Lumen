import type { WorkspaceRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; sessionId: string };
      ws?: {
        id: string;
        role: WorkspaceRole;
        // resolved from :workspaceId route param or ?workspaceId / body.workspaceId
      };
    }
  }
}

export {};
