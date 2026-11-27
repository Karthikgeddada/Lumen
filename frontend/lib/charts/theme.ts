// Chart theme, read from CSS variables at init so a future dark mode only
// changes globals.css. Client-only (getComputedStyle) — callers run inside
// effects; SSR falls back to the static palette below.
import * as echarts from 'echarts/core';

export const LUMEN_TOOLTIP_CLASS = 'lumen-chart-tooltip';

export type LumenChartColors = {
  palette: string[];
  blue: string;
  success: string;
  warning: string;
  error: string;
  text: string;
  textMuted: string;
  hairline: string;
  surface: string;
};

// Static fallback matching globals.css — used on the server and before the
// stylesheet is readable; never a crash path.
const FALLBACK: LumenChartColors = {
  palette: ['#0071e3', '#1d9e44', '#b7791f', '#d93025', '#7c5cbf', '#0f8b8d'],
  blue: '#0071e3',
  success: '#1d9e44',
  warning: '#b7791f',
  error: '#d93025',
  text: '#1d1d1f',
  textMuted: '#6e6e73',
  hairline: '#e8e8ed',
  surface: '#ffffff',
};

function mix(hex: string, other: string, ratio: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(hex);
  const [r2, g2, b2] = p(other);
  const c = (a: number, b: number) => Math.round(a * ratio + b * (1 - ratio));
  const to = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to(c(r1, r2))}${to(c(g1, g2))}${to(c(b1, b2))}`;
}

export function gradientOf(color: string, surface = '#ffffff'): Record<string, unknown> {
  return {
    type: 'linear',
    x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [
      { offset: 0, color },
      { offset: 1, color: mix(color, surface, 0.25) },
    ],
  };
}

export function readChartColors(): LumenChartColors {
  if (typeof document === 'undefined') return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const blue = v('--blue', FALLBACK.blue);
  const success = v('--success', FALLBACK.success);
  const warning = v('--warning', FALLBACK.warning);
  const error = v('--error', FALLBACK.error);
  const surface = v('--surface', FALLBACK.surface);
  // Gradient-capable series palette anchored on the UI blues and greens.
  const palette = [
    blue,
    v('--success', success),
    mix(blue, surface, 0.5),
    warning,
    mix(success, surface, 0.5),
    v('--error', error),
    '#7c5cbf',
    '#0f8b8d',
  ];
  return {
    palette,
    blue,
    success,
    warning,
    error,
    text: v('--text-primary', FALLBACK.text),
    textMuted: v('--text-muted', FALLBACK.textMuted),
    hairline: v('--border', FALLBACK.hairline),
    surface,
  };
}

let themeRegistered = false;

/** Idempotent: registers the 'lumen' ECharts theme from CSS variables. */
export function ensureTheme(): string {
  if (typeof document === 'undefined') return '';
  if (!themeRegistered) {
    const c = readChartColors();
    echarts.registerTheme('lumen', {
      color: c.palette,
      backgroundColor: 'transparent',
      textStyle: { color: c.text, fontFamily: 'inherit' },
      title: { textStyle: { color: c.text }, subtextStyle: { color: c.textMuted } },
      legend: { textStyle: { color: c.textMuted } },
      tooltip: {
        className: LUMEN_TOOLTIP_CLASS,
        backgroundColor: c.surface,
        borderColor: c.hairline,
        textStyle: { color: c.text },
        // finance figures align in columns
        extraCssText: 'font-variant-numeric: tabular-nums;',
      },
    });
    themeRegistered = true;
  }
  return 'lumen';
}
