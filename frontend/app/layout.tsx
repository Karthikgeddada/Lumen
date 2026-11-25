import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/auth';
import { WorkspaceProvider } from '../lib/workspace';

export const metadata: Metadata = {
  title: 'Lumen — Covenant & Portfolio Intelligence',
  description: 'AI-native covenant testing and portfolio monitoring for private credit — every number traced to its source clause.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
