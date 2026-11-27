// Post-extraction figure validation (spec C1) — pure core (DB orchestration
// lives in validationRun.ts).
//
// Runs right after scale enrichment, before a human reviews. Checks:
//   1. Component sums — configured component fields should sum to the total
//      field within a tolerance (default 0.5%).
//   2. Balance-sheet identity — assets = liabilities + equity (tolerance).
//   3. Unit/scale consistency — the same field must carry the same unit and
//      the same scale multiplier across figures (this task AND stored
//      observations of the same metric — catches one quarter ingested in
//      millions while the rest is in thousands).
//   4. QoQ outlier — |Δ| vs the previous quarter's stored observation beyond
//      a configured % (default off until configured — growth is real).
// Flags land on the ExtractionResult as `note` additions + flagged=true, so
// the existing trust rule (a flagged figure can never be verified silently)
// forces a human to own every discrepancy before ingest. The pure core is
// unit-tested in validation.test.ts.

// Pure core ONLY — importing this file must not pull in prisma/config (unit
// tests import it without a database). DB orchestration lives in validationRun.ts.

import { parsePeriod, previousQuarter } from '../analytics/periods';

// ── Config (WorkspaceSetting key "validation.rules") ──────────────────
export type ValidationConfig = {
  componentSums?: { label?: string; total: string; components: string[]; tolerancePct?: number }[];
  balanceSheets?: { assets: string; liabilities: string[]; equity: string[]; tolerancePct?: number }[];
  qoqOutlierPct?: number | null;
};

export type Figure = {
  fieldKey: string;
  value: number | null; // scale-applied numeric value
  unit: string | null;
  scaleMultiplier: number | null;
  period: string | null;
};

// Returns flags per field key (empty arrays omitted). Pure.
export function validateFigures(
  config: ValidationConfig,
  figures: Figure[],
  previousValue: (fieldKey: string) => number | null,
): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  const add = (key: string, msg: string) => {
    const list = flags.get(key) ?? [];
    list.push(msg);
    flags.set(key, list);
  };
  const byKey = new Map<string, Figure>();
  for (const f of figures) if (f.value != null) byKey.set(f.fieldKey, f);

  const withinPct = (sum: number, total: number, tol: number | undefined) =>
    Math.abs(sum - total) <= ((tol ?? 0.5) / 100) * Math.max(1, Math.abs(total));

  // 1. Component sums
  for (const rule of config.componentSums ?? []) {
    const total = byKey.get(rule.total);
    const parts = (rule.components ?? []).map((c) => byKey.get(c)).filter(Boolean) as Figure[];
    if (!total || parts.length !== (rule.components ?? []).length) continue;
    const sum = parts.reduce((a, p) => a + (p.value ?? 0), 0);
    if (!withinPct(sum, total.value!, rule.tolerancePct)) {
      const msg = `${rule.label ?? 'Components'} sum to ${sum.toLocaleString()} but "${rule.total}" is ${total.value!.toLocaleString()} (tolerance ${rule.tolerancePct ?? 0.5}%)`;
      add(rule.total, msg);
      for (const c of rule.components ?? []) add(c, msg);
    }
  }

  // 2. Balance-sheet identity
  for (const rule of config.balanceSheets ?? []) {
    const assets = byKey.get(rule.assets);
    const l = (rule.liabilities ?? []).map((c) => byKey.get(c)).filter(Boolean) as Figure[];
    const e = (rule.equity ?? []).map((c) => byKey.get(c)).filter(Boolean) as Figure[];
    if (!assets || l.length !== (rule.liabilities ?? []).length || e.length !== (rule.equity ?? []).length) continue;
    const sum = [...l, ...e].reduce((a, p) => a + (p.value ?? 0), 0);
    if (!withinPct(sum, assets.value!, rule.tolerancePct)) {
      const msg = `Balance sheet does not balance: assets ${assets.value!.toLocaleString()} vs liabilities+equity ${sum.toLocaleString()} (tolerance ${rule.tolerancePct ?? 0.5}%)`;
      add(rule.assets, msg);
      for (const c of [...(rule.liabilities ?? []), ...(rule.equity ?? [])]) add(c, msg);
    }
  }

  // 3. Unit/scale consistency across figures sharing a field key — within this
  // set (multi-doc tasks) and against passed prior unit/multiplier context
  // (stored observations, joined by the orchestrator).
  const seen = new Map<string, { unit: string | null; multiplier: number | null }>();
  for (const f of figures) {
    const prev = seen.get(f.fieldKey);
    if (prev && (prev.unit ?? null) !== (f.unit ?? null)) {
      const msg = `Unit inconsistent for "${f.fieldKey}": ${prev.unit ?? 'none'} vs ${f.unit ?? 'none'}`;
      add(f.fieldKey, msg);
    } else if (prev && (prev.multiplier ?? null) !== (f.scaleMultiplier ?? null)) {
      const msg = `Scale multiplier inconsistent for "${f.fieldKey}": ${prev.multiplier ?? 'none'} vs ${f.scaleMultiplier ?? 'none'} — verify before ingest`;
      add(f.fieldKey, msg);
    }
    if (!prev) seen.set(f.fieldKey, { unit: f.unit ?? null, multiplier: f.scaleMultiplier ?? null });
  }

  // 4. QoQ outlier vs the previous quarter's stored observation
  const qoq = config.qoqOutlierPct;
  if (qoq != null && Number.isFinite(qoq) && qoq > 0) {
    for (const f of figures) {
      if (f.value == null || !f.period) continue;
      const prevQ = previousQuarter(f.period);
      if (!prevQ) continue;
      const prev = previousValue(f.fieldKey);
      if (prev == null || prev === 0) continue;
      const pct = (Math.abs(f.value - prev) / Math.abs(prev)) * 100;
      if (pct > qoq) {
        add(f.fieldKey, `QoQ change of ${pct.toFixed(1)}% vs ${prevQ} (${prev.toLocaleString()} → ${f.value.toLocaleString()}) exceeds the configured ${qoq}% — confirm this is real`);
      }
    }
  }

  return flags;
}

// DB orchestration for these checks lives in validationRun.ts


// Parsed, normalized period helper for routes/UI (config validation).
export function isValidPeriodLabel(s: string): boolean {
  return parsePeriod(s) != null;
}
