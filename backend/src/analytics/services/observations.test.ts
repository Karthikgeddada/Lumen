// Tests for the SINGLE observation writer: upsert semantics, the overwrite
// guard, append-only revision history, and the covenant retest trigger.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../../prisma', () => ({
  prisma: {
    metricObservation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    observationRevision: { create: vi.fn() },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  },
}));

vi.mock('../../services/covenants', () => ({
  runCovenantTests: vi.fn().mockResolvedValue([]),
}));

import { prisma } from '../../prisma';
import { runCovenantTests } from '../../services/covenants';
import { writeObservation, WriteObservationInput } from './observations';

const m = (f: unknown) => f as ReturnType<typeof vi.fn>;

const base: WriteObservationInput = {
  workspaceId: 'ws1',
  entityId: 'ent1',
  metricKey: 'revenue',
  label: 'Revenue',
  period: 'Q3 2026',
  value: 4.82,
  unit: 'USD billions',
  derivation: 'REPORTED',
  reason: 'manual entry',
};

const existing = {
  id: 'obs1',
  entityId: 'ent1',
  metricKey: 'revenue',
  label: 'Revenue',
  period: 'Q3 2026',
  value: 4.5,
  unit: 'USD billions',
  derivation: 'REPORTED',
  confidence: 0.9,
  sourceDocumentId: 'doc9',
  sourcePage: 3,
  sourceExcerpt: 'Revenue was $4.5bn',
  scale: { multiplier: 1e9 },
  inputs: null,
  extractionResultId: null,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('writeObservation — create path', () => {
  it('creates when nothing exists, no revision, triggers covenant retest', async () => {
    m(prisma.metricObservation.findUnique).mockResolvedValue(null);
    m(prisma.metricObservation.create).mockResolvedValue({ id: 'obs-new', ...base });

    const r = await writeObservation({ ...base, changedById: 'user1' });
    expect(r).toEqual({ outcome: 'created', observation: expect.objectContaining({ id: 'obs-new' }) });
    const data = m(prisma.metricObservation.create).mock.calls[0][0].data;
    expect(data).toMatchObject({ entityId: 'ent1', metricKey: 'revenue', period: 'Q3 2026', value: 4.82, derivation: 'REPORTED' });
    expect(m(prisma.observationRevision.create)).not.toHaveBeenCalled();
    await new Promise((r2) => setImmediate(r2)); // let the fire-and-forget retest run
    expect(m(runCovenantTests)).toHaveBeenCalledWith('ws1', 'ent1', 'Q3 2026');
  });

  it('skips the retest when triggerRetest is false (bulk ingest batches its own)', async () => {
    m(prisma.metricObservation.findUnique).mockResolvedValue(null);
    m(prisma.metricObservation.create).mockResolvedValue({ id: 'obs-new' });
    await writeObservation({ ...base, triggerRetest: false, reason: 'ingest from extraction' });
    await new Promise((r2) => setImmediate(r2));
    expect(m(runCovenantTests)).not.toHaveBeenCalled();
  });
});

describe('writeObservation — update path', () => {
  it('updates and appends a revision capturing the PREVIOUS state', async () => {
    m(prisma.metricObservation.findUnique).mockResolvedValue(existing);
    m(prisma.metricObservation.update).mockResolvedValue({ id: 'obs1', value: 4.82 });

    const r = await writeObservation({ ...base, changedById: 'user1', guard: 'allow' });
    expect(r).toEqual({ outcome: 'updated', observation: expect.objectContaining({ id: 'obs1' }) });

    const updateArgs = m(prisma.metricObservation.update).mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'obs1' });
    expect(updateArgs.data).toMatchObject({ value: 4.82, unit: 'USD billions', derivation: 'REPORTED' });
    // manual edit without a source: previous source is left untouched (undefined = skip)
    expect(updateArgs.data).not.toHaveProperty('sourceDocumentId');
    expect(updateArgs.data).not.toHaveProperty('scale');

    const rev = m(prisma.observationRevision.create).mock.calls[0][0].data;
    expect(rev).toEqual({
      observationId: 'obs1',
      previousValue: 4.5,
      previousUnit: 'USD billions',
      previousDerivation: 'REPORTED',
      previousScale: { multiplier: 1e9 },
      previousSourceDocumentId: 'doc9',
      previousSourcePage: 3,
      previousSourceExcerpt: 'Revenue was $4.5bn',
      changedById: 'user1',
      reason: 'manual entry',
    });
    // update + revision in one transaction
    expect(m(prisma.$transaction)).toHaveBeenCalledTimes(1);
  });

  it('overwrites explicitly provided fields only (ingest semantics)', async () => {
    m(prisma.metricObservation.findUnique).mockResolvedValue(existing);
    m(prisma.metricObservation.update).mockResolvedValue({ id: 'obs1' });
    await writeObservation({
      ...base,
      value: 4.5, // same number — metadata refresh
      confidence: 0.95,
      sourceDocumentId: 'doc10',
      scale: null,
      reason: 'ingest from extraction',
      guard: 'overwrite',
    });
    const data = m(prisma.metricObservation.update).mock.calls[0][0].data;
    expect(data.confidence).toBe(0.95);
    expect(data.sourceDocumentId).toBe('doc10');
    expect(data.sourceExcerpt).toBeUndefined(); // not provided → untouched
    expect(data.label).toBeUndefined(); // ingest never rewrites labels on update (updateLabel unset)
    expect(data.scale).toBe(Prisma.JsonNull);
    // a same-value refresh is still a change event → revision appended
    expect(m(prisma.observationRevision.create)).toHaveBeenCalledTimes(1);
  });
});

describe('writeObservation — overwrite guard (TRUST RULE)', () => {
  it('refuses to replace a differing stored figure and reports a conflict', async () => {
    m(prisma.metricObservation.findUnique).mockResolvedValue(existing);
    const r = await writeObservation({
      ...base,
      value: 9.9, // differs from stored 4.5
      entityName: 'Halden',
      sourceDocumentId: 'doc10',
      reason: 'ingest from extraction',
      guard: 'overwrite',
    });
    expect(r.outcome).toBe('conflict');
    if (r.outcome !== 'conflict') return;
    expect(r.conflict).toEqual({
      entity: 'Halden',
      metric: 'revenue',
      period: 'Q3 2026',
      existingValue: 4.5,
      existingDerivation: 'REPORTED',
      existingSourceDocumentId: 'doc9',
      newValue: 9.9,
      newSourceDocumentId: 'doc10',
    });
    // nothing was written, no revision, no retest
    expect(m(prisma.metricObservation.update)).not.toHaveBeenCalled();
    expect(m(prisma.metricObservation.create)).not.toHaveBeenCalled();
    expect(m(prisma.observationRevision.create)).not.toHaveBeenCalled();
    await new Promise((r2) => setImmediate(r2));
    expect(m(runCovenantTests)).not.toHaveBeenCalled();
  });

  it('manual edits (guard allow) may replace a value — history keeps the previous state', async () => {
    m(prisma.metricObservation.findUnique).mockResolvedValue(existing);
    m(prisma.metricObservation.update).mockResolvedValue({ id: 'obs1' });
    const r = await writeObservation({ ...base, value: 9.9, guard: 'allow' });
    expect(r.outcome).toBe('updated');
    expect(m(prisma.observationRevision.create)).toHaveBeenCalledTimes(1);
    expect(m(prisma.observationRevision.create).mock.calls[0][0].data.previousValue).toBe(4.5);
  });
});
