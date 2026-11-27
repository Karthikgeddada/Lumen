'use client';

import { Briefcase } from 'lucide-react';
import { EmptyState } from '../../../components/ui';

export default function Portfolio() {
  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Portfolio</div>
          <div className="page-desc">Every company in this workspace, at a glance.</div>
        </div>
      </div>
      <div className="card">
        <EmptyState
          icon={<Briefcase size={20} />}
          title="Portfolio overview — coming next"
          sub="One grid across every borrower: latest financials, covenant status, and document coverage, linked to each company's Data Room folder."
        />
      </div>
    </main>
  );
}
