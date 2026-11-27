'use client';

// Apache ECharts wrapper (https://echarts.apache.org — Apache-2.0).
// Lean canvas renderer: chart types are registered by the lazy family
// chunks (lib/charts/families/*), not here, so the main bundle stays
// small. Browser-only by design — the chart initializes in an effect
// (never during SSR), auto-resizes with its container, and is disposed on
// unmount so no canvas leaks between page navigations. The theme comes
// from CSS variables via lib/charts/theme (registered once, idempotent).
//
// LEGACY: the eager echarts.use block below keeps the pre-registry pages
// (analytics, dashboard) rendering until they move to components/Chart —
// remove that block in the page-wiring step and this file becomes
// renderer-only.

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { ensureTheme } from '../lib/charts/theme';

// LEGACY registrations (see header note).
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  TitleComponent,
  CanvasRenderer,
]);

// Colors from app/globals.css — keep in sync.
export const CHART = {
  blue: '#0071e3',
  blueDark: '#0062c4',
  blueLight: '#a9cffa',
  blueTint: '#eaf3ff',
  success: '#1d9e44',
  successBg: '#e7f5ec',
  warning: '#b7791f',
  warningBg: '#fff3dd',
  error: '#d93025',
  errorBg: '#fdebe9',
  textMuted: '#6e6e73',
  surface: '#ffffff',
  hairline: '#e8e8ed',
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
  onChartClick,
  ariaLabel,
}: {
  option: EChartOption;
  height?: number;
  /** raw echarts click params — consumers read params.data.row */
  onChartClick?: (params: Record<string, unknown>) => void;
  ariaLabel?: string;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onChartClick);
  clickRef.current = onChartClick;

  // Create exactly once per mount; tear down cleanly on unmount.
  useEffect(() => {
    if (!divRef.current) return;
    const chart = echarts.init(divRef.current, ensureTheme());
    chartRef.current = chart;
    // Every chart click flows through the shared evidence path (see
    // components/Chart); the callback is kept in a ref so it can change
    // without re-initializing the canvas.
    chart.on('click', (p) => clickRef.current?.(p as Record<string, unknown>));
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

  return (
    <div
      ref={divRef}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      style={{ width: '100%', height }}
    />
  );
}
