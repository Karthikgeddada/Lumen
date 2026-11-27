'use client';

import { Building2 } from 'lucide-react';
import { EmptyState } from '../../../components/ui';

export default function Borrowers() {
  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Borrowers</div>
          <div className="page-desc">Companies and borrowers tracked in this workspace.</div>
        </div>
      </div>
      <div className="card">
        <EmptyState
          icon={<Building2 size={20} />}
          title="Borrowers — coming next"
          sub="Each company gets a profile that links its Data Room folder, documents, covenants, certificates, and analytics together."
        />
      </div>
    </main>
  );
}
