// Option-builder tests: pure rows in → option records out, every guardrail
// observable in the produced option (flag visibility, exclusion from
// aggregates, zero-based bars, stacking gates, pie constraints, refusals).
import { describe, expect, it } from 'vitest';
import { buildOption, buildRefusal } from './builders';
import type { ChartRow } from './builders';

const rev = (
  entityName: string,
  period: string,
  value: number | null,
  extra: Record<string, unknown> = {},
): ChartRow => ({
  entityName,
  metricName: 'Revenue',
  period,
  value,
  unit: 'USD millions',
  ...extra,
});

describe('line family', () => {
  it('builds per-entity series, keeping gaps as nulls with connectNulls off', () => {
    const rows = [rev('Elm', 'Q1 2026', 100), rev('Elm', 'Q2 2026', 120), rev('Oak', 'Q1 2026', 80)];
    const opt = buildOption({ chartId: 'line', rows, unit: 'USD millions' });
    expect(opt).not.toBeNull();
    const series = opt?.series as Array<Record<string, unknown>>;
    expect(series).toHaveLength(2);
    const elm = series[0].data as Array<Record<string, unknown>>;
    expect(elm.map((d) => d.value)).toEqual([100, 120]);
    const oak = series[1].data as Array<Record<string, unknown>>;
    expect(oak[1].value).toBeNull(); // Oak has no Q2 — a gap, never zero
    expect(series[0].connectNulls).toBe(false);
    expect(series[0].smooth).toBe(false);
  });

  it('marks flagged points with a dashed ring and flag text', () => {
    const rows = [rev('Elm', 'Q1 2026', 100, { scaleFlags: ['AI_INFERRED'] }), rev('Elm', 'Q2 2026', 120)];
    const opt = buildOption({ chartId: 'line', rows });
    const d = (opt?.series as Array<Record<string, unknown>>)[0].data as Array<Record<string, unknown>>;
    expect(d[0].flag).toBe('AI_INFERRED');
    expect((d[0].itemStyle as Record<string, unknown>).borderType).toBe('dashed');
    expect(d[1].flag).toBeUndefined();
  });

  it('stacks areas only when additivity is declared', () => {
    const rows = [
      rev('Installations', 'Q1 2026', 30),
      rev('Installations', 'Q2 2026', 35),
      rev('Recurring', 'Q1 2026', 70),
      rev('Recurring', 'Q2 2026', 65),
    ];
    const plain = buildOption({ chartId: 'area', rows });
    expect((plain?.series as Array<Record<string, unknown>>)[0].stack).toBeUndefined();
    const stacked = buildOption({ chartId: 'area', rows, additive: true });
    expect((stacked?.series as Array<Record<string, unknown>>)[0].stack).toBe('total');
  });

  it('sparklines are silent and axis-free', () => {
    const rows = [rev('Elm', 'Q1 2026', 1), rev('Elm', 'Q2 2026', 2), rev('Elm', 'Q3 2026', 3)];
    const opt = buildOption({ chartId: 'sparkline', rows });
    expect(opt?.xAxis).toBeUndefined();
    expect(opt?.grid).toBeUndefined();
    expect((opt?.series as Array<Record<string, unknown>>)[0].silent).toBe(true);
  });
});

describe('bar family', () => {
  it('bars start at zero', () => {
    const rows = [rev('Elm', 'Q1 2026', 100), rev('Oak', 'Q1 2026', 80)];
    const opt = buildOption({ chartId: 'bar', rows, seriesKey: 'entityName', xKey: 'entityName' });
    expect((opt?.yAxis as Record<string, unknown>).min).toBe(0);
  });

  it('refuses to stack without declared additivity', () => {
    const rows = [
      rev('Installations', 'Q1 2026', 30),
      rev('Recurring', 'Q1 2026', 70),
    ];
    const refusal = buildRefusal({ chartId: 'bar-stacked', rows });
    expect(refusal).toContain('additive');
    expect(buildOption({ chartId: 'bar-stacked', rows })).toBeNull();
  });

  it('normalizes over non-flagged values only', () => {
    const rows = [
      rev('Installations', 'Q1 2026', 30),
      rev('Recurring', 'Q1 2026', 70, { scaleFlags: ['UNIT_MIX'] }),
    ];
    const opt = buildOption({ chartId: 'bar-stacked-100', rows, additive: true });
    const series = opt?.series as Array<Record<string, unknown>>;
    const installs = series[0].data as Array<Record<string, unknown>>;
    const recurring = series[1].data as Array<Record<string, unknown>>;
    // denominator excludes the flagged Recurring part → 30/30 = 100%
    expect(installs[0].value).toBe(100);
    expect(recurring[0].value).toBeNull();
    expect(recurring[0].flag).toBe('UNIT_MIX');
    expect((opt?.yAxis as Record<string, unknown>).max).toBe(100);
  });

  it('waterfall bridges cumulative totals and skips flagged periods', () => {
    const rows = [
      rev('Total', 'Q1 2026', 100),
      rev('Price', 'Q2 2026', 20),
      rev('Churn', 'Q3 2026', -10),
      rev('Flagged', 'Q4 2026', 5, { scaleFlags: ['AI_INFERRED'] }),
    ];
    const opt = buildOption({ chartId: 'waterfall', rows });
    const series = opt?.series as Array<Record<string, unknown>>;
    expect(series[0].data).toEqual([0, 100, 120, 110]); // helper stack
    const deltas = series[1].data as Array<Record<string, unknown>>;
    expect(deltas.map((d) => d.value)).toEqual([100, 20, -10, null]);
    expect(deltas[3].flag).toContain('AI_INFERRED');
  });
});

describe('pie constraints', () => {
  it('refuses more than 6 slices', () => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => rev(n, 'Q1 2026', 10));
    const refusal = buildRefusal({ chartId: 'pie', rows });
    expect(refusal).toContain('6-slice');
    expect(buildOption({ chartId: 'pie', rows })).toBeNull();
  });

  it('refuses parts that do not sum to a whole', () => {
    const rows = [rev('A', 'Q1 2026', 25), rev('B', 'Q1 2026', 25), rev('C', 'Q1 2026', 25)];
    expect(buildRefusal({ chartId: 'pie', rows })).toContain('sum to 75.0%');
  });

  it('builds honest parts and a doughnut variant', () => {
    const rows = [rev('Installations', 'Q1 2026', 60), rev('Recurring', 'Q1 2026', 40)];
    const pie = buildOption({ chartId: 'pie', rows });
    expect((pie?.series as Array<Record<string, unknown>>)[0].radius).toBe('70%');
    const doughnut = buildOption({ chartId: 'doughnut', rows });
    expect((doughnut?.series as Array<Record<string, unknown>>)[0].radius).toEqual(['45%', '75%']);
  });

  it('composes only the latest period', () => {
    const rows = [
      rev('A', 'Q1 2026', 60),
      rev('B', 'Q1 2026', 40),
      rev('A', 'Q2 2026', 50),
      rev('B', 'Q2 2026', 50),
    ];
    const opt = buildOption({ chartId: 'pie', rows });
    const data = (opt?.series as Array<Record<string, unknown>>)[0].data as Array<Record<string, unknown>>;
    expect(data).toEqual([
      { name: 'A', value: 50 },
      { name: 'B', value: 50 },
    ]);
  });
});

describe('status matrix and heatmap', () => {
  it('colors cells by covenant status', () => {
    const rows: ChartRow[] = [
      { entityName: 'Elm', covenantName: 'Leverage', status: 'BREACH' },
      { entityName: 'Oak', covenantName: 'Leverage', status: 'COMPLIANT' },
    ];
    const opt = buildOption({
      chartId: 'matrix',
      rows,
      xKey: 'covenantName',
      statusColors: { BREACH: '#d93025', COMPLIANT: '#1d9e44' },
    });
    const data = (opt?.series as Array<Record<string, unknown>>)[0].data as Array<Record<string, unknown>>;
    const colors = data.map((d) => (d.itemStyle as Record<string, unknown>).color);
    expect(colors).toContain('#d93025');
    expect(colors).toContain('#1d9e44');
  });

  it('matrix refuses rows without statuses', () => {
    expect(buildRefusal({ chartId: 'matrix', rows: [rev('Elm', 'Q1 2026', 1)] })).toContain('statuses');
  });
});

describe('hierarchy and flow', () => {
  it('treemap sums exclude flagged parts and ring them', () => {
    const rows = [
      rev('Installations', 'Q1 2026', 60),
      rev('Recurring', 'Q1 2026', 40, { scaleFlags: ['AI_INFERRED'] }),
      rev('Services', 'Q1 2026', 100),
    ];
    const opt = buildOption({ chartId: 'treemap', rows });
    const data = (opt?.series as Array<Record<string, unknown>>)[0].data as Array<Record<string, unknown>>;
    const recurring = data.find((d) => d.name === 'Recurring') as Record<string, unknown>;
    expect(recurring.value).toBe(0); // flagged 40 excluded from the whole
    expect((recurring.itemStyle as Record<string, unknown>).borderType).toBe('dashed');
    const services = data.find((d) => d.name === 'Services') as Record<string, unknown>;
    expect(services.value).toBe(100);
  });

  it('sankey builds nodes and links from from/to rows', () => {
    const rows: ChartRow[] = [
      { from: 'documents', to: 'observations', value: 12 },
      { from: 'observations', to: 'covenants', value: 8 },
    ];
    const opt = buildOption({ chartId: 'sankey', rows });
    const series = opt?.series as Array<Record<string, unknown>>;
    const nodes = (series[0].data as Array<Record<string, unknown>>).map((n) => n.name);
    expect(nodes).toEqual(expect.arrayContaining(['documents', 'observations', 'covenants']));
    expect(series[0].links).toHaveLength(2);
  });

  it('tree nests nodes by parent', () => {
    const rows: ChartRow[] = [
      { node: 'Leverage', parent: null },
      { node: 'Net debt', parent: 'Leverage' },
      { node: 'EBITDA', parent: 'Leverage' },
    ];
    const opt = buildOption({ chartId: 'tree', rows });
    const roots = (opt?.series as Array<Record<string, unknown>>)[0].data as Array<Record<string, unknown>>;
    expect(roots).toHaveLength(1);
    expect((roots[0].children as unknown[])).toHaveLength(2);
  });
});

describe('distribution and stats', () => {
  it('boxplot refuses fewer than 5 values per group', () => {
    const rows: ChartRow[] = [{ entityName: 'Elm', values: [1, 2, 3, 4] }];
    expect(buildRefusal({ chartId: 'boxplot', rows })).toContain('≥5 values');
    expect(buildOption({ chartId: 'boxplot', rows })).toBeNull();
  });

  it('boxplot computes five-number summaries', () => {
    const rows: ChartRow[] = [{ entityName: 'Elm', values: [7, 1, 6, 2, 5, 3, 4] }];
    const opt = buildOption({ chartId: 'boxplot', rows });
    const data = (opt?.series as Array<Record<string, unknown>>)[0].data as number[][];
    expect(data[0]).toEqual([1, 2.5, 4, 5.5, 7]);
  });

  it('radar needs 3-8 dimensions', () => {
    expect(buildRefusal({ chartId: 'radar', rows: [rev('Elm', 'Q1 2026', 1), rev('Oak', 'Q1 2026', 2)] })).toContain('3-8');
    const rows = ['Elm', 'Oak', 'Ash', 'Bee'].map((n) => rev(n, 'Q1 2026', 3));
    const opt = buildOption({ chartId: 'radar', rows });
    expect(((opt?.radar as Record<string, unknown>).indicator as unknown[])).toHaveLength(4);
  });

  it('gauge scales past the threshold', () => {
    const rows = [rev('Elm', 'Q1 2026', 4.2)];
    const opt = buildOption({
      chartId: 'gauge',
      rows,
      unit: 'x',
      layers: { markLines: [{ y: 5, label: 'max' }] },
    });
    const series = opt?.series as Array<Record<string, unknown>>;
    expect((series[0].max as number) >= 5).toBe(true);
    expect(series[0].data).toEqual([{ value: 4.2, name: '' }]);
  });
});

describe('unavailable charts refuse instead of degrading', () => {
  it('T3 and missing-data charts return explicit reasons', () => {
    const rows = [rev('Elm', 'Q1 2026', 1)];
    expect(buildRefusal({ chartId: 'map', rows })).toContain('GeoJSON');
    expect(buildRefusal({ chartId: 'lines-gl', rows })).toContain('GeoJSON');
    expect(buildRefusal({ chartId: 'bar3d', rows })).toContain('echarts-gl');
    expect(buildRefusal({ chartId: 'scatter3d', rows })).toContain('echarts-gl');
    expect(buildRefusal({ chartId: 'calendar', rows })).toContain('daily');
    expect(buildRefusal({ chartId: 'candlestick', rows })).toContain('OHLC');
    expect(buildRefusal({ chartId: 'gantt', rows })).toContain('start/end');
    for (const id of ['map', 'calendar', 'candlestick', 'gantt', 'bar3d']) {
      expect(buildOption({ chartId: id, rows })).toBeNull();
    }
  });

  it('unknown ids refuse too', () => {
    expect(buildRefusal({ chartId: 'nope', rows: [] })).toBe('unknown chart id: nope');
    expect(buildOption({ chartId: 'nope', rows: [] })).toBeNull();
  });

  it('timeline builds from dated events', () => {
    const rows: ChartRow[] = [
      { time: '2026-02-14', entityName: 'Revised', value: 1 },
      { time: '2026-05-01', entityName: 'Revised', value: 1 },
      { time: '2026-05-01', entityName: 'Flagged', value: 1 },
    ];
    const opt = buildOption({ chartId: 'timeline', rows });
    expect(((opt?.xAxis as Record<string, unknown>).data as string[]).sort()).toEqual(['2026-02-14', '2026-05-01']);
  });
});
