// Chart selector — PURE and DETERMINISTIC. A fixed rule table maps
// (dataset, intent, profile) → a ranked list of chart choices, each with a
// one-line reason for being ranked, blocked, or cautioned. The same input
// always yields the same output — no randomness, no clock, no model calls.
// T1 charts are auto-selectable; T2 appears with a caution; T3 requires the
// CHARTS_EXPERIMENTAL flag (the service filters them out when off). When
// nothing fits, the recommendation is a table with the reason.

import { CatalogEntry, CHART_CATALOG, IntentId, chartEntry } from './catalog';
import { DataProfile } from './profiler';
import { GuardrailNote, guardrailNotes } from './guardrails';

export type ChartChoice = {
  chartId: string;
  tier: CatalogEntry['tier'];
  compatible: boolean;
  reason: string; // why ranked or blocked — always present
  caution?: string; // T2 caution
  selected: boolean; // top choice
};

export type Selection = {
  dataset: string;
  intent: IntentId | 'auto';
  resolvedIntent: IntentId; // what 'auto' became for this dataset
  recommended: { chartId: string; tier: CatalogEntry['tier']; reason: string } | null;
  choices: ChartChoice[]; // ranked, compatible first, then blocked with reasons
  fallbackTable: { reason: string } | null; // set when recommended is null
  guardrails: GuardrailNote[];
};

// What 'auto' resolves to per dataset — fixed table, not inference.
const AUTO_INTENT: Record<string, IntentId> = {
  observations: 'trend',
  covenant_results: 'trend',
  covenant_status_matrix: 'status-matrix',
  pipeline_funnel: 'flow',
  extraction_quality: 'composition',
  revisions: 'timeline',
  lineage: 'lineage',
};

// Rule table per intent: ordered candidate ids with a reason template.
// Compatibility is checked against the profile below; the first compatible
// T1 candidate wins. T2 candidates only win if no T1 candidate is compatible
// (and they always carry their caution).
type Rule = { chartId: string; reason: string };
const RULES: Record<IntentId, Rule[]> = {
  trend: [
    { chartId: 'line', reason: 'Continuous time series of discrete periods — points marked, never smoothed.' },
    { chartId: 'step-line', reason: 'Threshold-like series where the value holds until the next period.' },
    { chartId: 'bar', reason: 'Few periods — bars read discrete quarters clearly.' },
    { chartId: 'sparkline', reason: 'Inline summary of a short trend.' },
  ],
  compare: [
    { chartId: 'bar', reason: 'Side-by-side categories with a zero-based value axis.' },
    { chartId: 'bar-horizontal', reason: 'Many entities or long labels — horizontal bars rank and read.' },
    { chartId: 'line', reason: 'Comparison across periods rather than at one point.' },
    { chartId: 'parallel', reason: 'Comparing ≥3 numeric dimensions per row.' },
  ],
  composition: [
    { chartId: 'bar-stacked', reason: 'Additive components per period, magnitudes visible.' },
    { chartId: 'bar-stacked-100', reason: 'Share-of-whole emphasis when magnitudes do not matter.' },
    { chartId: 'treemap', reason: 'Many parts — area encodes share without slice-angle bias.' },
    { chartId: 'sunburst', reason: 'Two-level hierarchy of parts.' },
    { chartId: 'pie', reason: '≤6 parts summing to 100% — manual pick only, never auto-selected.' },
  ],
  'change-bridge': [
    { chartId: 'waterfall', reason: 'Ordered additive components bridging two totals.' },
    { chartId: 'bar', reason: 'Components without a bridge total.' },
  ],
  ranking: [
    { chartId: 'bar-horizontal', reason: 'Sorted horizontal bars — the canonical ranking.' },
    { chartId: 'bar', reason: 'Few items to rank.' },
    { chartId: 'nightingale', reason: 'Radius ranking — decorative, distorts area.' },
  ],
  distribution: [
    { chartId: 'boxplot', reason: 'Spread and outliers per group — needs ≥5 values per group.' },
    { chartId: 'scatter', reason: 'Individual values plotted against a measure.' },
  ],
  relationship: [
    { chartId: 'scatter', reason: 'Two measures, one point per row.' },
    { chartId: 'bubble', reason: 'Two measures plus a size dimension.' },
    { chartId: 'parallel', reason: 'More than two measures to relate.' },
  ],
  hierarchy: [
    { chartId: 'tree', reason: 'Parent-child structure, readable at any depth.' },
    { chartId: 'treemap', reason: 'Hierarchy with values where area matters.' },
    { chartId: 'sunburst', reason: 'Ring-based hierarchy view.' },
  ],
  flow: [
    { chartId: 'sankey', reason: 'Source → target amounts between stages.' },
    { chartId: 'funnel', reason: 'Monotonic stage counts (documents → ingested).' },
  ],
  'status-matrix': [
    { chartId: 'heatmap', reason: 'Entities × covenants grid with a status color per cell.' },
    { chartId: 'matrix', reason: 'Custom status matrix — same information, custom renderer.' },
  ],
  progress: [
    { chartId: 'bar', reason: 'Value against a target line on a zero-based axis.' },
    { chartId: 'step-line', reason: 'Threshold-in-force over time (step-down schedules).' },
    { chartId: 'gauge', reason: 'Single value in a threshold range — manual pick, precision illusion.' },
  ],
  lineage: [
    { chartId: 'tree', reason: 'Inputs → metric → covenant, left-to-right.' },
    { chartId: 'sankey', reason: 'Lineage as flows when input amounts matter.' },
    { chartId: 'graph', reason: 'Free-form graph — hairball risk beyond ~30 nodes.' },
  ],
  timeline: [
    { chartId: 'timeline', reason: 'Events over chronological time (revisions) — custom renderer.' },
    { chartId: 'line', reason: 'Change events plotted on a time axis.' },
  ],
};

// Compatibility checks per chart id — the data requirements from the
// catalog, evaluated against the profile. Returns null when compatible,
// otherwise the one-line block reason.
function blockReason(chartId: string, profile: DataProfile, dataset: string): string | null {
  const entry = chartEntry(chartId)!;
  switch (chartId) {
    case 'line':
    case 'step-line':
    case 'area':
    case 'sparkline':
    case 'theme-river':
      if (!profile.temporal) return 'needs ≥2 periods on a time axis';
      if (dataset === 'pipeline_funnel' || dataset === 'extraction_quality') return 'no time axis in this dataset';
      return null;
    case 'bar':
    case 'bar-horizontal':
    case 'pictorial-bar':
    case 'bar-stacked':
    case 'bar-stacked-100':
      if (profile.rowCount === 0) return 'no data';
      if (profile.rowCount < 2) return 'needs ≥2 categories';
      return null;
    case 'waterfall':
      if (dataset !== 'observations') return 'needs ordered additive components (observations with a bridge set)';
      return null;
    case 'heatmap':
      if (dataset === 'covenant_status_matrix' || dataset === 'covenant_results' || dataset === 'observations') return null;
      return 'needs a two-axis category grid this dataset does not provide';
    case 'scatter':
    case 'bubble':
      if (profile.rowCount < 3) return 'needs ≥3 points to show a relationship';
      if (dataset === 'pipeline_funnel' || dataset === 'extraction_quality') return 'needs two numeric measures';
      return null;
    case 'treemap':
    case 'sunburst':
      if (profile.rowCount === 0) return 'no data';
      if (dataset === 'pipeline_funnel' || dataset === 'extraction_quality') return 'needs hierarchical part values';
      return null;
    case 'sankey':
      if (dataset !== 'lineage') return 'needs source → target flows';
      return null;
    case 'tree':
      if (dataset !== 'lineage') return 'needs parent-child nodes';
      return null;
    case 'funnel':
      if (dataset !== 'pipeline_funnel') return 'needs ordered stage counts';
      return null;
    case 'boxplot':
      if (profile.rowCount < 5) return 'needs ≥5 values to show honest spread';
      return null;
    case 'parallel':
      if (profile.metricCount < 3) return 'needs ≥3 numeric dimensions';
      return null;
    case 'pie':
    case 'doughnut':
      if (dataset === 'extraction_quality') return null; // derivation mix can be a 100% whole
      if (dataset !== 'observations') return 'needs parts summing to a whole';
      return 'composition of segments must sum to 100% — verify before use';
    case 'nightingale':
    case 'radar':
    case 'gauge':
    case 'calendar':
    case 'candlestick':
      if (chartId === 'calendar') return 'needs daily dates Lumen does not store';
      if (chartId === 'candlestick') return 'needs OHLC values Lumen does not store';
      return null;
    case 'graph':
      if (dataset !== 'lineage') return 'needs nodes and edges';
      return null;
    case 'chord':
      return 'needs a square flow matrix';
    case 'matrix':
      if (dataset === 'covenant_status_matrix') return null;
      return 'needs the status matrix dataset';
    case 'timeline':
      if (dataset !== 'revisions') return 'needs events over chronological time';
      return null;
    case 'gantt':
      return 'needs task start/end dates Lumen periods cannot express';
    case 'map':
    case 'bar3d':
    case 'scatter3d':
    case 'lines-gl':
      return 'experimental — CHARTS_EXPERIMENTAL flag required';
    default:
      return 'unknown chart';
  }
}

export function selectChart(
  dataset: string,
  intent: IntentId | 'auto',
  profile: DataProfile,
  options: { chartsExperimental?: boolean; requestedChart?: string } = {},
): Selection {
  const resolvedIntent: IntentId = intent === 'auto' ? (AUTO_INTENT[dataset] ?? 'trend') : intent;
  const rules = RULES[resolvedIntent];

  // Empty data: nothing to recommend but a table with the reason.
  if (profile.rowCount === 0) {
    return {
      dataset,
      intent,
      resolvedIntent,
      recommended: null,
      choices: [],
      fallbackTable: { reason: 'No rows match the filters — show an empty state, not an empty chart.' },
      guardrails: [],
    };
  }

  const choices: ChartChoice[] = [];
  for (const rule of rules) {
    const entry = chartEntry(rule.chartId);
    if (!entry) continue;
    if (entry.tier === 'T3' && !options.chartsExperimental) continue; // hidden unless flagged
    const blocked = blockReason(rule.chartId, profile, dataset);
    choices.push({
      chartId: rule.chartId,
      tier: entry.tier,
      compatible: blocked === null,
      reason: blocked ?? rule.reason,
      caution: entry.caution,
      selected: false,
    });
  }

  // The recommendation: explicit request wins (already validated T1/T2);
  // otherwise the first compatible T1; otherwise the first compatible T2
  // (with caution); otherwise a table with the reason.
  let recommendedId: string | null = null;
  let reason = '';
  if (options.requestedChart && options.requestedChart !== 'table') {
    recommendedId = options.requestedChart;
    const choice = choices.find((c) => c.chartId === recommendedId);
    reason = choice ? (choice.compatible ? choice.reason : `Requested chart is not compatible: ${choice.reason}`) : 'Requested chart serves this data per the catalog.';
  } else {
    const firstT1 = choices.find((c) => c.compatible && c.tier === 'T1');
    if (firstT1) {
      recommendedId = firstT1.chartId;
      reason = firstT1.reason;
    } else {
      const firstT2 = choices.find((c) => c.compatible && c.tier === 'T2');
      if (firstT2) {
        recommendedId = firstT2.chartId;
        reason = `${firstT2.reason} (No tier-1 fit — manual tier-2 pick, see caution.)`;
      }
    }
  }

  // >12 series on one axis is never the recommendation — small multiples or
  // heatmap instead, and the reason says so.
  if (recommendedId && profile.seriesCount > 12 && ['line', 'step-line', 'area', 'theme-river'].includes(recommendedId)) {
    recommendedId = 'heatmap';
    reason = `>12 series (${profile.seriesCount}) — a heatmap or small multiples carries the comparison; one axis would tangle.`;
  }

  for (const c of choices) if (c.chartId === recommendedId) c.selected = true;

  const fallbackTable = recommendedId ? null : { reason: 'No compatible chart for this data — a table shows every value honestly.' };
  const guardrails = recommendedId ? guardrailNotes(profile, recommendedId) : [];

  return {
    dataset,
    intent,
    resolvedIntent,
    recommended: recommendedId ? { chartId: recommendedId, tier: chartEntry(recommendedId)!.tier, reason } : null,
    choices,
    fallbackTable,
    guardrails,
  };
}
