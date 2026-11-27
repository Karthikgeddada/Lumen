// Chart catalog — PURE, no I/O. The single source of truth for every chart
// family, its tier, the intents it serves, and its data requirements. The
// selector ranks from this table; the frontend builders are GENERATED from
// it via the catalog endpoint, so chart ids and rules are never hard-coded
// twice. "unavailable: needs <data>" entries register datasets Lumen's models
// cannot serve yet — they are listed, never faked.

export type ChartTier = 'T1' | 'T2' | 'T3';

export type IntentId =
  | 'trend'
  | 'compare'
  | 'composition'
  | 'change-bridge'
  | 'ranking'
  | 'distribution'
  | 'relationship'
  | 'hierarchy'
  | 'flow'
  | 'status-matrix'
  | 'progress'
  | 'lineage'
  | 'timeline';

export const INTENTS: Array<{ id: IntentId; label: string; description: string }> = [
  { id: 'trend', label: 'Trend', description: 'How a metric moves over time' },
  { id: 'compare', label: 'Compare', description: 'Entities or metrics side by side' },
  { id: 'composition', label: 'Composition', description: 'Parts of a whole' },
  { id: 'change-bridge', label: 'Change bridge', description: 'What drove a change from A to B' },
  { id: 'ranking', label: 'Ranking', description: 'Largest to smallest' },
  { id: 'distribution', label: 'Distribution', description: 'Spread and outliers of values' },
  { id: 'relationship', label: 'Relationship', description: 'Correlation between two measures' },
  { id: 'hierarchy', label: 'Hierarchy', description: 'Nested groupings' },
  { id: 'flow', label: 'Flow', description: 'Where values move between stages' },
  { id: 'status-matrix', label: 'Status matrix', description: 'Entities × covenants compliance grid' },
  { id: 'progress', label: 'Progress', description: 'Value against a threshold or target' },
  { id: 'lineage', label: 'Lineage', description: 'How a calculated figure derives from inputs' },
  { id: 'timeline', label: 'Timeline', description: 'Events over chronological time' },
];

export type CatalogEntry = {
  id: string;
  family: string; // ECharts family / renderer note
  tier: ChartTier;
  intents: IntentId[];
  requires: string; // one-line data requirement
  caution?: string; // T2 caution notes; T3 experimental notes
};

// T1 — auto-selectable.
// T2 — manual pick only, always shown with the caution note.
// T3 — behind CHARTS_EXPERIMENTAL (default off, lazy-loaded on the frontend).
export const CHART_CATALOG: CatalogEntry[] = [
  { id: 'line', family: 'line', tier: 'T1', intents: ['trend', 'compare', 'timeline'], requires: 'One temporal series with ≥2 periods' },
  { id: 'step-line', family: 'line (step)', tier: 'T1', intents: ['trend', 'progress'], requires: 'Temporal series whose thresholds/values hold until the next period' },
  { id: 'bar', family: 'bar', tier: 'T1', intents: ['compare', 'trend', 'progress'], requires: 'Categories with one value each (zero-based)' },
  { id: 'bar-stacked', family: 'bar (stacked)', tier: 'T1', intents: ['composition', 'compare'], requires: 'Additive components per category (sum to a meaningful whole)' },
  { id: 'bar-stacked-100', family: 'bar (normalized)', tier: 'T1', intents: ['composition'], requires: 'Additive components; emphasizes share, not magnitude' },
  { id: 'bar-horizontal', family: 'bar (horizontal)', tier: 'T1', intents: ['ranking', 'compare'], requires: 'Categories with one value each, long labels welcome' },
  { id: 'area', family: 'line (area)', tier: 'T1', intents: ['trend', 'composition'], requires: 'Temporal series; stacking additive components only' },
  { id: 'waterfall', family: 'bar (waterfall)', tier: 'T1', intents: ['change-bridge'], requires: 'Ordered additive components that bridge two totals' },
  { id: 'heatmap', family: 'heatmap', tier: 'T1', intents: ['status-matrix', 'trend'], requires: 'A matrix: two categorical axes with a value/status cell' },
  { id: 'scatter', family: 'scatter', tier: 'T1', intents: ['relationship', 'distribution'], requires: 'Two measures (x, y) with ≥3 points' },
  { id: 'bubble', family: 'scatter (bubble)', tier: 'T1', intents: ['relationship'], requires: 'Two measures plus a size measure' },
  { id: 'treemap', family: 'treemap', tier: 'T1', intents: ['hierarchy', 'composition'], requires: 'Hierarchical parts with values (sum to a whole)' },
  { id: 'sunburst', family: 'sunburst', tier: 'T1', intents: ['hierarchy', 'composition'], requires: 'Multi-level hierarchy with values' },
  { id: 'sankey', family: 'sankey', tier: 'T1', intents: ['flow', 'lineage'], requires: 'Source → target flows with amounts' },
  { id: 'tree', family: 'tree', tier: 'T1', intents: ['hierarchy', 'lineage'], requires: 'Parent-child nodes (no weights needed)' },
  { id: 'funnel', family: 'funnel', tier: 'T1', intents: ['flow'], requires: 'Ordered stages with decreasing counts' },
  { id: 'boxplot', family: 'boxplot', tier: 'T1', intents: ['distribution'], requires: '≥5 values per group to be honest about spread' },
  { id: 'parallel', family: 'parallel', tier: 'T1', intents: ['relationship', 'compare'], requires: '≥3 numeric dimensions to compare across rows' },
  { id: 'sparkline', family: 'line (inline)', tier: 'T1', intents: ['trend'], requires: 'A short temporal series shown inline' },

  { id: 'pie', family: 'pie', tier: 'T2', intents: ['composition'], requires: 'Parts summing to 100%, ≤6 slices', caution: 'Angles mislead for near-equal parts; never auto-selected' },
  { id: 'doughnut', family: 'pie (doughnut)', tier: 'T2', intents: ['composition'], requires: 'Parts summing to 100%, ≤6 slices', caution: 'Same risks as pie; center label does not fix perception' },
  { id: 'nightingale', family: 'pie (rose)', tier: 'T2', intents: ['composition', 'ranking'], requires: 'Categorical values (radius encodes value)', caution: 'Radius-area distortion exaggerates small differences' },
  { id: 'radar', family: 'radar', tier: 'T2', intents: ['compare'], requires: '3-8 dimensions on a common scale', caution: 'Area/shape perception is unreliable; use for quick scans only' },
  { id: 'gauge', family: 'gauge', tier: 'T2', intents: ['progress'], requires: 'One value against a threshold range', caution: 'Encourages reading precision the arc cannot carry' },
  { id: 'calendar', family: 'calendar', tier: 'T2', intents: ['timeline', 'trend'], requires: 'Many dates of daily data', caution: 'Needs daily granularity Lumen does not store' },
  { id: 'candlestick', family: 'candlestick', tier: 'T2', intents: ['trend'], requires: 'OHLC per period', caution: 'Lumen stores one value per period, not OHLC' },
  { id: 'theme-river', family: 'themeRiver', tier: 'T2', intents: ['trend', 'composition'], requires: 'Multiple temporal series on a shared axis', caution: 'Hard to read exact values; decorative' },
  { id: 'pictorial-bar', family: 'pictorialBar', tier: 'T2', intents: ['compare', 'ranking'], requires: 'Categories with one value each', caution: 'Pictorial distortion biases length perception' },
  { id: 'graph', family: 'graph', tier: 'T2', intents: ['lineage', 'relationship'], requires: 'Nodes and edges with a layout', caution: 'Hairball risk beyond ~30 nodes; prefer tree for lineage' },
  { id: 'chord', family: 'chord (custom)', tier: 'T2', intents: ['flow', 'relationship'], requires: 'Square flow matrix', caution: 'Chord diagrams rarely beat a sankey at this size' },
  { id: 'matrix', family: 'custom (status matrix)', tier: 'T2', intents: ['status-matrix'], requires: 'Entities × covenants with statuses', caution: 'Custom renderer; the heatmap carries the same information' },
  { id: 'timeline', family: 'custom (timeline/Gantt)', tier: 'T2', intents: ['timeline'], requires: 'Events with start/end over chronological time', caution: 'Custom renderer; a line over event dates is often clearer' },
  { id: 'gantt', family: 'custom (Gantt)', tier: 'T2', intents: ['timeline'], requires: 'Tasks with start/end dates', caution: 'Custom renderer; needs date ranges Lumen periods cannot express' },

  { id: 'map', family: 'geo/map', tier: 'T3', intents: ['compare'], requires: 'Region-coded values', caution: 'Experimental (CHARTS_EXPERIMENTAL); needs geo data Lumen lacks' },
  { id: 'bar3d', family: 'echarts-gl (3D bar)', tier: 'T3', intents: ['compare', 'relationship'], requires: 'Three categorical/numeric axes', caution: 'Experimental (CHARTS_EXPERIMENTAL); occlusion hides data' },
  { id: 'scatter3d', family: 'echarts-gl (3D scatter)', tier: 'T3', intents: ['relationship', 'distribution'], requires: 'Three numeric measures', caution: 'Experimental (CHARTS_EXPERIMENTAL); rotation hides points' },
  { id: 'lines-gl', family: 'echarts-gl (flow lines)', tier: 'T3', intents: ['flow'], requires: 'Geo-coordinated flows', caution: 'Experimental (CHARTS_EXPERIMENTAL); needs geo data Lumen lacks' },
];

export function chartEntry(id: string): CatalogEntry | null {
  return CHART_CATALOG.find((c) => c.id === id) ?? null;
}

export const CHART_IDS = CHART_CATALOG.map((c) => c.id);
export const T1_CHARTS = CHART_CATALOG.filter((c) => c.tier === 'T1');

// ── Datasets ───────────────────────────────────────────────────────
// Served from the real models only. Fields are whitelisted with roles:
// temporal (axis), attribute (filter/group), measure (numeric).

export type FieldRole = 'temporal' | 'attribute' | 'measure';

export type DatasetField = { id: string; role: FieldRole; label: string };

export type DatasetEntry = {
  id: string;
  label: string;
  description: string;
  fields: DatasetField[]; // whitelisted field ids/roles
  filters: string[]; // whitelisted filter ids for this dataset
};

export type UnavailableDataset = {
  id: string;
  label: string;
  available: false;
  needs: string; // "unavailable: needs <data>"
};

export const DATASETS: DatasetEntry[] = [
  {
    id: 'observations',
    label: 'Metric observations',
    description: 'Reported / calculated / AI-inferred figures per entity, metric, and period, with unit, derivation, confidence, lineage, and scale flags.',
    filters: ['entities', 'metrics', 'derivations', 'periodFrom', 'periodTo'],
    fields: [
      { id: 'entity', role: 'attribute', label: 'Entity' },
      { id: 'entityName', role: 'attribute', label: 'Entity name' },
      { id: 'metric', role: 'attribute', label: 'Metric key' },
      { id: 'metricLabel', role: 'attribute', label: 'Metric label' },
      { id: 'period', role: 'temporal', label: 'Period' },
      { id: 'value', role: 'measure', label: 'Value as stored' },
      { id: 'normalizedValue', role: 'measure', label: 'Value normalized to base units' },
      { id: 'unit', role: 'attribute', label: 'Unit (free text)' },
      { id: 'unitDimension', role: 'attribute', label: 'Parsed unit dimension' },
      { id: 'derivation', role: 'attribute', label: 'Derivation (REPORTED / CALCULATED / AI_INFERRED)' },
      { id: 'confidence', role: 'measure', label: 'Extraction confidence' },
      { id: 'sourceDocumentId', role: 'attribute', label: 'Source document (lineage)' },
      { id: 'sourcePage', role: 'attribute', label: 'Source page (lineage)' },
      { id: 'sourceExcerpt', role: 'attribute', label: 'Source excerpt (lineage)' },
      { id: 'extractionResultId', role: 'attribute', label: 'Extraction result (lineage)' },
      { id: 'inputs', role: 'attribute', label: 'CALCULATED input lineage' },
      { id: 'scaleFlags', role: 'attribute', label: 'Unresolved scale flags (TRUST RULE)' },
    ],
  },
  {
    id: 'covenant_results',
    label: 'Covenant results',
    description: 'Per covenant and period: value, threshold in force (including step-down schedules), headroom, status, near-breach band, previous status, and reason.',
    filters: ['entities', 'covenants', 'statuses', 'periodFrom', 'periodTo'],
    fields: [
      { id: 'entity', role: 'attribute', label: 'Entity' },
      { id: 'entityName', role: 'attribute', label: 'Entity name' },
      { id: 'covenant', role: 'attribute', label: 'Covenant key' },
      { id: 'covenantLabel', role: 'attribute', label: 'Covenant label' },
      { id: 'comparator', role: 'attribute', label: 'Comparator (LTE / GTE)' },
      { id: 'period', role: 'temporal', label: 'Period' },
      { id: 'value', role: 'measure', label: 'Observed value' },
      { id: 'thresholdInForce', role: 'measure', label: 'Threshold in force that period' },
      { id: 'headroom', role: 'measure', label: 'Signed headroom to threshold' },
      { id: 'status', role: 'attribute', label: 'PASS / FAIL / NOT_TESTED / WAIVED' },
      { id: 'nearBreach', role: 'attribute', label: 'Near-breach band (JSON)' },
      { id: 'previousStatus', role: 'attribute', label: 'Previous status' },
      { id: 'reason', role: 'attribute', label: 'Why NOT_TESTED' },
      { id: 'observationId', role: 'attribute', label: 'Backing observation (lineage)' },
    ],
  },
  {
    id: 'covenant_status_matrix',
    label: 'Covenant status matrix',
    description: 'Latest status per entity × covenant for the portfolio heatmap.',
    filters: ['entities', 'covenants', 'statuses'],
    fields: [
      { id: 'entity', role: 'attribute', label: 'Entity' },
      { id: 'entityName', role: 'attribute', label: 'Entity name' },
      { id: 'covenant', role: 'attribute', label: 'Covenant key' },
      { id: 'covenantLabel', role: 'attribute', label: 'Covenant label' },
      { id: 'status', role: 'attribute', label: 'Latest status' },
      { id: 'latestPeriod', role: 'temporal', label: 'Period of latest result' },
      { id: 'headroom', role: 'measure', label: 'Headroom at latest result' },
      { id: 'previousStatus', role: 'attribute', label: 'Previous status' },
    ],
  },
  {
    id: 'pipeline_funnel',
    label: 'Pipeline funnel',
    description: 'Documents → extracted → verified → ingested, as counts per stage.',
    filters: [],
    fields: [
      { id: 'stage', role: 'attribute', label: 'Funnel stage' },
      { id: 'count', role: 'measure', label: 'Documents at this stage' },
    ],
  },
  {
    id: 'extraction_quality',
    label: 'Extraction quality',
    description: 'Derivation mix of observations and verified-vs-review extraction results.',
    filters: [],
    fields: [
      { id: 'dimension', role: 'attribute', label: 'Quality dimension' },
      { id: 'category', role: 'attribute', label: 'Category' },
      { id: 'count', role: 'measure', label: 'Count' },
    ],
  },
  {
    id: 'revisions',
    label: 'Observation revisions',
    description: 'Append-only revision history per observation: previous value/unit/derivation/scale/source, who changed it, when, and why.',
    filters: ['entities', 'metrics'],
    fields: [
      { id: 'observationId', role: 'attribute', label: 'Observation' },
      { id: 'entityName', role: 'attribute', label: 'Entity name' },
      { id: 'metric', role: 'attribute', label: 'Metric key' },
      { id: 'period', role: 'temporal', label: 'Period' },
      { id: 'changedAt', role: 'temporal', label: 'Changed at' },
      { id: 'previousValue', role: 'measure', label: 'Previous value' },
      { id: 'previousUnit', role: 'attribute', label: 'Previous unit' },
      { id: 'previousDerivation', role: 'attribute', label: 'Previous derivation' },
      { id: 'changedById', role: 'attribute', label: 'Changed by (user id or null = system)' },
      { id: 'reason', role: 'attribute', label: 'Reason' },
    ],
  },
  {
    id: 'lineage',
    label: 'Lineage graph',
    description: 'CALCULATED observation inputs → the calculated metric → any covenant it feeds. Nodes carry value, unit, and observation id.',
    filters: ['entities', 'metrics'],
    fields: [
      { id: 'node', role: 'attribute', label: 'Node id (observation id)' },
      { id: 'parent', role: 'attribute', label: 'Parent node id (null = root input)' },
      { id: 'label', role: 'attribute', label: 'Node label (metric / covenant)' },
      { id: 'kind', role: 'attribute', label: 'input | metric | covenant' },
      { id: 'value', role: 'measure', label: 'Node value' },
      { id: 'unit', role: 'attribute', label: 'Node unit' },
      { id: 'derivation', role: 'attribute', label: 'Derivation' },
      { id: 'periods', role: 'attribute', label: 'Input periods' },
    ],
  },
];

// Datasets the current models cannot serve — listed with the honest reason,
// never faked, never silently omitted from the catalog.
export const UNAVAILABLE_DATASETS: UnavailableDataset[] = [
  { id: 'package_tracker', label: 'Package tracker', available: false, needs: 'expected vs received package dates per entity/quarter (package tracker model)' },
  { id: 'exposure_sector', label: 'Exposure by sector', available: false, needs: 'sector/industry attribute on entities or observations' },
  { id: 'maturity_dates', label: 'Debt maturity dates', available: false, needs: 'a debt maturity schedule model (instrument, amount, maturity date)' },
  { id: 'peer_sets', label: 'Peer sets', available: false, needs: 'peer grouping (explicit peer-set field or user-defined groups)' },
];

export const DATASET_IDS = DATASETS.map((d) => d.id);

export function datasetEntry(id: string): DatasetEntry | null {
  return DATASETS.find((d) => d.id === id) ?? null;
}
