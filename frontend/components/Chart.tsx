'use client';

// The registry-driven shared chart. Given a catalog chart id and
// whitelisted rows it lazily loads only that family's echarts chunk,
// builds the option via the pure builders (catalog + guardrails are the
// single source), and renders through the lean EChart wrapper. Every
// state is visible and height-stable (no layout shift): empty, refusal
// (with the reason — never a degrading fallback), a loading skeleton, a
// load failure. Clicking a point follows its evidence link through the
// ONE shared helper — every chart on the site click-throughs the same way.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import EChart from './EChart';
import { chartEntry } from '../lib/charts/catalog';
import { familyModuleOf, type ChartFamilyModule } from '../lib/charts/registry';
import { buildOption, buildRefusal, type BuilderInput, type ChartRow } from '../lib/charts/builders';
import { readChartColors, type LumenChartColors } from '../lib/charts/theme';
import { evidenceLinkFor } from '../lib/evidence';

const FAMILY_LOADERS: Record<ChartFamilyModule, () => Promise<unknown>> = {
  line: () => import('../lib/charts/families/line'),
  bar: () => import('../lib/charts/families/bar'),
  pie: () => import('../lib/charts/families/pie'),
  scatter: () => import('../lib/charts/families/scatter'),
  hierarchy: () => import('../lib/charts/families/hierarchy'),
  stats: () => import('../lib/charts/families/stats'),
  misc: () => import('../lib/charts/families/misc'),
  t3: () => import('../lib/charts/families/t3'),
};
const loadedFamilies = new Map<ChartFamilyModule, Promise<unknown>>();

export type ChartProps = Omit<BuilderInput, 'palette'> & {
  height?: number;
  emptyHint?: string;
  onPointClick?: (row: ChartRow) => void;
};

export default function Chart({ chartId, rows, height = 240, emptyHint, onPointClick, ...rest }: ChartProps) {
  const router = useRouter();
  const entry = chartEntry(chartId);
  const family = familyModuleOf(chartId);
  const experimental = process.env.NEXT_PUBLIC_CHARTS_EXPERIMENTAL === '1';
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Real palette once client-side; options are only consumed client-side.
  const [colors, setColors] = useState<LumenChartColors | null>(null);

  useEffect(() => {
    setColors(readChartColors());
  }, []);

  // Stable identity for the passthrough props so memos don't thrash.
  const restKey = JSON.stringify(rest);
  const restObj = useMemo(
    () => JSON.parse(restKey) as Omit<BuilderInput, 'palette' | 'chartId' | 'rows'>,
    [restKey],
  );

  const refusal = useMemo(
    () => (entry && family ? buildRefusal({ chartId, rows, ...restObj }) : null),
    [entry, family, chartId, rows, restObj],
  );

  const gated = entry?.tier === 'T3' && !experimental;

  // Lazy-load the family chunk exactly once per family; repeated renders
  // share the cached promise.
  useEffect(() => {
    if (!entry || !family || gated || refusal || failed || ready) return;
    let alive = true;
    let p = loadedFamilies.get(family);
    if (!p) {
      p = FAMILY_LOADERS[family]();
      loadedFamilies.set(family, p);
    }
    p.then(() => {
      if (alive) setReady(true);
    }).catch(() => {
      if (alive) setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [entry, family, gated, refusal, failed, ready]);

  const option = useMemo(() => {
    if (!ready || !colors) return null;
    return buildOption({
      chartId,
      rows,
      palette: colors.palette,
      warningColor: colors.warning,
      errorColor: colors.error,
      mutedColor: colors.textMuted,
      hairlineColor: colors.hairline,
      ...restObj,
    });
  }, [ready, colors, chartId, rows, restObj]);

  // The single click path: any data point carrying its source row opens
  // the backing document (source unavailable rows simply do nothing —
  // their tooltip already said so).
  const handleChartClick = (params: Record<string, unknown>) => {
    const data = (params.data ?? {}) as Record<string, unknown>;
    const row = data.row as ChartRow | undefined;
    if (!row || typeof row !== 'object') return;
    onPointClick?.(row);
    const link = evidenceLinkFor(row);
    if (link) router.push(link.href);
  };

  const state = (children: ReactNode, cls: string) => (
    <div className={`chart-state ${cls}`} style={{ height }} role="status">
      {children}
    </div>
  );

  if (!entry) return state(<p>Unknown chart: <code>{chartId}</code></p>, 'chart-notice');
  if (gated) {
    return state(
      <p>{entry.family} is experimental — enable <code>NEXT_PUBLIC_CHARTS_EXPERIMENTAL=1</code> to try it.</p>,
      'chart-notice',
    );
  }
  if (!family) return state(<p>No renderer registered for {entry.family}.</p>, 'chart-notice');
  if (!rows || rows.length === 0) {
    return state(<p>{emptyHint ?? 'No data to chart yet — upload documents to populate this view.'}</p>, 'chart-empty');
  }
  if (refusal) return state(<p>{refusal}</p>, 'chart-notice');
  if (failed) return state(<p>Chart failed to load — refresh the page.</p>, 'chart-notice');
  if (!ready || !option) return state(<div className="chart-skeleton" />, 'chart-loading');

  return (
    <>
      <EChart option={option} height={height} onChartClick={handleChartClick} ariaLabel={entry.family} />
      {entry.tier !== 'T1' && entry.caution ? <p className="chart-caution">{entry.caution}</p> : null}
    </>
  );
}
