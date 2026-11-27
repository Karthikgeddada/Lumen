// Chart-family registry. The mapping from a chart id to its lazy echarts
// chunk is derived from the catalog's own `family` field — no chart id is
// ever listed here, so the catalog stays the single source of truth.
import { chartEntry } from './catalog';

// Each value maps to one lazy chunk in lib/charts/families/ that registers
// the echarts modules that family needs (echarts.use is idempotent).
export type ChartFamilyModule =
  | 'line'
  | 'bar'
  | 'pie'
  | 'scatter'
  | 'hierarchy'
  | 'stats'
  | 'misc'
  | 't3';

// catalog family base (the text before ' (') → lazy chunk
const BASE_OF: Record<string, ChartFamilyModule> = {
  line: 'line',
  bar: 'bar',
  pictorialBar: 'bar',
  pie: 'pie',
  scatter: 'scatter',
  candlestick: 'scatter',
  treemap: 'hierarchy',
  sunburst: 'hierarchy',
  sankey: 'hierarchy',
  tree: 'hierarchy',
  heatmap: 'stats',
  boxplot: 'stats',
  parallel: 'stats',
  radar: 'stats',
  calendar: 'stats',
  funnel: 'misc',
  gauge: 'misc',
  themeRiver: 'misc',
  graph: 'misc',
  custom: 'misc',
  chord: 'misc',
  'geo/map': 't3',
  'echarts-gl': 't3',
};

export function familyModuleOf(chartId: string): ChartFamilyModule | null {
  const entry = chartEntry(chartId);
  if (!entry) return null;
  const base = entry.family.split(' (')[0];
  return BASE_OF[base] ?? null;
}
