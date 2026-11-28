'use client';

// Apache ECharts wrapper (https://echarts.apache.org — Apache-2.0).
// Tree-shaken: only the chart types + components we actually use are
// registered, so the bundle stays small. Browser-only by design — the
// chart initializes in an effect (never during SSR), auto-resizes with its
// container, and is disposed on unmount so no canvas leaks between page
// navigations. The palette mirrors globals.css so charts sit natively in
// the UI.

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

// Colors from app/globals.css — keep in sync.
export const CHART = {
  blue: '#1c4fd8',
  blueDark: '#1740b5',
  blueLight: '#b9caed',
  blueTint: '#e9f0fc',
  success: '#0a7d4d',
  successBg: '#e2f4e9',
  warning: '#a15c07',
  warningBg: '#fbf1de',
  error: '#bb2d23',
  errorBg: '#fbeae8',
  textMuted: '#70809a',
  surface: '#ffffff',
  hairline: '#dde3ec',
};

// A small shared base so every chart on the site feels the same: modest
// grid, quiet axis lines, muted labels, cross-hair tooltip.
export function baseAxis() {
  return {
    axisLine: { lineStyle: { color: CHART.hairline } },
    axisTick: { show: false },
    axisLabel: { color: CHART.textMuted, fontSize: 11 },
    splitLine: { lineStyle: { color: CHART.hairline, type: 'solid' as const } },
  };
}

export type EChartOption = echarts.EChartsCoreOption;

export default function EChart({
  option,
  height = 240,
}: {
  option: EChartOption;
  height?: number;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // Create exactly once per mount; tear down cleanly on unmount.
  useEffect(() => {
    if (!divRef.current) return;
    const chart = echarts.init(divRef.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(divRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // notMerge: a changed option fully replaces the previous one — pages pass
  // options built from fresh data, and we never want stale series lingering.
  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={divRef} style={{ width: '100%', height }} />;
}
