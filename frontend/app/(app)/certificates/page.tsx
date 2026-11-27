'use client';

import Link from 'next/link';
import { Award } from 'lucide-react';
import { EmptyState } from '../../../components/ui';

export default function Certificates() {
  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="page-title">Certificates</div>
          <div className="page-desc">Compliance and borrowing-base certificates by company.</div>
        </div>
        {/* Tab pair with Covenants — certificates' final home is a tab here (spec). */}
        <div className="tabs">
          <Link href="/covenants" className="tab">Covenant tests</Link>
          <Link href="/certificates" className="tab active">Certificates</Link>
        </div>
      </div>
      <div className="card">
        <EmptyState
          icon={<Award size={20} />}
          title="Certificates — coming next"
          sub="Track each company's compliance certificates, validity windows, and expirations — filed automatically from the Data Room."
        />
      </div>
    </main>
  );
}
