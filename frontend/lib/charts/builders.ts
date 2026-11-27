// Pure ECharts option builders. Input: whitelisted dataset rows + a
// catalog chart id → a plain option object (records and functions only, no
// echarts import), so options build identically in node tests and the
// browser. Every guardrail the backend enforces is re-enforced here at
// render time: scale flags stay visible on the point, flagged points are
// excluded from aggregates (stacks, pies, treemaps, denominators, bridges),
// bars start at zero, stacking requires declared additivity, pies face the
// slice constraints, and charts whose data Lumen cannot serve return null
// with a refusal reason instead of degrading into something misleading.

import { chartEntry } from './catalog';
import { comparePeriods } from './periods';
import { pieConstraints } from './guardrails';
import { formatValue, compactNumber } from '../format';
import { evidenceLabel } from '../evidence';

export type ChartRow = Record<string, unknown>;
export type ChartOption = Record<string, unknown>;

export type MarkLineSpec = { x?: string; y?: number; label?: string };
export type MarkAreaSpec = { from?: string; to?: string; label?: string };
export type BuilderLayers = { markLines?: MarkLineSpec[]; markAreas?: MarkAreaSpec[] };

export type BuilderInput = {
  chartId: string;
  rows: ChartRow[];
  palette?: string[];
  title?: string;
  subtitle?: string;
  unit?: string | null;
  /** per-series / per-category grouping key (default 'entityName') */
  seriesKey?: string;
  /** category / time axis key (default 'period') */
  xKey?: string;
  valueKey?: string;
  /** status matrix: row field holding the status (default 'status') */
  statusKey?: string;
  /** status matrix: status → color overrides */
  statusColors?: Record<string, string>;
  /** caller-asserted additivity — required before any stacking */
  additive?: boolean;
  warningColor?: string;
  errorColor?: string;
  mutedColor?: string;
  hairlineColor?: string;
  layers?: BuilderLayers;
};

const DEFAULT_PALETTE = ['#0071e3', '#1d9e44', '#b7791f', '#d93025', '#7c5cbf', '#0f8b8d'];
const BASE_SERIES = '__base'; // waterfall helper bars — hidden from tooltips
const GRID = { left: 8, right: 16, top: 44, bottom: 8, containLabel: true };

type Ctx = {
  palette: string[];
  warning: string;
  error: string;
  muted: string;
  hairline: string;
  unit: string | null;
  xKey: string;
  seriesKey: string;
  valueKey: string;
};

function ctxOf(input: BuilderInput): Ctx {
  return {
    palette: input.palette ?? DEFAULT_PALETTE,
    warning: input.warningColor ?? '#b7791f',
    error: input.errorColor ?? '#d93025',
    muted: input.mutedColor ?? '#6e6e73',
    hairline: input.hairlineColor ?? '#e8e8ed',
    unit: input.unit ?? null,
    xKey: input.xKey ?? 'period',
    seriesKey: input.seriesKey ?? 'entityName',
    valueKey: input.valueKey ?? 'value',
  };
}

// ── row helpers ────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isFlagged = (r: ChartRow): boolean =>
  (Array.isArray(r.scaleFlags) && (r.scaleFlags as unknown[]).length > 0) || r.unitUnresolved === true;

function flagText(r: ChartRow): string | null {
  const flags = Array.isArray(r.scaleFlags) ? (r.scaleFlags as unknown[]).filter((f): f is string => typeof f === 'string') : [];
  if (r.unitUnresolved === true) flags.push('unit unresolved');
  return flags.length ? flags.join('; ') : null;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Unique category values, period-aware order, lexical fallback. */
function periodsOf(rows: ChartRow[], xKey: string): string[] {
  const ps = uniq(rows.map((r) => str(r[xKey])).filter((p): p is string => p !== null));
  return ps.sort(comparePeriods);
}

function groupOf(rows: ChartRow[], key: string): string[] {
  return uniq(rows.map((r) => str(r[key])).filter((s): s is string => s !== null));
}

/** Series names with a single anonymous fallback when the key is absent. */
function seriesNamesOf(rows: ChartRow[], key: string): string[] {
  const g = groupOf(rows, key);
  return g.length ? g : [''];
}

type PointItem = {
  value: number | null;
  flag?: string;
  itemStyle?: Record<string, unknown>;
  row?: ChartRow;
};

/** A data point carrying its flag (dashed ring), value and source row. */
function pointItem(row: ChartRow | undefined, valueKey: string, warning: string): PointItem {
  if (!row) return { value: null };
  const flag = flagText(row);
  const v = num(row[valueKey]);
  if (!flag) return { value: v, row };
  return {
    value: v,
    flag,
    row,
    itemStyle: { borderColor: warning, borderWidth: 2, borderType: 'dashed' },
  };
}

/** Rows of the latest period only — composition snapshots are never summed across time. */
function latestPeriodRows(rows: ChartRow[]): ChartRow[] {
  const ps = periodsOf(rows, 'period');
  if (ps.length === 0) return rows;
  return rows.filter((r) => str(r.period) === ps[ps.length - 1]);
}

function axisBase(c: Ctx, split: boolean): Record<string, unknown> {
  return {
    axisLine: { lineStyle: { color: c.hairline } },
    axisTick: { show: false },
    axisLabel: { color: c.muted, fontSize: 11 },
    splitLine: split ? { lineStyle: { color: c.hairline } } : { show: false },
  };
}

function valueAxis(c: Ctx, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'value',
    min: 0, // bars and areas start at zero — a chart-brain guardrail
    ...axisBase(c, true),
    axisLabel: { formatter: (v: number) => compactNumber(v), color: c.muted, fontSize: 11 },
    ...extra,
  };
}

function catAxis(c: Ctx, data: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'category', data, ...axisBase(c, false), ...extra };
}

function titleOf(input: BuilderInput): Record<string, unknown> | undefined {
  if (!input.title) return undefined;
  return { text: input.title, subtext: input.subtitle, left: 'left', top: 0 };
}

/** Covenant thresholds (step markLines) and near-breach bands (markAreas). */
function marksOf(input: BuilderInput, c: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ml = input.layers?.markLines ?? [];
  const ma = input.layers?.markAreas ?? [];
  if (ml.length) {
    out.markLine = {
      silent: true,
      symbol: 'none',
      lineStyle: { color: c.warning, type: 'dashed', width: 1 },
      label: { formatter: '{b}', position: 'insideEndTop', color: c.muted, fontSize: 10 },
      data: ml.map((m) =>
        m.y !== undefined ? { name: m.label ?? '', yAxis: m.y } : { name: m.label ?? '', xAxis: m.x },
      ),
    };
  }
  if (ma.length) {
    out.markArea = {
      silent: true,
      itemStyle: { color: c.warning, opacity: 0.06 },
      label: { color: c.muted, fontSize: 10 },
      data: ma.map((m) => [{ name: m.label ?? '', xAxis: m.from }, { xAxis: m.to }]),
    };
  }
  return out;
}

// ── tooltips (shared formatters: value, flag note, source link hint) ──

function sourceLine(row: ChartRow | undefined): string {
  return row ? `<br/>${evidenceLabel(row)}` : '';
}

function axisTooltip(c: Ctx): Record<string, unknown> {
  return {
    trigger: 'axis',
    formatter: (params: unknown): string => {
      const arr = Array.isArray(params) ? (params as Array<Record<string, unknown>>) : [params as Record<string, unknown>];
      return arr
        .filter((p) => p.seriesName !== BASE_SERIES)
        .map((p) => {
          const data = (p.data ?? {}) as Record<string, unknown>;
          const v = Array.isArray(data.value) ? (data.value as unknown[])[1] : data.value;
          const flag = typeof data.flag === 'string' ? `<br/>⚠ ${data.flag}` : '';
          const head = `${String(p.marker ?? '')}${String(p.seriesName ?? '')}${p.seriesName ? ' · ' : ''}${String(p.name ?? '')}`;
          return `${head}: ${formatValue(typeof v === 'number' ? v : null, c.unit)}${flag}${sourceLine(data.row as ChartRow | undefined)}`;
        })
        .join('<br/>');
    },
  };
}

function itemTooltip(c: Ctx): Record<string, unknown> {
  return {
    trigger: 'item',
    formatter: (params: unknown): string => {
      const p = params as Record<string, unknown>;
      const data = (p.data ?? {}) as Record<string, unknown>;
      const row = (data.row ?? {}) as ChartRow;
      const v = Array.isArray(data.value) ? (data.value as unknown[])[(data.value as unknown[]).length - 1] : data.value;
      const head = `${String(p.name ?? '')}`;
      const flag = flagText(row) ? `<br/>⚠ ${flagText(row)}` : '';
      return `${head}: ${formatValue(typeof v === 'number' ? v : null, c.unit)}${flag}${sourceLine(Object.keys(row).length ? row : undefined)}`;
    },
  };
}

// ── shared series fragments ────────────────────────────────────────

function linesOf(input: BuilderInput, c: Ctx, opts: { step?: boolean; area?: boolean }): Array<Record<string, unknown>> {
  const names = seriesNamesOf(input.rows, c.seriesKey);
  return names.map((n, i) => ({
    name: n,
    type: 'line',
    step: opts.step ? 'end' : undefined,
    smooth: false, // straight segments — honest slopes, no smoothed illusions
    connectNulls: false, // gaps stay gaps
    showSymbol: true,
    symbolSize: 6,
    lineStyle: { width: 2 },
    areaStyle: opts.area ? { opacity: 0.15 } : undefined,
    stack: opts.area && input.additive && names.length > 1 ? 'total' : undefined,
    emphasis: { focus: 'series' },
    ...(i === 0 ? marksOf(input, c) : {}),
    data: periodsOf(input.rows, c.xKey).map((p) => {
      const row = input.rows.find((r) => (str(r[c.seriesKey]) ?? '') === n && str(r[c.xKey]) === p);
      return pointItem(row, c.valueKey, c.warning);
    }),
  }));
}

/** Non-flagged value sum of a category — denominator for normalization. */
function denomOf(rows: ChartRow[], c: Ctx, cat: string): number {
  return rows
    .filter((r) => str(r[c.xKey]) === cat && !isFlagged(r))
    .reduce((s, r) => s + (num(r[c.valueKey]) ?? 0), 0);
}

// ── builders ──────────────────────────────────────────────────────

function lineOption(input: BuilderInput, c: Ctx, opts: { step?: boolean; area?: boolean }): ChartOption {
  const periods = periodsOf(input.rows, c.xKey);
  const names = seriesNamesOf(input.rows, c.seriesKey);
  return {
    title: titleOf(input),
    grid: GRID,
    legend: names.length > 1 ? { top: 4, left: 'center' } : undefined,
    tooltip: axisTooltip(c),
    xAxis: catAxis(c, periods, { boundaryGap: true }),
    yAxis: valueAxis(c),
    series: linesOf(input, c, opts),
  };
}

function sparklineOption(input: BuilderInput, c: Ctx): ChartOption {
  const first = seriesNamesOf(input.rows, c.seriesKey)[0];
  const rows = input.rows.filter((r) => (str(r[c.seriesKey]) ?? '') === first);
  const periods = periodsOf(rows, c.xKey);
  return {
    animation: false,
    series: [
      {
        type: 'line',
        smooth: false,
        connectNulls: false,
        showSymbol: periods.length <= 12,
        symbolSize: 3,
        lineStyle: { width: 1.5 },
        silent: true,
        data: periods.map((p) => {
          const row = rows.find((r) => str(r[c.xKey]) === p);
          return pointItem(row, c.valueKey, c.warning);
        }),
      },
    ],
  };
}

function barOption(
  input: BuilderInput,
  c: Ctx,
  opts: { horizontal?: boolean; stack?: boolean; normalize?: boolean; pictorial?: boolean },
): ChartOption {
  const cats = periodsOf(input.rows, c.xKey);
  const names = seriesNamesOf(input.rows, c.seriesKey);
  const series = names.map((n) => ({
    name: n,
    type: opts.pictorial ? 'pictorialBar' : 'bar',
    stack: opts.stack ? 'total' : undefined,
    barMaxWidth: 40,
    symbol: opts.pictorial ? 'roundRect' : undefined,
    symbolRepeat: opts.pictorial ? true : undefined,
    symbolSize: opts.pictorial ? [6, 6] : undefined,
    itemStyle: { borderRadius: opts.horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] },
    emphasis: { focus: opts.stack ? 'series' : undefined },
    data: cats.map((cat) => {
      const row = input.rows.find((r) => (str(r[c.seriesKey]) ?? '') === n && str(r[c.xKey]) === cat);
      const item = pointItem(row, c.valueKey, c.warning);
      if (!opts.normalize) return item;
      const v = num(item.value);
      const flagged = row ? isFlagged(row) : false;
      const denom = denomOf(input.rows, c, cat);
      if (!flagged && v !== null && denom > 0) return { ...item, value: (v / denom) * 100 };
      return { ...item, value: null, flag: flagged ? item.flag : undefined };
    }),
  }));
  const valAxis = valueAxis(c, opts.normalize ? { max: 100 } : {});
  if (opts.normalize) valAxis.axisLabel = { formatter: (v: number) => `${v}%`, color: c.muted, fontSize: 11 };
  return {
    title: titleOf(input),
    grid: GRID,
    legend: names.length > 1 ? { top: 4, left: 'center' } : undefined,
    tooltip: axisTooltip(c),
    xAxis: opts.horizontal ? valAxis : catAxis(c, cats),
    yAxis: opts.horizontal ? catAxis(c, cats) : valAxis,
    series,
  };
}

function waterfallOption(input: BuilderInput, c: Ctx): ChartOption {
  const periods = periodsOf(input.rows, c.xKey);
  let running = 0;
  const base: number[] = [];
  const deltas: PointItem[] = [];
  for (const p of periods) {
    const row = input.rows.find((r) => str(r[c.xKey]) === p);
    const item = pointItem(row, c.valueKey, c.warning);
    base.push(running);
    if (row && isFlagged(row)) {
      deltas.push({ value: null, flag: item.flag ?? 'flagged — excluded from the bridge' });
    } else {
      deltas.push({
        ...item,
        itemStyle: { ...(item.itemStyle ?? {}), color: (item.value ?? 0) >= 0 ? c.palette[0] : c.error },
      });
      running += item.value ?? 0;
    }
  }
  return {
    title: titleOf(input),
    grid: GRID,
    tooltip: axisTooltip(c),
    xAxis: catAxis(c, periods),
    yAxis: valueAxis(c),
    series: [
      {
        name: BASE_SERIES,
        type: 'bar',
        stack: 'w',
        silent: true,
        itemStyle: { color: 'transparent' },
        emphasis: { disabled: true },
        data: base,
      },
      {
        name: input.title ?? 'change',
        type: 'bar',
        stack: 'w',
        barMaxWidth: 40,
        data: deltas,
        ...marksOf(input, c),
      },
    ],
  };
}

function statusColorOf(status: string, c: Ctx, overrides?: Record<string, string>): string {
  const o = overrides ?? {};
  if (o[status]) return o[status];
  const k = status.toLowerCase();
  if (k.includes('breach') || k.includes('violation')) return c.error;
  if (k.includes('waiv')) return c.warning;
  if (k.includes('compl') || k.includes('cured') || k.includes('pass') || k.includes('ok')) return c.palette[1];
  if (k.includes('prior') || k.includes('exempt') || k.includes('monitor')) return c.palette[0];
  return c.muted;
}

function heatmapOption(input: BuilderInput, c: Ctx): ChartOption {
  const xs = periodsOf(input.rows, c.xKey);
  const ys = groupOf(input.rows, c.seriesKey);
  const withStatus = Boolean(input.statusKey);
  const data = input.rows
    .map((r) => {
      const xi = xs.indexOf(str(r[c.xKey]) ?? '');
      const yi = ys.indexOf(str(r[c.seriesKey]) ?? '');
      if (xi < 0 || yi < 0) return null;
      if (withStatus) {
        const s = str(r[input.statusKey as string]);
        if (!s) return null;
        return { value: [xi, yi, 1], name: s, itemStyle: { color: statusColorOf(s, c, input.statusColors) }, row: r };
      }
      const v = num(r[c.valueKey]);
      if (v === null) return null;
      const flag = flagText(r);
      return {
        value: [xi, yi, v],
        row: r,
        ...(flag ? { flag, itemStyle: { borderColor: c.warning, borderWidth: 2, borderType: 'dashed' } } : {}),
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
  const nums = data.map((d) => num((d.value as unknown[])[2]) ?? 0);
  return {
    title: titleOf(input),
    grid: { ...GRID, top: 24 },
    tooltip: itemTooltip(c),
    xAxis: catAxis(c, xs),
    yAxis: catAxis(c, ys),
    visualMap: withStatus
      ? { show: false }
      : {
          min: Math.min(...(nums.length ? nums : [0]), 0),
          max: Math.max(...(nums.length ? nums : [1]), 1),
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          inRange: { color: [c.hairline, c.palette[0]] },
          textStyle: { color: c.muted },
        },
    series: [
      {
        type: 'heatmap',
        data,
        label: { show: xs.length * ys.length <= 30, fontSize: 10, color: c.muted },
      },
    ],
  };
}

function matrixOption(input: BuilderInput, c: Ctx): ChartOption {
  return heatmapOption({ ...input, statusKey: input.statusKey ?? 'status' }, c);
}

function scatterOption(input: BuilderInput, c: Ctx, opts: { bubble?: boolean }): ChartOption {
  const xsNum = input.rows.map((r) => num(r[c.xKey]));
  const numericX = input.rows.length > 0 && xsNum.every((v) => v !== null);
  const labels = numericX ? (xsNum as number[]).map((v) => String(v)) : periodsOf(input.rows, c.xKey);
  const names = seriesNamesOf(input.rows, c.seriesKey);
  const sizeKey = input.statusKey ?? 'confidence'; // bubble sizing measure
  const sizes = input.rows.map((r) => num(r[sizeKey])).filter((v): v is number => v !== null);
  const sizeMax = Math.max(...(sizes.length ? sizes : [1]), 1);
  const series = names.map((n) => ({
    name: n,
    type: 'scatter',
    symbolSize: opts.bubble
      ? (val: unknown): number => {
          const xv = String(Array.isArray(val) ? (val as unknown[])[0] : val);
          const row = input.rows.find((r) => (str(r[c.seriesKey]) ?? '') === n && String(numericX ? num(r[c.xKey]) : str(r[c.xKey])) === xv);
          const s = row ? num(row[sizeKey]) : null;
          return s !== null ? 8 + (s / sizeMax) * 24 : 10;
        }
      : 10,
    emphasis: { focus: 'series' },
    data: input.rows
      .filter((r) => (str(r[c.seriesKey]) ?? '') === n)
      .map((r) => {
        const xv = numericX ? String(num(r[c.xKey])) : str(r[c.xKey]) ?? '';
        const v = num(r[c.valueKey]);
        return { value: [xv, v], row: r };
      }),
  }));
  return {
    title: titleOf(input),
    grid: GRID,
    legend: names.length > 1 ? { top: 4, left: 'center' } : undefined,
    tooltip: itemTooltip(c),
    xAxis: catAxis(c, labels),
    yAxis: valueAxis(c, { min: undefined }),
    series,
  };
}

function timelineOption(input: BuilderInput, c: Ctx): ChartOption {
  const tKey = input.xKey ?? 'time';
  const rows = input.rows.filter((r) => str(r[tKey]));
  const labels = uniq(rows.map((r) => str(r[tKey]) as string)).sort();
  const names = seriesNamesOf(rows, c.seriesKey);
  const series = names.map((n) => ({
    name: n,
    type: 'scatter',
    symbolSize: 10,
    data: rows
      .filter((r) => (str(r[c.seriesKey]) ?? '') === n)
      .map((r) => ({ value: [labels.indexOf(str(r[tKey]) as string), 1], row: r })),
  }));
  return {
    title: titleOf(input),
    grid: { ...GRID, top: 24 },
    tooltip: itemTooltip(c),
    xAxis: catAxis(c, labels, { axisLabel: { rotate: labels.length > 6 ? 35 : 0, color: c.muted, fontSize: 11 } }),
    yAxis: { type: 'value', show: false, min: 0, max: 2 },
    series,
  };
}

function pieOption(input: BuilderInput, c: Ctx, opts: { doughnut?: boolean; rose?: boolean }): ChartOption {
  const rows = latestPeriodRows(input.rows).filter((r) => !isFlagged(r));
  const names = groupOf(rows, c.seriesKey);
  const parts = names
    .map((n) => ({
      label: n,
      value: rows
        .filter((r) => str(r[c.seriesKey]) === n)
        .reduce((s, r) => s + (num(r[c.valueKey]) ?? 0), 0),
    }))
    .filter((p) => p.value !== 0);
  return {
    title: titleOf(input),
    legend: { bottom: 0, type: 'scroll' },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown): string => {
        const p = params as Record<string, unknown>;
        return `${String(p.marker ?? '')}${String(p.name ?? '')}: ${formatValue(num(p.value), c.unit)} (${String(p.percent ?? '')}%)`;
      },
    },
    series: [
      {
        type: 'pie',
        radius: opts.doughnut ? ['45%', '75%'] : '70%',
        roseType: opts.rose ? 'radius' : undefined,
        center: ['50%', '52%'],
        data: parts.map((p) => ({ name: p.label, value: p.value })),
        label: { formatter: '{b} — {d}%', color: c.muted, fontSize: 11 },
        emphasis: { focus: 'data' },
      },
    ],
  };
}

function treemapOption(input: BuilderInput, c: Ctx, sunburst: boolean): ChartOption {
  const rows = latestPeriodRows(input.rows);
  const names = groupOf(rows, c.seriesKey);
  const data = names.map((n) => {
    const rs = rows.filter((r) => str(r[c.seriesKey]) === n);
    const clean = rs.filter((r) => !isFlagged(r));
    const total = clean.reduce((s, r) => s + (num(r[c.valueKey]) ?? 0), 0);
    const hasFlagged = clean.length !== rs.length;
    return {
      name: n,
      value: total,
      ...(hasFlagged ? { itemStyle: { borderColor: c.warning, borderWidth: 2, borderType: 'dashed' } } : {}),
    };
  });
  return {
    title: titleOf(input),
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown): string => {
        const p = params as Record<string, unknown>;
        return `${String(p.name ?? '')}: ${formatValue(num(p.value), c.unit)}`;
      },
    },
    series: sunburst
      ? [{ type: 'sunburst', radius: ['12%', '90%'], data, label: { fontSize: 10 } }]
      : [{ type: 'treemap', data, roam: false, leafDepth: 1, upperLabel: { show: true }, itemStyle: { gapWidth: 2 } }],
  };
}

function sankeyOption(input: BuilderInput, c: Ctx): ChartOption {
  const links = input.rows
    .filter((r) => !isFlagged(r) && str(r.from) && str(r.to))
    .map((r) => ({ source: str(r.from) as string, target: str(r.to) as string, value: num(r[c.valueKey]) ?? 1 }));
  const nodes = uniq(links.flatMap((l) => [l.source, l.target])).map((n) => ({ name: n }));
  return {
    title: titleOf(input),
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'sankey',
        data: nodes,
        links,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'gradient', opacity: 0.35 },
        label: { fontSize: 11 },
      },
    ],
  };
}

type TreeNode = { name: string; children: TreeNode[] };

function treeOption(input: BuilderInput, c: Ctx): ChartOption {
  const nodeRows = input.rows.filter((r) => str(r.node));
  const byName = new Map<string, TreeNode>();
  for (const r of nodeRows) {
    const n = str(r.node) as string;
    if (!byName.has(n)) byName.set(n, { name: n, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const r of nodeRows) {
    const n = str(r.node) as string;
    const p = str(r.parent);
    const node = byName.get(n) as TreeNode;
    if (p && byName.has(p) && p !== n) (byName.get(p) as TreeNode).children.push(node);
    else roots.push(node);
  }
  return {
    title: titleOf(input),
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'tree',
        data: roots,
        orient: 'LR',
        symbolSize: 7,
        initialTreeDepth: -1,
        expandAndCollapse: false,
        label: { position: 'right', fontSize: 11 },
        leaves: { label: { position: 'right', fontSize: 11 } },
        lineStyle: { color: c.hairline },
      },
    ],
  };
}

function graphOption(input: BuilderInput, c: Ctx, circular: boolean): ChartOption {
  const nodeRows = input.rows.filter((r) => str(r.node));
  const nodes = uniq(nodeRows.map((r) => str(r.node) as string)).map((n) => ({ name: n, symbolSize: 10 }));
  const links = nodeRows
    .filter((r) => str(r.parent))
    .map((r) => ({ source: str(r.parent) as string, target: str(r.node) as string }));
  return {
    title: titleOf(input),
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'graph',
        layout: circular ? 'circular' : 'force',
        circular: circular ? { rotateLabel: true } : undefined,
        force: circular ? undefined : { repulsion: 120, edgeLength: 60 },
        data: nodes,
        links,
        roam: false,
        label: { show: true, fontSize: 10, color: c.muted },
        edgeSymbol: ['none', 'arrow'],
        lineStyle: { opacity: 0.4 },
      },
    ],
  };
}

function funnelOption(input: BuilderInput, c: Ctx): ChartOption {
  const stages = input.rows
    .filter((r) => !isFlagged(r))
    .map((r) => ({ name: str(r.stage) ?? str(r[c.seriesKey]) ?? '', value: num(r[c.valueKey]) }))
    .filter((s): s is { name: string; value: number } => s.name !== '' && s.value !== null)
    .sort((a, b) => b.value - a.value);
  return {
    title: titleOf(input),
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'funnel',
        data: stages,
        sort: 'descending',
        gap: 2,
        label: { formatter: '{b}: {c}', fontSize: 11 },
        emphasis: { focus: 'data' },
      },
    ],
  };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function boxplotGroups(rows: ChartRow[], c: Ctx): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const names = seriesNamesOf(rows, c.seriesKey);
  for (const n of names) {
    const rs = rows.filter((r) => (str(r[c.seriesKey]) ?? '') === n && !isFlagged(r));
    const vals: number[] = [];
    for (const r of rs) {
      if (Array.isArray(r.values)) {
        for (const v of r.values as unknown[]) {
          const nv = num(v);
          if (nv !== null) vals.push(nv);
        }
      } else {
        const nv = num(r[c.valueKey]);
        if (nv !== null) vals.push(nv);
      }
    }
    out.set(n, vals);
  }
  return out;
}

function boxplotOption(input: BuilderInput, c: Ctx): ChartOption {
  const groups = boxplotGroups(input.rows, c);
  const names = [...groups.keys()];
  const data = names.map((n) => {
    const s = (groups.get(n) as number[]).sort((a, b) => a - b);
    return [s[0], quantile(s, 0.25), quantile(s, 0.5), quantile(s, 0.75), s[s.length - 1]];
  });
  return {
    title: titleOf(input),
    grid: GRID,
    tooltip: { trigger: 'item' },
    xAxis: catAxis(c, names),
    yAxis: valueAxis(c),
    series: [{ type: 'boxplot', data, itemStyle: { borderColor: c.palette[0] } }],
  };
}

function parallelOption(input: BuilderInput, c: Ctx): ChartOption {
  const names = groupOf(input.rows, c.seriesKey);
  const periods = periodsOf(input.rows, c.xKey);
  const data = periods.map((p) =>
    names.map((n) => {
      const row = input.rows.find((r) => str(r[c.seriesKey]) === n && str(r[c.xKey]) === p);
      return row && !isFlagged(row) ? num(row[c.valueKey]) : null;
    }),
  );
  return {
    title: titleOf(input),
    tooltip: {},
    parallel: { left: 48, right: 48, top: 60, bottom: 24 },
    parallelAxis: names.map((n, i) => ({ dim: i, name: n, nameTextStyle: { color: c.muted } })),
    series: [{ type: 'parallel', data, lineStyle: { width: 2, opacity: 0.7 } }],
  };
}

function radarOption(input: BuilderInput, c: Ctx): ChartOption {
  const names = groupOf(input.rows, c.seriesKey).slice(0, 8);
  const periods = periodsOf(input.rows, c.xKey).slice(-4);
  const indicator = names.map((n) => {
    const vs = input.rows
      .filter((r) => str(r[c.seriesKey]) === n && !isFlagged(r))
      .map((r) => num(r[c.valueKey]))
      .filter((v): v is number => v !== null);
    return { name: n, max: Math.max(...(vs.length ? vs : [1]), 1) * 1.1 };
  });
  return {
    title: titleOf(input),
    legend: { bottom: 0 },
    tooltip: {},
    radar: { indicator, radius: '65%' },
    series: [
      {
        type: 'radar',
        data: periods.map((p) => ({
          name: p,
          value: names.map((n) => {
            const row = input.rows.find((r) => str(r[c.seriesKey]) === n && str(r[c.xKey]) === p);
            return row && !isFlagged(row) ? num(row[c.valueKey]) : null;
          }),
        })),
      },
    ],
  };
}

function gaugeOption(input: BuilderInput, c: Ctx): ChartOption {
  const rows = latestPeriodRows(input.rows).filter((r) => !isFlagged(r));
  const v = rows.map((r) => num(r[c.valueKey])).find((x): x is number => x !== null) ?? 0;
  const threshold = input.layers?.markLines?.find((m) => m.y !== undefined)?.y;
  const max = Math.max(Math.ceil(Math.abs(v) * 1.25), Math.ceil(Math.abs(threshold ?? 0) * 1.25), 1);
  return {
    title: titleOf(input),
    series: [
      {
        type: 'gauge',
        min: 0,
        max,
        startAngle: 200,
        endAngle: -20,
        progress: { show: true },
        axisLine: { lineStyle: { width: 12 } },
        axisTick: { show: false },
        splitLine: { length: 8, lineStyle: { color: c.hairline } },
        axisLabel: { color: c.muted, distance: 14, fontSize: 10 },
        pointer: { length: '60%', width: 4 },
        detail: {
          formatter: (x: number) => formatValue(x, c.unit),
          color: c.muted,
        },
        data: [{ value: v, name: input.title ?? '' }],
      },
    ],
  };
}

function periodToDate(p: string): string | null {
  const m = p.trim().match(/^Q([1-4])[\s-]+(\d{4})$/i);
  if (!m) return null;
  const month = (parseInt(m[1], 10) - 1) * 3 + 1;
  return `${m[2]}-${String(month).padStart(2, '0')}-01`;
}

function themeRiverOption(input: BuilderInput, c: Ctx): ChartOption {
  const rows = input.rows.filter((r) => {
    const d = periodToDate(str(r[c.xKey]) ?? '');
    return d !== null && !isFlagged(r);
  });
  const data = rows.map((r) => [periodToDate(str(r[c.xKey]) ?? '') as string, num(r[c.valueKey]) ?? 0, str(r[c.seriesKey]) ?? '']);
  return {
    title: titleOf(input),
    tooltip: { trigger: 'axis' },
    singleAxis: { type: 'time', top: 50, bottom: 50 },
    series: [{ type: 'themeRiver', data, label: { show: false } }],
  };
}

// ── refusals ───────────────────────────────────────────────────────

/**
 * Why a chart id cannot be built from these rows — pure, so the UI can show
 * the reason without loading any family chunk. Null when buildable.
 */
export function buildRefusal(input: BuilderInput): string | null {
  const { chartId, rows } = input;
  const entry = chartEntry(chartId);
  if (!entry) return `unknown chart id: ${chartId}`;
  const c = ctxOf(input);
  const periods = periodsOf(rows, c.xKey);
  const names = groupOf(rows, c.seriesKey);
  const values = rows.map((r) => num(r[c.valueKey])).filter((v): v is number => v !== null);
  const hasFlows = rows.some((r) => str(r.from) && str(r.to));
  const hasTree = rows.some((r) => str(r.node));

  switch (chartId) {
    case 'map':
    case 'lines-gl':
      return "needs GeoJSON region data — none of Lumen's datasets provide it";
    case 'bar3d':
    case 'scatter3d':
      return 'needs echarts-gl (not bundled) and three measures Lumen does not have';
    case 'calendar':
      return 'needs daily dates — Lumen periods are quarterly/annual';
    case 'candlestick':
      return 'needs OHLC fields (open/high/low/close) — no dataset provides them';
    case 'gantt':
      return 'needs start/end date fields — no dataset provides them';
    case 'chord':
      return hasTree ? null : 'needs a square flow matrix — no dataset provides one yet';
    case 'boxplot': {
      const groups = [...boxplotGroups(rows, c).values()];
      if (groups.length === 0 || groups.some((g) => g.length < 5)) {
        return 'needs ≥5 values per group to be honest about spread';
      }
      return null;
    }
    case 'line':
    case 'step-line':
    case 'area':
    case 'sparkline':
    case 'theme-river':
      return periods.length < 2 ? `needs ≥2 periods (found ${periods.length})` : null;
    case 'waterfall':
      return periods.length < 2 ? 'needs an ordered temporal bridge (≥2 periods)' : null;
    case 'bar':
    case 'bar-horizontal':
    case 'pictorial-bar':
      return periods.length === 0 || values.length === 0 ? 'needs categories with at least one value each' : null;
    case 'scatter':
    case 'bubble':
      if (periods.length === 0 || values.length === 0) return 'needs two measures with at least one point each';
      if (values.length < 3) return `needs ≥3 points (found ${values.length})`;
      return null;
    case 'bar-stacked':
    case 'bar-stacked-100':
      if (!input.additive) return 'stacking requires declared additive components';
      return periods.length === 0 || values.length === 0 ? 'needs additive components per category' : null;
    case 'pie':
    case 'doughnut':
    case 'nightingale': {
      const clean = latestPeriodRows(rows).filter((r) => !isFlagged(r));
      const parts = groupOf(clean, c.seriesKey).map((n) => ({
        label: n,
        value: clean.filter((r) => str(r[c.seriesKey]) === n).reduce((s, r) => s + (num(r[c.valueKey]) ?? 0), 0),
      }));
      if (parts.length < 2) return 'needs ≥2 parts to compare';
      const check = pieConstraints(parts);
      return check.ok ? null : check.reasons.join('; ');
    }
    case 'treemap':
    case 'sunburst':
      return names.length < 2 ? 'needs ≥2 parts to compose a whole' : null;
    case 'sankey':
      return hasFlows ? null : 'needs source → target flows with amounts';
    case 'tree':
    case 'graph':
      return hasTree ? null : 'needs parent-child nodes';
    case 'funnel': {
      const stages = rows.filter((r) => !isFlagged(r) && (str(r.stage) || str(r[c.seriesKey])));
      return stages.length < 2 ? 'needs ordered stages with counts' : null;
    }
    case 'radar':
      if (names.length < 3) return 'needs 3-8 dimensions on a common scale';
      if (names.length > 8) return 'needs 3-8 dimensions (more found)';
      return null;
    case 'parallel':
      if (names.length < 3) return 'needs ≥3 numeric dimensions to compare across rows';
      if (periods.length < 2) return 'needs ≥2 rows to compare';
      return null;
    case 'gauge':
      return values.length === 0 ? 'needs one value against a threshold range' : null;
    case 'heatmap':
    case 'matrix':
      if (chartId === 'matrix') {
        const sKey = input.statusKey ?? 'status';
        return rows.some((r) => str(r[sKey])) ? null : 'needs entities × covenants with statuses';
      }
      return periods.length === 0 || names.length === 0 ? 'needs two categorical axes with values' : null;
    case 'timeline': {
      const tKey = input.xKey ?? 'time';
      return rows.some((r) => str(r[tKey])) ? null : 'needs events with dates';
    }
    default:
      return null;
  }
}

/**
 * Rows + chart id → ECharts option, or null when refused (see
 * buildRefusal for the reason). Options are plain records with formatter
 * functions — no echarts import, fully buildable in node.
 */
export function buildOption(input: BuilderInput): ChartOption | null {
  if (buildRefusal(input) !== null) return null;
  const c = ctxOf(input);
  switch (input.chartId) {
    case 'line':
      return lineOption(input, c, {});
    case 'step-line':
      return lineOption(input, c, { step: true });
    case 'area':
      return lineOption(input, c, { area: true });
    case 'sparkline':
      return sparklineOption(input, c);
    case 'bar':
      return barOption(input, c, {});
    case 'bar-horizontal':
      return barOption(input, c, { horizontal: true });
    case 'pictorial-bar':
      return barOption(input, c, { pictorial: true });
    case 'bar-stacked':
      return barOption(input, c, { stack: true });
    case 'bar-stacked-100':
      return barOption(input, c, { stack: true, normalize: true });
    case 'waterfall':
      return waterfallOption(input, c);
    case 'heatmap':
      return heatmapOption(input, c);
    case 'matrix':
      return matrixOption(input, c);
    case 'scatter':
      return scatterOption(input, c, {});
    case 'bubble':
      return scatterOption(input, c, { bubble: true });
    case 'timeline':
      return timelineOption(input, c);
    case 'pie':
      return pieOption(input, c, {});
    case 'doughnut':
      return pieOption(input, c, { doughnut: true });
    case 'nightingale':
      return pieOption(input, c, { rose: true });
    case 'treemap':
      return treemapOption(input, c, false);
    case 'sunburst':
      return treemapOption(input, c, true);
    case 'sankey':
      return sankeyOption(input, c);
    case 'tree':
      return treeOption(input, c);
    case 'graph':
      return graphOption(input, c, false);
    case 'chord':
      return graphOption(input, c, true);
    case 'funnel':
      return funnelOption(input, c);
    case 'boxplot':
      return boxplotOption(input, c);
    case 'parallel':
      return parallelOption(input, c);
    case 'radar':
      return radarOption(input, c);
    case 'gauge':
      return gaugeOption(input, c);
    case 'theme-river':
      return themeRiverOption(input, c);
    default:
      return null; // unavailable charts refuse in buildRefusal
  }
}
