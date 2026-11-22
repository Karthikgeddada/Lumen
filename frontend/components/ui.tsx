'use client';

import { type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

export function Spinner({ size = 18 }: { size?: number }) {
  return <div className="spinner" style={{ width: size, height: size }} />;
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ icon, title, sub, action }: { icon?: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <AlertCircle size={20} />}</div>
      <div className="empty-title">{title}</div>
      {sub ? <div className="empty-sub">{sub}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = 480 }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode; width?: number;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }}>
        {title ? (
          <div className="card-header">
            <div className="card-title">{title}</div>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close" style={{ padding: '0 8px' }}>×</button>
          </div>
        ) : null}
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'var(--error-bg)', color: 'var(--error)', fontSize: 13, marginBottom: 14 }}>
      <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{message}</span>
    </div>
  );
}

export function Field({ label, hint, error, children }: {
  label?: string; hint?: string; error?: string | null; children: ReactNode;
}) {
  return (
    <div className="field">
      {label ? <label>{label}</label> : null}
      {children}
      {error ? <div className="error-text">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

const DOC_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  UPLOADING: { label: 'Uploading', cls: 'badge-neutral', dot: 'dot-idle' },
  QUEUED: { label: 'Queued', cls: 'badge-neutral', dot: 'dot-idle' },
  PROCESSING: { label: 'Processing', cls: 'badge-blue', dot: 'dot-blue' },
  COMPLETED: { label: 'Ready', cls: 'badge-success', dot: 'dot-success' },
  FAILED: { label: 'Failed', cls: 'badge-error', dot: 'dot-error' },
};

export function DocStatusBadge({ status }: { status: string }) {
  const s = DOC_STATUS[status] ?? { label: status, cls: 'badge-neutral', dot: 'dot-idle' };
  return (
    <span className={`badge ${s.cls}`}>
      <span className={`dot ${s.dot}`} />
      {status === 'PROCESSING' || status === 'QUEUED' || status === 'UPLOADING' ? <Spinner size={9} /> : null}
      {s.label}
    </span>
  );
}

export function DemoTag() {
  return <span className="badge badge-demo" title="Demo content — sample data, clearly distinct from your real documents">Demo</span>;
}

export function Confidence({ value }: { value: number | null | undefined }) {
  if (value == null) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;
  const pct = Math.round(value * 100);
  const cls = pct >= 90 ? 'badge-success' : pct >= 80 ? 'badge-warning' : 'badge-error';
  return <span className={`badge ${cls}`}>{pct}%</span>;
}

export function DerivationBadge({ d }: { d: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    REPORTED: { label: 'Reported', cls: 'badge-neutral' },
    CALCULATED: { label: 'Calculated', cls: 'badge-blue' },
    AI_INFERRED: { label: 'AI-inferred', cls: 'badge-warning' },
  };
  const m = map[d] ?? { label: d, cls: 'badge-neutral' };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

export function Avatar({ first, last, size = '' }: { first: string; last: string; size?: 'sm' | 'lg' | '' }) {
  return (
    <span className={`avatar ${size ? `avatar-${size}` : ''}`}>
      {`${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase()}
    </span>
  );
}

export function formatBytes(bytes: number | bigint | null | undefined): string {
  const b = typeof bytes === 'bigint' ? Number(bytes) : (bytes ?? 0);
  if (!b) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDate(iso);
}
