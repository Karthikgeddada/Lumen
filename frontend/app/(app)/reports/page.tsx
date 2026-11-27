'use client';

import { FileBarChart } from 'lucide-react';
import { EmptyState } from '../../../components/ui';

export default function Reports() {
  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-desc">Generated and scheduled workspace reports.</div>
        </div>
      </div>
      <div className="card">
        <EmptyState
          icon={<FileBarChart size={20} />}
          title="Reports — coming next"
          sub="Portfolio summaries, covenant compliance packs, and data-quality overviews — generated from Data Room documents and downloadable."
        />
      </div>
    </main>
  );
}
