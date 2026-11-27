// In-memory chart fixtures — PURE (zero imports, no Prisma/Express/env).
// They mirror the shapes produced by prisma/seed-charts-demo.ts (same
// entities, metrics, quarters, statuses and edge cases) so tests for the
// chart brain, option builders and presets run against realistic data
// without touching a database. Field ids match the dataset whitelists in
// analytics/core/charts/catalog.ts exactly.

export type FixtureRow = Record<string, unknown>;

export const FIXTURE_ENTITIES = [
  'Northwind Holdings',
  'Aurora Manufacturing',
  'Bristol Logistics',
  'Cedar Retail Group',
  'Delta Energy Partners',
  'Elm Street Media',
  'Fjord Shipping',
] as const;

// ── observations ─────────────────────────────────────────────────────
// 7 entities × core metrics over 8 quarters (Q1 2025…Q4 2026), with:
// mixed units (Aurora in USD thousands), one AI_INFERRED point, one
// CALCULATED point with input lineage, one unresolved-scale row (Elm Q3
// 2026 ebitda), Bristol revenue missing Q3 2026 (a real gap), one annual
// period (Fjord 2025), and additive segments summing to revenue.
export const fixtureObservations: FixtureRow[] = [
  // Northwind revenue — full 8 quarters, one AI_INFERRED point (Q2 2026).
  ...[
    ['Q1 2025', 400, 'REPORTED'], ['Q2 2025', 408, 'REPORTED'], ['Q3 2025', 416, 'REPORTED'], ['Q4 2025', 424, 'REPORTED'],
    ['Q1 2026', 432, 'REPORTED'], ['Q2 2026', 440, 'AI_INFERRED'], ['Q3 2026', 448, 'REPORTED'], ['Q4 2026', 456, 'REPORTED'],
  ].map(([period, value, derivation]) => ({
    entity: 'ent_northwind', entityName: 'Northwind Holdings', metric: 'revenue', metricLabel: 'Revenue',
    period, value, normalizedValue: (value as number) * 1e6, unit: 'USD millions', unitDimension: 'currency',
    unitUnresolved: false, derivation, confidence: derivation === 'AI_INFERRED' ? 0.72 : 0.95,
    sourceDocumentId: 'doc_demo_1', sourcePage: 3, sourceExcerpt: '[demo seed] Revenue, ' + period,
    extractionResultId: 'ex_demo_1', inputs: null, scaleFlags: [],
  })),
  // Aurora ebitda — USD thousands (unit normalization must line up).
  ...[
    ['Q1 2025', 87400], ['Q2 2025', 88400], ['Q3 2025', 89400], ['Q4 2025', 90400],
    ['Q1 2026', 91400], ['Q2 2026', 92400], ['Q3 2026', 93400], ['Q4 2026', 94400],
  ].map(([period, value]) => ({
    entity: 'ent_aurora', entityName: 'Aurora Manufacturing', metric: 'ebitda', metricLabel: 'EBITDA',
    period, value, normalizedValue: (value as number) * 1e3, unit: 'USD thousands', unitDimension: 'currency',
    unitUnresolved: false, derivation: 'REPORTED', confidence: 0.95,
    sourceDocumentId: 'doc_demo_2', sourcePage: 5, sourceExcerpt: '[demo seed] EBITDA, ' + period,
    extractionResultId: 'ex_demo_2', inputs: null, scaleFlags: [],
  })),
  // Bristol revenue — Q3 2026 MISSING (the gap stays a gap in every chart).
  ...[
    ['Q1 2026', 496], ['Q2 2026', 504], ['Q4 2026', 520],
  ].map(([period, value]) => ({
    entity: 'ent_bristol', entityName: 'Bristol Logistics', metric: 'revenue', metricLabel: 'Revenue',
    period, value, normalizedValue: (value as number) * 1e6, unit: 'USD millions', unitDimension: 'currency',
    unitUnresolved: false, derivation: 'REPORTED', confidence: 0.95,
    sourceDocumentId: 'doc_demo_3', sourcePage: 2, sourceExcerpt: '[demo seed] Revenue, ' + period,
    extractionResultId: 'ex_demo_3', inputs: null, scaleFlags: [],
  })),
  // Cedar liquidity — inside the near-breach band (headroom ≤ 20%).
  ...[
    ['Q3 2026', 102], ['Q4 2026', 103],
  ].map(([period, value]) => ({
    entity: 'ent_cedar', entityName: 'Cedar Retail Group', metric: 'liquidity', metricLabel: 'Liquidity',
    period, value, normalizedValue: (value as number) * 1e6, unit: 'USD millions', unitDimension: 'currency',
    unitUnresolved: false, derivation: 'REPORTED', confidence: 0.95,
    sourceDocumentId: 'doc_demo_4', sourcePage: 7, sourceExcerpt: '[demo seed] Liquidity, ' + period,
    extractionResultId: 'ex_demo_4', inputs: null, scaleFlags: [],
  })),
  // Delta net_debt — quarterly series ending in the corrected 1750 (FAIL case).
  ...[
    ['Q1 2026', 1280], ['Q2 2026', 1300], ['Q3 2026', 1320], ['Q4 2026', 1750],
  ].map(([period, value]) => ({
    entity: 'ent_delta', entityName: 'Delta Energy Partners', metric: 'net_debt', metricLabel: 'Net debt',
    period, value, normalizedValue: (value as number) * 1e6, unit: 'USD millions', unitDimension: 'currency',
    unitUnresolved: false, derivation: 'REPORTED', confidence: 0.95,
    sourceDocumentId: 'doc_demo_5', sourcePage: 4, sourceExcerpt: '[demo seed] Net debt, ' + period,
    extractionResultId: 'ex_demo_5', inputs: null, scaleFlags: [],
  })),
  // Elm ebitda — ONE unresolved-scale observation (TRUST RULE flag).
  {
    entity: 'ent_elm', entityName: 'Elm Street Media', metric: 'ebitda', metricLabel: 'EBITDA',
    period: 'Q3 2026', value: 121, normalizedValue: 121e6, unit: 'USD millions', unitDimension: 'currency',
    unitUnresolved: false, derivation: 'REPORTED', confidence: 0.95,
    sourceDocumentId: 'doc_demo_6', sourcePage: 6, sourceExcerpt: '[demo seed] EBITDA, Q3 2026',
    extractionResultId: 'ex_demo_6', inputs: null,
    scaleFlags: ['ebitda: unit scale unresolved in source (Q3 2026)'],
  },
  // Fjord — ONE ANNUAL period (never shares an axis with quarters).
  {
    entity: 'ent_fjord', entityName: 'Fjord Shipping', metric: 'revenue', metricLabel: 'Revenue',
    period: '2025', value: 520, normalizedValue: 520e6, unit: 'USD millions', unitDimension: 'currency',
    unitUnresolved: false, derivation: 'REPORTED', confidence: 0.95,
    sourceDocumentId: 'doc_demo_7', sourcePage: 1, sourceExcerpt: '[demo seed] Revenue, 2025 (annual)',
    extractionResultId: 'ex_demo_7', inputs: null, scaleFlags: [],
  },
  // Northwind segments — additive, sum exactly to Q4 2026 revenue (456).
  ...[
    ['seg:core', 'Segment: Core', 250.8], ['seg:industrial', 'Segment: Industrial', 123.1], ['seg:services', 'Segment: Services', 82.1],
  ].map(([metric, metricLabel, value]) => ({
    entity: 'ent_northwind', entityName: 'Northwind Holdings', metric, metricLabel,
    period: 'Q4 2026', value, normalizedValue: (value as number) * 1e6, unit: 'USD millions',
    unitDimension: 'currency', unitUnresolved: false, derivation: 'REPORTED', confidence: 0.9,
    sourceDocumentId: 'doc_demo_1', sourcePage: 3, sourceExcerpt: '[demo seed] ' + metricLabel + ', Q4 2026',
    extractionResultId: 'ex_demo_1', inputs: null, scaleFlags: [],
  })),
  // Northwind CALCULATED net_leverage — full input lineage (feeds lineage graph).
  {
    entity: 'ent_northwind', entityName: 'Northwind Holdings', metric: 'net_leverage', metricLabel: 'Net leverage (TTM)',
    period: 'Q4 2026', value: 0.7, normalizedValue: 0.7, unit: 'x', unitDimension: 'multiple',
    unitUnresolved: false, derivation: 'CALCULATED', confidence: null,
    sourceDocumentId: null, sourcePage: null, sourceExcerpt: null, extractionResultId: null,
    inputs: {
      inputs: [
        { key: 'net_debt', metricKey: 'net_debt', kind: 'stock', periods: ['Q4 2026'], observationIds: ['obs_nw_nd_q4'], value: 279 },
        { key: 'ebitda', metricKey: 'ebitda', kind: 'flow', periods: ['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'], observationIds: ['obs_nw_eb_q1', 'obs_nw_eb_q2', 'obs_nw_eb_q3', 'obs_nw_eb_q4'], value: 390.7 },
      ],
    },
    scaleFlags: [],
  },
];

// ── covenant_results ──────────────────────────────────────────────────
// Step-down schedule: threshold 4.0 through Q2 2026, 3.5 from Q3 2026.
// Every status present: PASS, near-breach PASS, FAIL, NOT_TESTED, WAIVED,
// plus a previousStatus transition (Delta Q4 2026 PASS→FAIL).
export const fixtureCovenantResults: FixtureRow[] = [
  ...[
    ['Q1 2026', 0.68, 4.0, 'PASS'], ['Q2 2026', 0.69, 4.0, 'PASS'], ['Q3 2026', 0.7, 3.5, 'PASS'], ['Q4 2026', 0.71, 3.5, 'PASS'],
  ].map(([period, value, thresholdInForce, status]) => ({
    entity: 'ent_northwind', entityName: 'Northwind Holdings', covenant: 'max_net_leverage',
    covenantLabel: 'Max net leverage (TTM)', comparator: 'LTE', period, value, thresholdInForce,
    headroom: (thresholdInForce as number) - (value as number), status, nearBreach: null,
    previousStatus: null, reason: null, observationId: 'obs_nw_lev_' + period,
  })),
  // Delta: the step-down bites — Q3 2026 PASS at 2.8x, then the corrected
  // net_debt pushes Q4 2026 to 3.6x > 3.5 → FAIL with previousStatus PASS.
  {
    entity: 'ent_delta', entityName: 'Delta Energy Partners', covenant: 'max_net_leverage',
    covenantLabel: 'Max net leverage (TTM)', comparator: 'LTE', period: 'Q3 2026', value: 2.8,
    thresholdInForce: 3.5, headroom: 0.7, status: 'PASS', nearBreach: null,
    previousStatus: null, reason: null, observationId: 'obs_dl_lev_q3',
  },
  {
    entity: 'ent_delta', entityName: 'Delta Energy Partners', covenant: 'max_net_leverage',
    covenantLabel: 'Max net leverage (TTM)', comparator: 'LTE', period: 'Q4 2026', value: 3.6,
    thresholdInForce: 3.5, headroom: -0.1, status: 'FAIL', nearBreach: null,
    previousStatus: 'PASS', reason: null, observationId: 'obs_dl_lev_q4',
  },
  // Cedar: PASS inside the near-breach band (headroom 3% ≤ 20%).
  {
    entity: 'ent_cedar', entityName: 'Cedar Retail Group', covenant: 'min_liquidity',
    covenantLabel: 'Minimum liquidity', comparator: 'GTE', period: 'Q4 2026', value: 103,
    thresholdInForce: 100, headroom: 3, status: 'PASS',
    nearBreach: { withinPct: true, headroomPct: 3, nearBreachPct: 20 },
    previousStatus: 'PASS', reason: null, observationId: 'obs_cd_liq_q4',
  },
  // Elm: NOT_TESTED — unresolved scale flag inside the TTM window (TRUST RULE).
  {
    entity: 'ent_elm', entityName: 'Elm Street Media', covenant: 'max_net_leverage',
    covenantLabel: 'Max net leverage (TTM)', comparator: 'LTE', period: 'Q4 2026', value: null,
    thresholdInForce: 3.5, headroom: null, status: 'NOT_TESTED', nearBreach: null,
    previousStatus: null, reason: 'ebitda Q3 2026: unit scale unresolved in source (Q3 2026)', observationId: null,
  },
  // Fjord: WAIVED — human decision, cure context recorded, never auto-applied.
  {
    entity: 'ent_fjord', entityName: 'Fjord Shipping', covenant: 'min_liquidity',
    covenantLabel: 'Minimum liquidity', comparator: 'GTE', period: 'Q4 2026', value: 150,
    thresholdInForce: 100, headroom: 50, status: 'WAIVED', nearBreach: null,
    previousStatus: 'PASS', reason: 'Waiver letter dated 2026-11-01 accepted by agent', observationId: 'obs_fj_liq_q4',
  },
];

// ── covenant_status_matrix ───────────────────────────────────────────
export const fixtureStatusMatrix: FixtureRow[] = [
  { entity: 'ent_northwind', entityName: 'Northwind Holdings', covenant: 'max_net_leverage', covenantLabel: 'Max net leverage (TTM)', status: 'PASS', latestPeriod: 'Q4 2026', headroom: 2.79, previousStatus: 'PASS' },
  { entity: 'ent_northwind', entityName: 'Northwind Holdings', covenant: 'min_interest_coverage', covenantLabel: 'Min interest coverage (TTM)', status: 'PASS', latestPeriod: 'Q4 2026', headroom: 1.44, previousStatus: 'PASS' },
  { entity: 'ent_aurora', entityName: 'Aurora Manufacturing', covenant: 'max_net_leverage', covenantLabel: 'Max net leverage (TTM)', status: 'PASS', latestPeriod: 'Q4 2026', headroom: 3.3, previousStatus: 'PASS' },
  { entity: 'ent_bristol', entityName: 'Bristol Logistics', covenant: 'max_net_leverage', covenantLabel: 'Max net leverage (TTM)', status: 'PASS', latestPeriod: 'Q4 2026', headroom: 2.7, previousStatus: 'PASS' },
  { entity: 'ent_cedar', entityName: 'Cedar Retail Group', covenant: 'min_liquidity', covenantLabel: 'Minimum liquidity', status: 'PASS', latestPeriod: 'Q4 2026', headroom: 3, previousStatus: 'PASS' },
  { entity: 'ent_delta', entityName: 'Delta Energy Partners', covenant: 'max_net_leverage', covenantLabel: 'Max net leverage (TTM)', status: 'FAIL', latestPeriod: 'Q4 2026', headroom: -0.1, previousStatus: 'PASS' },
  { entity: 'ent_elm', entityName: 'Elm Street Media', covenant: 'max_net_leverage', covenantLabel: 'Max net leverage (TTM)', status: 'NOT_TESTED', latestPeriod: 'Q4 2026', headroom: null, previousStatus: null },
  { entity: 'ent_fjord', entityName: 'Fjord Shipping', covenant: 'min_liquidity', covenantLabel: 'Minimum liquidity', status: 'WAIVED', latestPeriod: 'Q4 2026', headroom: 50, previousStatus: 'PASS' },
];

// ── pipeline_funnel ──────────────────────────────────────────────────
// Honest counts — 'ingested' counts figures, so it can exceed 'verified'.
export const fixturePipelineFunnel: FixtureRow[] = [
  { stage: 'documents', count: 9 },
  { stage: 'extracted', count: 8 },
  { stage: 'verified', count: 6 },
  { stage: 'ingested', count: 24 },
];

// ── extraction_quality ────────────────────────────────────────────────
export const fixtureExtractionQuality: FixtureRow[] = [
  { dimension: 'derivation', category: 'REPORTED', count: 18 },
  { dimension: 'derivation', category: 'CALCULATED', count: 2 },
  { dimension: 'derivation', category: 'AI_INFERRED', count: 1 },
  { dimension: 'extraction', category: 'VERIFIED', count: 6 },
  { dimension: 'extraction', category: 'NEEDS_REVIEW', count: 2 },
];

// ── revisions ────────────────────────────────────────────────────────
export const fixtureRevisions: FixtureRow[] = [
  {
    observationId: 'obs_dl_nd_q4', entityName: 'Delta Energy Partners', metric: 'net_debt',
    period: 'Q4 2026', changedAt: '2026-11-20T10:15:00.000Z', previousValue: 1340,
    previousUnit: 'USD millions', previousDerivation: 'REPORTED', changedById: 'user_demo',
    reason: 'corrected per Q4 lender statement',
  },
  {
    observationId: 'obs_nw_liq_q2', entityName: 'Northwind Holdings', metric: 'liquidity',
    period: 'Q2 2025', changedAt: '2026-11-18T09:00:00.000Z', previousValue: 105,
    previousUnit: 'USD millions', previousDerivation: 'REPORTED', changedById: 'user_demo',
    reason: 'restated — restricted cash excluded',
  },
];

// ── lineage ──────────────────────────────────────────────────────────
// Inputs → CALCULATED net_leverage → the covenant it backs (left-to-right).
export const fixtureLineage: FixtureRow[] = [
  ...['obs_nw_nd_q4'].map((node) => ({
    node, parent: 'obs_nw_lev_q4', label: 'net_debt', kind: 'input', value: 279,
    unit: 'USD millions', derivation: 'REPORTED', periods: ['Q4 2026'],
  })),
  ...['obs_nw_eb_q1', 'obs_nw_eb_q2', 'obs_nw_eb_q3', 'obs_nw_eb_q4'].map((node) => ({
    node, parent: 'obs_nw_lev_q4', label: 'ebitda', kind: 'input', value: null,
    unit: null, derivation: 'REPORTED', periods: ['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'],
  })),
  {
    node: 'obs_nw_lev_q4', parent: null, label: 'net_leverage (Northwind Holdings)',
    kind: 'metric', value: 0.7, unit: 'x', derivation: 'CALCULATED', periods: ['Q4 2026'],
  },
  {
    node: 'obs_nw_lev_q4:cov', parent: 'obs_nw_lev_q4', label: 'Max net leverage (TTM)',
    kind: 'covenant', value: null, unit: null, derivation: null, periods: [],
  },
];
