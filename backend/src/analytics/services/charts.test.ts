// Service-level chart tests with a mocked Prisma: threshold-in-force with
// step-down schedules, cap enforcement, tenancy on every query, spec
// rejection (400), and TRUST RULE flags on rows.

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../prisma', () => ({
  prisma: {
    metricObservation: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    covenantDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    covenantResult: { findMany: vi.fn().mockResolvedValue([]) },
    document: { findMany: vi.fn().mockResolvedValue([]) },
    extractionResult: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    observationRevision: { findMany: vi.fn().mockResolvedValue([]) },
    savedChartView: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from '../../prisma';
import { buildChartData } from './charts';

const m = (f: unknown) => f as ReturnType<typeof vi.fn>;
const WS = 'ws-chart-tests';

beforeEach(() => {
  vi.clearAllMocks();
});

// Any-shaped observation row (tenancy/units/period/scale variants by arg).
  const obs = (id: string, entityId: string, period: string, unit: string, scale: unknown = null) => ({
    id,
    entityId,
    metricKey: 'revenue',
    label: 'Revenue',
    period,
    value: 4,
    unit,
    derivation: 'REPORTED',
    confidence: 0.9,
    sourceDocumentId: 'doc1',
    sourcePage: 3,
    sourceExcerpt: 'Revenue was $4bn',
    extractionResultId: 'ex1',
    inputs: null,
    scale,
    entity: { name: 'Halden' },
  });

describe('buildChartData — spec validation', () => {
  it('rejects an unknown dataset with a 400-carrying error', async () => {
    await expect(buildChartData(WS, { dataset: 'secret_table' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/dataset/i),
    });
  });

  it('rejects a filter the dataset does not whitelist', async () => {
    await expect(
      buildChartData(WS, { dataset: 'pipeline_funnel', filters: { metrics: ['revenue'] } }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('covenant_results — threshold in force (step-down schedules)', () => {
  it('rows carry the threshold in force per period, incl. step-downs', async () => {
    m(prisma.covenantDefinition.findMany).mockResolvedValue([
      {
        id: 'def1',
        workspaceId: WS,
        entityId: 'ent1',
        key: 'max_net_leverage',
        label: 'Max net leverage',
        comparator: 'LTE',
        threshold: 4.0,
        schedule: [{ effectiveFrom: 'Q1 2026', threshold: 3.5 }],
        entity: { name: 'Halden' },
      },
    ]);
    m(prisma.covenantResult.findMany).mockResolvedValue([
      { definitionId: 'def1', period: 'Q4 2025', value: 3.8, headroom: 0.2, status: 'PASS', nearBreach: null, previousStatus: null, reason: null, observationId: 'obs1' },
      { definitionId: 'def1', period: 'Q1 2026', value: 3.6, headroom: -0.1, status: 'FAIL', nearBreach: null, previousStatus: 'PASS', reason: null, observationId: 'obs2' },
      { definitionId: 'def1', period: 'Q2 2026', value: 3.4, headroom: 0.1, status: 'PASS', nearBreach: null, previousStatus: 'FAIL', reason: null, observationId: 'obs3' },
    ]);

    const r = await buildChartData(WS, { dataset: 'covenant_results' });
    expect(r.rows).toHaveLength(3);
    const byPeriod = new Map(r.rows.map((row) => [row.period as string, row.thresholdInForce as number]));
    expect(byPeriod.get('Q4 2025')).toBe(4.0); // before the step-down → base
    expect(byPeriod.get('Q1 2026')).toBe(3.5); // step-down takes force
    expect(byPeriod.get('Q2 2026')).toBe(3.5);
    // previousStatus travels through (fresh-event analytics depend on it)
    expect(r.rows.find((row) => row.period === 'Q1 2026')).toMatchObject({ previousStatus: 'PASS' });
  });

  it('tenancy: covenant queries are workspace-scoped', async () => {
    m(prisma.covenantDefinition.findMany).mockResolvedValue([]);
    await buildChartData(WS, { dataset: 'covenant_results' });
    expect(m(prisma.covenantDefinition.findMany).mock.calls[0][0].where).toMatchObject({
      workspaceId: WS,
      deletedAt: null,
    });
  });
});

describe('observations — caps, tenancy, TRUST RULE flags', () => {


  it('tenancy + unit normalization + unresolved flags on rows', async () => {
    m(prisma.metricObservation.findMany).mockResolvedValue([
      obs('o1', 'ent1', 'Q1 2026', 'USD billions'),
      obs('o2', 'ent1', 'Q2 2026', '???'), // unparseable unit → unresolved
      { ...obs('o3', 'ent1', 'Q3 2026', 'USD millions'), scale: { unresolved: true } }, // unresolved scale flag
    ]);

    const r = await buildChartData(WS, { dataset: 'observations' });

    // every query scoped by workspace tenancy
    expect(m(prisma.metricObservation.findMany).mock.calls[0][0].where).toMatchObject({
      entity: { workspaceId: WS },
    });

    const byUnit = new Map(r.rows.map((row) => [row.unit as string, row]));
    expect(byUnit.get('USD billions')).toMatchObject({ normalizedValue: 4e9, unitUnresolved: false, unitDimension: 'currency' });
    expect(byUnit.get('???')).toMatchObject({ unitUnresolved: true, unitDimension: 'unknown' });
    expect(byUnit.get('USD millions')).toMatchObject({
      scaleFlags: ['input scale unresolved — see lineage'],
      unitUnresolved: false,
    });

    // TRUST RULE: unresolved rows counted in the profile, never dropped
    expect(r.profile.unresolvedCount).toBe(2);
    expect(r.rows).toHaveLength(3);
  });

  it('caps: >5000 points → truncated.points; >50 entities → truncated.entities', async () => {
    const many = [];
    for (let i = 0; i < 5001; i++) many.push(obs('o' + i, 'ent1', 'Q1 2026', 'USD millions'));
    m(prisma.metricObservation.findMany).mockResolvedValue(many);
    let r = await buildChartData(WS, { dataset: 'observations' });
    expect(r.rows.length).toBe(5000);
    expect(r.truncated.points).toBe(true);

    const manyEntities = [];
    for (let e = 0; e < 51; e++) manyEntities.push(obs('oe' + e, 'ent' + e, 'Q1 2026', 'USD millions'));
    m(prisma.metricObservation.findMany).mockResolvedValue(manyEntities);
    r = await buildChartData(WS, { dataset: 'observations' });
    expect(r.truncated.entities).toBe(true);
    expect(new Set(r.rows.map((row) => row.entity)).size).toBe(50);
  });

  it('unparseable periods never chart (they cannot order)', async () => {
    m(prisma.metricObservation.findMany).mockResolvedValue([
      obs('o1', 'ent1', 'Q1 2026', 'USD millions'),
      obs('o2', 'ent1', 'FY-unknown', 'USD millions'),
    ]);
    const r = await buildChartData(WS, { dataset: 'observations' });
    expect(r.rows.map((row) => row.period)).toEqual(['Q1 2026']);
  });

  it('period range filters are ordinal, not string compares', async () => {
    m(prisma.metricObservation.findMany).mockResolvedValue([
      obs('o1', 'ent1', 'Q1 2026', 'USD millions'),
      obs('o2', 'ent1', 'Q2 2026', 'USD millions'),
      obs('o3', 'ent1', 'Q3 2026', 'USD millions'),
    ]);
    const r = await buildChartData(WS, {
      dataset: 'observations',
      filters: { periodFrom: 'Q2 2026', periodTo: 'Q3 2026' },
    });
    expect(r.rows.map((row) => row.period)).toEqual(['Q2 2026', 'Q3 2026']);
  });
});

describe('selector integration — responses recommend a chart with reasons', () => {
  it('observations trend auto-selects line with guardrail notes attached', async () => {
    m(prisma.metricObservation.findMany).mockResolvedValue([
      obs('o1', 'ent1', 'Q1 2026', 'USD millions'),
      obs('o2', 'ent1', 'Q2 2026', 'USD millions'),
    ]);
    const r = await buildChartData(WS, { dataset: 'observations', intent: 'trend' });
    expect(r.selection.recommended?.chartId).toBe('line');
    expect(r.selection.recommended?.reason).toBeTruthy();
    expect(r.selection.guardrails.some((n) => n.rule === 'derivation-encoding')).toBe(true);
  });

  it('empty data → no recommendation, table fallback with the reason', async () => {
    m(prisma.metricObservation.findMany).mockResolvedValue([]);
    const r = await buildChartData(WS, { dataset: 'observations' });
    expect(r.selection.recommended).toBeNull();
    expect(r.selection.fallbackTable?.reason).toBeTruthy();
  });
});
