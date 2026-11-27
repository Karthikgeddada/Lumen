// Chart data service — the ONLY bridge between the pure chart brain and
// Prisma. Loads whitelisted datasets from the real models (tenancy on every
// query), enforces the caps (points 5000, entities 50, periods 24), computes
// profiles and runs the deterministic selector. No raw SQL, no arbitrary
// fields: every row key is a catalog-whitelisted field id.

import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { resolveThreshold } from '../core/ttm';
import { normalizeValue } from '../core/units';
import { comparePeriods, parsePeriod } from '../core/periods';
import {
  CHART_CATALOG,
  DATASETS,
  UNAVAILABLE_DATASETS,
  INTENTS,
  IntentId,
  ChartSpec,
  makeChartSpecSchema,
  profileRows,
  ProfileRow,
  selectChart,
  DataProfile,
  Selection,
} from '../core/charts';

// CHARTS_EXPERIMENTAL gates tier-3 charts (default OFF).
export const CHARTS_EXPERIMENTAL = process.env.CHARTS_EXPERIMENTAL === '1';

export const CHART_CAPS = { points: 5000, entities: 50, series: 12, periods: 24 } as const;

// ── Catalog ────────────────────────────────────────────────────────

export function buildCatalogResponse() {
  return {
    charts: CHART_CATALOG,
    datasets: DATASETS,
    unavailableDatasets: UNAVAILABLE_DATASETS, // "unavailable: needs <data>" — never faked
    intents: INTENTS,
    caps: CHART_CAPS,
    flags: { chartsExperimental: CHARTS_EXPERIMENTAL },
  };
}

// ── Dataset loaders ───────────────────────────────────────────────
// Each returns whitelisted rows + truncation info. Every Prisma query is
// scoped by workspaceId (tenancy), never by user-supplied raw conditions.

type Loaded = { rows: Array<Record<string, unknown>>; truncated: { points?: boolean; entities?: boolean; periods?: boolean } };

type ObsFilters = { entities?: string[]; metrics?: string[]; derivations?: string[]; periodFrom?: string; periodTo?: string };

async function loadObservations(wid: string, f: ObsFilters): Promise<Loaded> {
  const obs = await prisma.metricObservation.findMany({
    where: {
      entity: { workspaceId: wid },
      ...(f.entities?.length ? { entityId: { in: f.entities } } : {}),
      ...(f.metrics?.length ? { metricKey: { in: f.metrics } } : {}),
      ...(f.derivations?.length ? { derivation: { in: f.derivations as never[] } } : {}),
    },
    include: { entity: { select: { name: true } } },
    orderBy: [{ entityId: 'asc' }, { metricKey: 'asc' }, { period: 'asc' }],
  });

  const from = f.periodFrom ? parsePeriod(f.periodFrom)?.ordinal ?? null : null;
  const to = f.periodTo ? parsePeriod(f.periodTo)?.ordinal ?? null : null;
  let filtered = obs.filter((o) => {
    const p = parsePeriod(o.period);
    if (!p) return false; // unparseable periods never chart — they cannot order
    if (from !== null && p.ordinal < from) return false;
    if (to !== null && p.ordinal > to) return false;
    return true;
  });

  // Caps: entities 50 (deterministic first-by-id), periods 24 (most recent), points 5000.
  const truncated: Loaded['truncated'] = {};
  let entityIds = Array.from(new Set(filtered.map((o) => o.entityId))).sort();
  if (entityIds.length > CHART_CAPS.entities) {
    entityIds = entityIds.slice(0, CHART_CAPS.entities);
    truncated.entities = true;
    filtered = filtered.filter((o) => entityIds.includes(o.entityId));
  }
  let periods = Array.from(new Set(filtered.map((o) => o.period))).sort(comparePeriods);
  if (periods.length > CHART_CAPS.periods) {
    periods = periods.slice(periods.length - CHART_CAPS.periods);
    truncated.periods = true;
    filtered = filtered.filter((o) => periods.includes(o.period));
  }
  if (filtered.length > CHART_CAPS.points) {
    truncated.points = true;
    filtered = filtered.slice(0, CHART_CAPS.points);
  }

  const rows = filtered.map((o) => {
    const scale = o.scale as Record<string, unknown> | null;
    const flags: string[] = scale?.unresolved ? ['input scale unresolved — see lineage'] : Array.isArray(scale?.flags) ? (scale.flags as string[]) : [];
    const normalized = normalizeValue(o.value, o.unit);
    return {
      entity: o.entityId,
      entityName: o.entity.name,
      metric: o.metricKey,
      metricLabel: o.label,
      period: o.period,
      value: o.value,
      normalizedValue: normalized.value,
      unit: o.unit,
      unitDimension: normalized.unit.dimension,
      unitUnresolved: normalized.unit.unitUnresolved, // TRUST RULE flag
      derivation: o.derivation,
      confidence: o.confidence,
      sourceDocumentId: o.sourceDocumentId,
      sourcePage: o.sourcePage,
      sourceExcerpt: o.sourceExcerpt,
      extractionResultId: o.extractionResultId,
      inputs: o.inputs,
      scaleFlags: flags,
    };
  });
  return { rows, truncated };
}

type CovFilters = { entities?: string[]; covenants?: string[]; statuses?: string[]; periodFrom?: string; periodTo?: string };

async function loadCovenantResults(wid: string, f: CovFilters): Promise<Loaded> {
  const defs = await prisma.covenantDefinition.findMany({
    where: {
      workspaceId: wid,
      deletedAt: null,
      ...(f.covenants?.length ? { key: { in: f.covenants } } : {}),
      ...(f.entities?.length ? { entityId: { in: f.entities } } : {}),
    },
    include: { entity: { select: { name: true } } },
    orderBy: [{ entityId: 'asc' }, { key: 'asc' }],
  });
  const results = await prisma.covenantResult.findMany({
    where: { definitionId: { in: defs.map((d) => d.id) } },
    orderBy: [{ period: 'asc' }],
  });
  const inPeriodRange = (period: string): boolean => {
    const p = parsePeriod(period);
    if (!p) return false;
    const fO = f.periodFrom ? parsePeriod(f.periodFrom)?.ordinal ?? null : null;
    const tO = f.periodTo ? parsePeriod(f.periodTo)?.ordinal ?? null : null;
    if (fO !== null && p.ordinal < fO) return false;
    if (tO !== null && p.ordinal > tO) return false;
    return true;
  };

  const rows: Array<Record<string, unknown>> = [];
  for (const d of defs) {
    for (const r of results) {
      if (r.definitionId !== d.id) continue;
      if (f.statuses?.length && !f.statuses.includes(r.status)) continue;
      if (!inPeriodRange(r.period)) continue;
      rows.push({
        entity: d.entityId,
        entityName: d.entity.name,
        covenant: d.key,
        covenantLabel: d.label,
        comparator: d.comparator,
        period: r.period,
        value: r.value,
        thresholdInForce: resolveThreshold(d.threshold, d.schedule as never, r.period), // incl. step-down schedules
        headroom: r.headroom,
        status: r.status,
        nearBreach: r.nearBreach,
        previousStatus: r.previousStatus,
        reason: r.reason,
        observationId: r.observationId,
      });
    }
  }
  const truncated: Loaded['truncated'] = {};
  if (rows.length > CHART_CAPS.points) {
    truncated.points = true;
    rows.length = CHART_CAPS.points;
  }
  return { rows, truncated };
}

async function loadCovenantStatusMatrix(wid: string, f: CovFilters): Promise<Loaded> {
  // Latest result per definition (unique definitionId+period → max by ordinal).
  const defs = await prisma.covenantDefinition.findMany({
    where: {
      workspaceId: wid,
      deletedAt: null,
      ...(f.covenants?.length ? { key: { in: f.covenants } } : {}),
      ...(f.entities?.length ? { entityId: { in: f.entities } } : {}),
    },
    include: { entity: { select: { name: true } } },
    orderBy: [{ entityId: 'asc' }, { key: 'asc' }],
  });
  const results = await prisma.covenantResult.findMany({
    where: { definitionId: { in: defs.map((d) => d.id) } },
  });
  const latestByDef = new Map<string, (typeof results)[number]>();
  for (const r of results) {
    const cur = latestByDef.get(r.definitionId);
    if (!cur || comparePeriods(r.period, cur.period) > 0) latestByDef.set(r.definitionId, r);
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const d of defs) {
    const r = latestByDef.get(d.id);
    const status = r?.status ?? 'NOT_TESTED';
    if (f.statuses?.length && !f.statuses.includes(status)) continue;
    rows.push({
      entity: d.entityId,
      entityName: d.entity.name,
      covenant: d.key,
      covenantLabel: d.label,
      status,
      latestPeriod: r?.period ?? null,
      headroom: r?.headroom ?? null,
      previousStatus: r?.previousStatus ?? null,
    });
  }
  return { rows, truncated: {} };
}

async function loadPipelineFunnel(wid: string): Promise<Loaded> {
  const [documents, extractionResults, observations] = await Promise.all([
    prisma.document.findMany({ where: { workspaceId: wid, deletedAt: null }, select: { id: true } }),
    prisma.extractionResult.findMany({
      where: { task: { workspaceId: wid, deletedAt: null }, documentId: { not: null } },
      select: { status: true, documentId: true },
    }),
    prisma.metricObservation.findMany({ where: { entity: { workspaceId: wid } }, select: { id: true } }),
  ]);
  const docs = new Set(documents.map((d) => d.id));
  const extractedDocs = new Set<string>();
  const verifiedDocs = new Set<string>();
  for (const r of extractionResults) {
    if (r.documentId && docs.has(r.documentId)) {
      extractedDocs.add(r.documentId);
      if (r.status === 'VERIFIED') verifiedDocs.add(r.documentId);
    }
  }
  // Honest counts; if the funnel is not monotonic, the chart says so.
  return {
    rows: [
      { stage: 'documents', count: docs.size },
      { stage: 'extracted', count: extractedDocs.size },
      { stage: 'verified', count: verifiedDocs.size },
      { stage: 'ingested', count: observations.length },
    ],
    truncated: {},
  };
}

async function loadExtractionQuality(wid: string): Promise<Loaded> {
  const [derivations, extraction] = await Promise.all([
    prisma.metricObservation.groupBy({
      by: ['derivation'],
      _count: { _all: true },
      where: { entity: { workspaceId: wid } },
    }),
    prisma.extractionResult.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: { task: { workspaceId: wid, deletedAt: null } },
    }),
  ]);
  const rows: Array<Record<string, unknown>> = [];
  for (const d of derivations) rows.push({ dimension: 'derivation', category: d.derivation, count: d._count._all });
  for (const e of extraction) rows.push({ dimension: 'extraction', category: e.status, count: e._count._all });
  return { rows, truncated: {} };
}

async function loadRevisions(wid: string, f: { entities?: string[]; metrics?: string[] }): Promise<Loaded> {
  const revs = await prisma.observationRevision.findMany({
    where: {
      observation: {
        entity: { workspaceId: wid },
        ...(f.entities?.length ? { entityId: { in: f.entities } } : {}),
        ...(f.metrics?.length ? { metricKey: { in: f.metrics } } : {}),
      },
    },
    include: { observation: { select: { metricKey: true, period: true, entity: { select: { name: true } } } } },
    orderBy: { changedAt: 'asc' },
    take: CHART_CAPS.points,
  });
  const rows = revs.map((r) => ({
    observationId: r.observationId,
    entityName: r.observation.entity.name,
    metric: r.observation.metricKey,
    period: r.observation.period,
    changedAt: r.changedAt,
    previousValue: r.previousValue,
    previousUnit: r.previousUnit,
    previousDerivation: r.previousDerivation,
    changedById: r.changedById,
    reason: r.reason,
  }));
  return { rows, truncated: revs.length === CHART_CAPS.points ? { points: true } : {} };
}

// Lineage graph rows: CALCULATED inputs → the calculated metric → any covenant
// its observation backs. Nodes keyed by observation id.
async function loadLineage(wid: string, f: { entities?: string[]; metrics?: string[] }): Promise<Loaded> {
  const calc = await prisma.metricObservation.findMany({
    where: {
      entity: { workspaceId: wid },
      derivation: 'CALCULATED',
      ...(f.entities?.length ? { entityId: { in: f.entities } } : {}),
      ...(f.metrics?.length ? { metricKey: { in: f.metrics } } : {}),
      inputs: { not: Prisma.DbNull },
    },
    include: { entity: { select: { name: true } } },
    orderBy: [{ entityId: 'asc' }, { metricKey: 'asc' }],
    take: CHART_CAPS.entities * 2, // lineage graphs beyond this are unreadable
  });
  const obsIds = calc.map((c) => c.id);
  const covResults = obsIds.length
    ? await prisma.covenantResult.findMany({
        where: { observationId: { in: obsIds }, definition: { workspaceId: wid, deletedAt: null } },
        include: { definition: { select: { key: true, label: true, entity: { select: { name: true } } } } },
      })
    : [];
  const covByObs = new Map<string, { key: string; label: string; entityName: string }>();
  for (const r of covResults) {
    if (r.observationId) covByObs.set(r.observationId, { key: r.definition.key, label: r.definition.label, entityName: r.definition.entity.name });
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const c of calc) {
    const inputs = Array.isArray(c.inputs) ? (c.inputs as Array<Record<string, unknown>>) : [];
    for (const inp of inputs) {
      const inputObsIds = Array.isArray(inp.observationIds) ? (inp.observationIds as string[]) : [];
      for (const inputId of inputObsIds) {
        rows.push({
          node: inputId,
          parent: c.id,
          label: String(inp.metricKey ?? inp.key ?? 'input'),
          kind: 'input',
          value: typeof inp.value === 'number' ? inp.value : null,
          unit: null,
          derivation: 'REPORTED',
          periods: Array.isArray(inp.periods) ? (inp.periods as string[]) : [],
        });
      }
    }
    rows.push({
      node: c.id,
      parent: null,
      label: c.metricKey + ' (' + c.entity.name + ')',
      kind: 'metric',
      value: c.value,
      unit: c.unit,
      derivation: 'CALCULATED',
      periods: [c.period],
    });
    const cov = covByObs.get(c.id);
    if (cov) {
      rows.push({
        node: c.id + ':cov',
        parent: c.id,
        label: cov.label,
        kind: 'covenant',
        value: null,
        unit: null,
        derivation: null,
        periods: [],
      });
    }
  }
  return { rows, truncated: calc.length >= CHART_CAPS.entities * 2 ? { entities: true } : {} };
}

// ── Orchestration ───────────────────────────────────────────────────

export type ChartDataResponse = {
  dataset: string;
  rows: Array<Record<string, unknown>>;
  profile: DataProfile;
  selection: Selection;
  caps: typeof CHART_CAPS;
  truncated: Loaded['truncated'];
};

export async function buildChartData(wid: string, rawSpec: unknown): Promise<ChartDataResponse> {
  const schema = makeChartSpecSchema(CHARTS_EXPERIMENTAL);
  const parsed = schema.safeParse(rawSpec);
  if (!parsed.success) {
    const err = new Error(parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '));
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  const spec = parsed.data as ChartSpec;
  const filters = spec.filters ?? {};

  let loaded: Loaded;
  switch (spec.dataset) {
    case 'observations':
      loaded = await loadObservations(wid, filters as ObsFilters);
      break;
    case 'covenant_results':
      loaded = await loadCovenantResults(wid, filters as CovFilters);
      break;
    case 'covenant_status_matrix':
      loaded = await loadCovenantStatusMatrix(wid, filters as CovFilters);
      break;
    case 'pipeline_funnel':
      loaded = await loadPipelineFunnel(wid);
      break;
    case 'extraction_quality':
      loaded = await loadExtractionQuality(wid);
      break;
    case 'revisions':
      loaded = await loadRevisions(wid, filters as { entities?: string[]; metrics?: string[] });
      break;
    case 'lineage':
      loaded = await loadLineage(wid, filters as { entities?: string[]; metrics?: string[] });
      break;
    default:
      throw new Error("Unknown dataset '" + spec.dataset + "'.");
  }

  // Profile: TRUST RULE — unresolved rows (scale flags or unparseable units)
  // are counted so charts flag them and never aggregate them silently.
  const profileRowsIn = loaded.rows.map((r) => {
    const pp = typeof r.period === 'string' ? parsePeriod(r.period) : null;
    return {
      ...r,
      periodOrdinal: pp?.ordinal,
      periodKind: pp?.kind,
      unresolved: (Array.isArray(r.scaleFlags) && (r.scaleFlags as string[]).length > 0) || r.unitUnresolved === true,
    };
  }) as unknown as ProfileRow[];
  const profile = profileRows(profileRowsIn);

  const selection = selectChart(spec.dataset, spec.intent as IntentId | 'auto', profile, {
    chartsExperimental: CHARTS_EXPERIMENTAL,
    requestedChart: spec.chart,
  });

  return { dataset: spec.dataset, rows: loaded.rows, profile, selection, caps: CHART_CAPS, truncated: loaded.truncated };
}

// ── Saved views ────────────────────────────────────────────────────

export async function listSavedViews(wid: string, userId: string) {
  return prisma.savedChartView.findMany({
    where: { workspaceId: wid, userId },
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
  });
}

export async function createSavedView(wid: string, userId: string, name: string, spec: unknown) {
  const parsed = makeChartSpecSchema(CHARTS_EXPERIMENTAL).safeParse(spec);
  if (!parsed.success) {
    const err = new Error('Invalid chart spec: ' + parsed.error.issues.map((i) => i.message).join('; '));
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  return prisma.savedChartView.create({
    data: { workspaceId: wid, userId, name, spec: parsed.data as Prisma.InputJsonValue },
  });
}

export async function findSavedView(wid: string, viewId: string) {
  return prisma.savedChartView.findFirst({ where: { id: viewId, workspaceId: wid } });
}

export async function updateSavedView(
  wid: string,
  viewId: string,
  patch: { name?: string; spec?: unknown; pinned?: boolean },
) {
  const view = await findSavedView(wid, viewId);
  if (!view) return null;
  const data: Prisma.SavedChartViewUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.pinned !== undefined) data.pinned = patch.pinned;
  if (patch.spec !== undefined) {
    const parsed = makeChartSpecSchema(CHARTS_EXPERIMENTAL).safeParse(patch.spec);
    if (!parsed.success) {
      const err = new Error('Invalid chart spec: ' + parsed.error.issues.map((i) => i.message).join('; '));
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    data.spec = parsed.data as Prisma.InputJsonValue;
  }
  return prisma.savedChartView.update({ where: { id: view.id }, data });
}

export async function deleteSavedView(wid: string, viewId: string) {
  const view = await findSavedView(wid, viewId);
  if (!view) return null;
  await prisma.savedChartView.delete({ where: { id: view.id } });
  return view;
}
