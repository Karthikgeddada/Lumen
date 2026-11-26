import { prisma } from '../prisma';
import { logger } from '../logger';
import { chatJson, hasAI, aiUnavailableMessage } from './ai';
import { retrieve, buildContext, RetrievedChunk, ANTI_INJECTION_RULES } from './rag';
import { sendCovenantBreachEmail } from './mailer';

// Covenant intelligence: extract covenant definitions from credit agreements
// (grounded in the actual clauses), then test each quarter's observed metrics
// against them. Every definition keeps the excerpt and page it came from;
// AI-extracted definitions stay AI_INFERRED until a human reviews them.

export type ExtractedCovenant = {
  key: string;
  label: string;
  description?: string | null;
  metricKey: string;
  comparator: 'LTE' | 'GTE';
  threshold: number;
  unit?: string | null;
  period?: 'quarter' | 'ttm' | null;
  evidence?: number[];
  confidence?: number;
};

// ── Extract covenant definitions from a credit agreement ────────────────

export async function extractCovenantDefinitions(
  workspaceId: string,
  documentId: string,
  entityId: string,
  createdById: string,
): Promise<{ created: number }> {
  if (!hasAI()) throw new Error(aiUnavailableMessage());

  const doc = await prisma.document.findFirst({
    where: { id: documentId, workspaceId, deletedAt: null, status: 'COMPLETED' },
    select: { id: true, name: true },
  });
  if (!doc) throw new Error('Document not found or not processed.');

  const entity = await prisma.entity.findFirst({
    where: { id: entityId, workspaceId },
    select: { id: true, name: true },
  });
  if (!entity) throw new Error('Entity not found.');

  const chunks = await retrieve(
    workspaceId,
    { documentIds: [documentId] },
    'financial covenants maintenance covenants leverage ratio liquidity EBITDA minimum maximum threshold compliance certificate',
    12,
  );
  if (chunks.length === 0) throw new Error('No readable passages in this document.');

  const res = await chatJson<{ covenants: ExtractedCovenant[] }>([
    {
      role: 'system',
      content: `${ANTI_INJECTION_RULES}

You read passages from a credit agreement and extract the financial covenant definitions. Respond with JSON:
{"covenants":[{"key":"snake_case","label":"...","description":"...","metricKey":"snake_case","comparator":"LTE"|"GTE","threshold":number,"unit":"x"|"%"|"USD"|"days","period":"quarter"|"ttm","evidence":[block numbers],"confidence":0-1}]}

Rules:
- comparator LTE = the value must stay at or BELOW the threshold (maximum covenants, e.g. max leverage). GTE = at or ABOVE (minimum covenants, e.g. minimum liquidity).
- metricKey must be a snake_case metric identifier (e.g. net_leverage, ebitda, liquidity, dscr, revenue, net_debt) that analytics could observe per period.
- Only include covenants the evidence explicitly defines. Never invent thresholds. Set confidence honestly.
- Maximum 10 covenants.`,
    },
    {
      role: 'user',
      content: `Credit agreement: ${doc.name}\nEntity: ${entity.name}\n\nEvidence blocks:\n${buildContext(chunks)}`,
    },
  ]);

  const found = (res?.covenants ?? [])
    .filter((c) => c.key && c.label && c.metricKey && typeof c.threshold === 'number' && (c.comparator === 'LTE' || c.comparator === 'GTE'))
    .slice(0, 10);
  if (found.length === 0) return { created: 0 };

  let created = 0;
  for (const c of found) {
    const n = Array.isArray(c.evidence) ? c.evidence[0] : undefined;
    const evidence: RetrievedChunk | null =
      typeof n === 'number' && n >= 1 && n <= chunks.length ? chunks[n - 1] : null;

    const key = c.key.replace(/[^a-z0-9_]/gi, '_').slice(0, 60);
    // Skip keys this entity already has (re-extraction never duplicates).
    const exists = await prisma.covenantDefinition.findFirst({
      where: { entityId, key, deletedAt: null },
      select: { id: true },
    });
    if (exists) continue;

    await prisma.covenantDefinition.create({
      data: {
        workspaceId,
        entityId,
        documentId,
        key,
        label: c.label.slice(0, 120),
        description: c.description?.slice(0, 2000) ?? null,
        metricKey: c.metricKey.replace(/[^a-z0-9_]/gi, '_').slice(0, 80),
        comparator: c.comparator,
        threshold: c.threshold,
        unit: (c.unit ?? 'x').slice(0, 20),
        period: c.period === 'ttm' ? 'ttm' : 'quarter',
        sourceExcerpt: evidence ? evidence.text.slice(0, 1500) : null,
        sourcePage: evidence?.page ?? null,
        confidence: Math.max(0, Math.min(1, Number(c.confidence ?? 0))),
        status: 'AI_INFERRED',
        createdById,
      },
    });
    created++;
  }

  await prisma.auditEvent.create({
    data: {
      workspaceId,
      actorId: createdById,
      action: 'covenant.extracted',
      targetType: 'document',
      targetId: documentId,
      meta: { created, entityId },
    },
  });

  return { created };
}

// ── Test every covenant of an entity against a period ──────────────────

export async function runCovenantTests(workspaceId: string, entityId: string, period?: string) {
  const definitions = await prisma.covenantDefinition.findMany({
    where: { workspaceId, entityId, deletedAt: null },
  });
  if (definitions.length === 0) return { tested: 0, passed: 0, failed: 0, notTested: 0, results: [] };

  // Latest observed period for this entity when none given.
  let targetPeriod = period;
  if (!targetPeriod) {
    const latest = await prisma.metricObservation.findFirst({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      select: { period: true },
    });
    if (!latest) return { tested: 0, passed: 0, failed: 0, notTested: 0, results: [] };
    targetPeriod = latest.period;
  }

  const observations = await prisma.metricObservation.findMany({
    where: { entityId },
    select: { id: true, metricKey: true, period: true, value: true, unit: true, derivation: true },
  });
  const byMetric = new Map(
    observations.filter((o) => o.period === targetPeriod).map((o) => [o.metricKey, o]),
  );

  let passed = 0;
  let failed = 0;
  let freshBreaches = 0; // FAIL now but not FAIL before — avoids re-alerting known breaches
  let notTested = 0;
  const results: { definitionId: string; key: string; label: string; status: string; value: number | null; headroom: number | null }[] = [];

  for (const def of definitions) {
    const obs = byMetric.get(def.metricKey);

    let status: 'PASS' | 'FAIL' | 'NOT_TESTED' = 'NOT_TESTED';
    let value: number | null = null;
    let headroom: number | null = null;
    let observationId: string | null = null;

    if (obs) {
      value = obs.value;
      observationId = obs.id;
      headroom = def.comparator === 'LTE' ? def.threshold - obs.value : obs.value - def.threshold;
      status = headroom >= 0 ? 'PASS' : 'FAIL';
    }

    const previous = await prisma.covenantResult.findFirst({
      where: { definitionId: def.id, period: targetPeriod },
      select: { id: true, status: true },
    });

    if (status === 'PASS') passed++;
    else if (status === 'FAIL') {
      failed++;
      if (previous?.status !== 'FAIL') freshBreaches++;
    }
    else notTested++;

    await prisma.covenantResult.upsert({
      where: { definitionId_period: { definitionId: def.id, period: targetPeriod } },
      create: {
        definitionId: def.id,
        period: targetPeriod,
        value,
        status,
        headroom,
        observationId,
      },
      update: {
        value,
        status: status === 'NOT_TESTED' && previous?.status === 'WAIVED' ? 'WAIVED' : status,
        headroom,
        observationId,
        computedAt: new Date(),
      },
    });

    results.push({ definitionId: def.id, key: def.key, label: def.label, status, value, headroom });
  }

  // Alert every active member of the workspace — but only on FRESH breaches,
  // so automatic re-tests never spam already-known breaches.
  if (freshBreaches > 0) {
    const members = await prisma.membership.findMany({
      where: { workspaceId, deletedAt: null },
      select: { userId: true, user: { select: { email: true } } },
    });
    const entity = await prisma.entity.findUnique({ where: { id: entityId }, select: { name: true } });
    const data = members.map((m) => ({
      userId: m.userId,
      workspaceId,
      kind: 'covenant.breach',
      title: `${freshBreaches} new breach${freshBreaches === 1 ? '' : 'es'}`,
      body: `${entity?.name ?? 'Entity'} — ${targetPeriod}: ${freshBreaches} of ${definitions.length} covenants newly breached (${failed} total failing).`,
      link: '/covenants',
    }));
    if (data.length) {
      await prisma.notification.createMany({ data }).catch((err) => logger.error({ err }, 'covenant breach notification failed'));
    }
    // Email alert too (same freshness rule) — no-ops in dev mode or when SMTP
    // isn't configured; one mail per member, failures never break the test run.
    await Promise.all(
      members.map((m) =>
        sendCovenantBreachEmail(
          m.user.email,
          entity?.name ?? 'Entity',
          targetPeriod,
          freshBreaches,
          failed,
          definitions.length,
        ).catch((err) => logger.error({ err }, 'covenant breach email failed')),
      ),
    );
  }

  return { tested: passed + failed, passed, failed, notTested, period: targetPeriod, results };
}
