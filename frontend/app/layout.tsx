import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/auth';
import { WorkspaceProvider } from '../lib/workspace';

export const metadata: Metadata = {
  title: 'Lumen — Document Intelligence',
  description: 'Read, question, and extract from your documents with verifiable AI.',
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
