// Demo data for the chart engine — item 5 of the chart-engine directive.
//
// HOW TO RUN (deliberately NOT run by the agent — no test data in prod or the
// demo workspace):
//   ALLOW_SEED_CHARTS=1 DATABASE_URL=<url> AUTH_SECRET=<any> \
//     npm run seed:charts-demo -- --workspace-slug <slug>
//
// Safety: refuses unless ALLOW_SEED_CHARTS=1. Idempotent: it deletes the seven
// demo entities below (cascade removes their observations, revisions,
// covenant definitions and results) and recreates them with the SAME
// deterministic values every time — no randomness, no clock-based values.
// All observations go through the real observation writer (writeObservation,
// retests suppressed — the covenant runner runs once per entity at the end);
// all covenant results come from the real runner (runCovenantTests).
// The two status cases the runner never produces are set directly and marked:
// WAIVED (display-only cure context, never auto-applied) and the Fjord annual
// NOT_TESTED which the runner itself records.

const argv = process.argv.slice(2);
const slugIdx = argv.indexOf('--workspace-slug');
const slug = slugIdx >= 0 ? argv[slugIdx + 1] : undefined;

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (process.env.ALLOW_SEED_CHARTS !== '1') {
  die('Refusing: demo seeding requires ALLOW_SEED_CHARTS=1 (protects prod and the demo workspace).');
}
if (!slug) {
  die('Usage: npm run seed:charts-demo -- --workspace-slug <slug>');
}

async function main() {
  // Imported AFTER the gate so a refused run touches no config or DB client.
  const { writeObservation } = await import('../src/analytics/services/observations');
  const { runCovenantTests } = await import('../src/services/covenants');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const ws = await prisma.workspace.findUnique({ where: { slug } });
    if (!ws) die(`Workspace with slug '${slug}' not found.`);
    const member = await prisma.membership.findFirst({
      where: { workspaceId: ws.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!member) die('Workspace has no members — cannot attribute demo data.');

    const QUARTERS = ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'];
    const ENTITIES = [
      'Northwind Holdings',
      'Aurora Manufacturing',
      'Bristol Logistics',
      'Cedar Retail Group',
      'Delta Energy Partners',
      'Elm Street Media',
      'Fjord Shipping',
    ];

    // Idempotent: drop previous demo entities (cascade) and recreate.
    const dropped = await prisma.entity.deleteMany({
      where: { workspaceId: ws.id, name: { in: ENTITIES } },
    });
    if (dropped.count > 0) console.log(`Removed ${dropped.count} previous demo entities (idempotent re-run).`);

    const entityIds: Record<string, string> = {};
    for (const name of ENTITIES) {
      const e = await prisma.entity.create({ data: { workspaceId: ws.id, name } });
      entityIds[name] = e.id;
    }

    type Row = {
      metric: string;
      label: string;
      period: string;
      value: number;
      unit: string;
      derivation: 'REPORTED' | 'AI_INFERRED';
      confidence?: number;
      scale?: unknown;
    };
    const rows: Array<{ entity: string } & Row> = [];
    const push = (entity: string, r: Row) => rows.push({ entity, ...r });

    // Deterministic arithmetic: index-driven progressions, no randomness.
    const rev = (i: number, q: number) => 400 + i * 30 + q * 8; // revenue, USD millions
    const ebitdaOf = (revenue: number, i: number) => Math.round((revenue * 0.22 - i) * 10) / 10;
    const netDebt = (i: number, q: number) => 300 + i * 15 - q * 3; // declining, USD millions
    const liq = (i: number, q: number) => 100 + i * 6 + q * 2;

    ENTITIES.forEach((name, i) => {
      const entityId = entityIds[name];
      QUARTERS.forEach((period, q) => {
        // Bristol: one missing quarter — revenue absent in Q3 2026 (a real gap
        // that must stay a visible gap in charts and make TTM NOT_TESTED).
        if (name === 'Bristol Logistics' && period === 'Q3 2026') {
          push(name, {
            metric: 'ebitda', label: 'EBITDA', period, value: ebitdaOf(rev(i, q), i),
            unit: 'USD millions', derivation: 'REPORTED', confidence: 0.95,
          });
          return;
        }

        // Aurora demonstrates unit normalization: figures stated in USD
        // thousands (normalized values must line up with the others).
        const aurora = name === 'Aurora Manufacturing';
        const unit = aurora ? 'USD thousands' : 'USD millions';
        const factor = aurora ? 1000 : 1;

        push(name, {
          metric: 'revenue', label: 'Revenue', period, value: rev(i, q) * factor, unit,
          // One AI_INFERRED point (Northwind Q2 2026) — lighter encoding in charts.
          derivation: name === 'Northwind Holdings' && period === 'Q2 2026' ? 'AI_INFERRED' : 'REPORTED',
          confidence: name === 'Northwind Holdings' && period === 'Q2 2026' ? 0.72 : 0.95,
        });
        push(name, {
          metric: 'ebitda', label: 'EBITDA', period, value: ebitdaOf(rev(i, q), i) * factor, unit,
          derivation: 'REPORTED', confidence: 0.95,
          // One unresolved-scale observation (Elm Q3 2026): TRUST RULE flag —
          // charts show it flagged; covenants over it are NOT_TESTED.
          scale: name === 'Elm Street Media' && period === 'Q3 2026'
            ? { unresolved: true, flags: ['ebitda: unit scale unresolved in source (Q3 2026)'] }
            : { resolved: true, factor: factor, note: 'stated in ' + unit },
        });
        // Delta carries structurally high debt: TTM leverage ≈ 2.8x (PASS at
        // the 3.5 step-down) before the manual correction, ≈ 3.6x after (FAIL).
        const deltaDebt = name === 'Delta Energy Partners' ? 1200 + 20 * q : netDebt(i, q);
        push(name, {
          metric: 'net_debt', label: 'Net debt', period, value: deltaDebt * factor, unit,
          derivation: 'REPORTED', confidence: 0.95,
          scale: { resolved: true, factor: factor, note: 'stated in ' + unit },
        });
        push(name, {
          metric: 'interest_expense', label: 'Interest expense', period, value: (22 + i) * factor, unit,
          derivation: 'REPORTED', confidence: 0.95,
        });
        // Cedar's liquidity sits just above the 100 minimum — a PASS inside
        // the near-breach band (headroom 2–9% ≤ 20%).
        push(name, {
          metric: 'liquidity', label: 'Liquidity', period,
          value: name === 'Cedar Retail Group' ? 102 + (q % 3) : liq(i, q),
          unit: 'USD millions', derivation: 'REPORTED', confidence: 0.95,
        });

        // Northwind: three additive segments summing exactly to revenue
        // (component-sum validation rules and stacking get real data).
        if (name === 'Northwind Holdings') {
          const r = rev(i, q);
          push(name, { metric: 'seg:core', label: 'Segment: Core', period, value: Math.round(r * 0.55 * 10) / 10, unit, derivation: 'REPORTED', confidence: 0.9 });
          push(name, { metric: 'seg:industrial', label: 'Segment: Industrial', period, value: Math.round(r * 0.27 * 10) / 10, unit, derivation: 'REPORTED', confidence: 0.9 });
          push(name, { metric: 'seg:services', label: 'Segment: Services', period, value: Math.round(r * 0.18 * 10) / 10, unit, derivation: 'REPORTED', confidence: 0.9 });
        }
      });

      // Fjord: one ANNUAL period — annual and quarterly never share a chart
      // axis, and TTM cannot be computed on annual data (NOT_TESTED).
      if (name === 'Fjord Shipping') {
        push(name, { metric: 'revenue', label: 'Revenue', period: '2025', value: 520, unit: 'USD millions', derivation: 'REPORTED', confidence: 0.95 });
        push(name, { metric: 'ebitda', label: 'EBITDA', period: '2025', value: 96, unit: 'USD millions', derivation: 'REPORTED', confidence: 0.95 });
      }
    });

    // Delta's Q4 2026 net_debt is written with the high series (TTM leverage
    // ≈ 2.8x → PASS at the 3.5 step-down); after the first covenant run it is
    // manually corrected further upward (a real revision) and re-tested →
    // FAIL with previousStatus PASS.
    const deltaQ4 = 'Q4 2026';

    let written = 0;
    for (const r of rows) {
      const entityId = entityIds[r.entity];
      const value = r.value;
      const out = await writeObservation({
        workspaceId: ws.id,
        entityId,
        entityName: r.entity,
        metricKey: r.metric,
        label: r.label,
        period: r.period,
        value,
        unit: r.unit,
        derivation: r.derivation,
        confidence: r.confidence ?? null,
        sourceExcerpt: `[demo seed] ${r.label}, ${r.period}: ${value} (${r.unit})`,
        scale: (r.scale ?? null) as never,
        changedById: member.userId,
        reason: 'manual entry',
        guard: 'allow',
        updateLabel: true,
        triggerRetest: false, // explicit covenant runs at the end — one pass, not N
      });
      if (out.outcome === 'conflict') die(`Unexpected write conflict: ${JSON.stringify(out.conflict)}`);
      written++;
    }
    console.log(`Wrote ${written} observations through the observation writer.`);

    // ── Covenant definitions (structural config; results come from the runner) ──
    type DefSpec = {
      entity: string; key: string; label: string; metricKey: string;
      comparator: 'LTE' | 'GTE'; threshold: number; unit: string; period: 'quarter' | 'ttm';
      formula?: string; terms?: unknown; schedule?: unknown; nearBreachPct?: number;
    };
    const LEV_TERMS = {
      inputs: [
        { key: 'net_debt', metricKey: 'net_debt', kind: 'stock' },
        { key: 'ebitda', metricKey: 'ebitda', kind: 'flow' },
      ],
    };
    const COV_TERMS = {
      inputs: [
        { key: 'ebitda', metricKey: 'ebitda', kind: 'flow' },
        { key: 'interest_expense', metricKey: 'interest_expense', kind: 'flow' },
      ],
    };
    const STEP_DOWN = [{ effectiveFrom: 'Q3 2026', threshold: 3.5 }];
    const defs: DefSpec[] = [
      // Northwind: all three covenants — leverage with a step-down schedule.
      { entity: 'Northwind Holdings', key: 'max_net_leverage', label: 'Max net leverage (TTM)', metricKey: 'net_leverage', comparator: 'LTE', threshold: 4.0, unit: 'x', period: 'ttm', formula: 'net_debt / ebitda', terms: LEV_TERMS, schedule: STEP_DOWN, nearBreachPct: 15 },
      { entity: 'Northwind Holdings', key: 'min_interest_coverage', label: 'Min interest coverage (TTM)', metricKey: 'interest_coverage', comparator: 'GTE', threshold: 3.0, unit: 'x', period: 'ttm', formula: 'ebitda / interest_expense', terms: COV_TERMS, nearBreachPct: 15 },
      { entity: 'Northwind Holdings', key: 'min_liquidity', label: 'Minimum liquidity', metricKey: 'liquidity', comparator: 'GTE', threshold: 100, unit: 'USD millions', period: 'quarter', nearBreachPct: 20 },
      { entity: 'Aurora Manufacturing', key: 'max_net_leverage', label: 'Max net leverage (TTM)', metricKey: 'net_leverage', comparator: 'LTE', threshold: 4.0, unit: 'x', period: 'ttm', formula: 'net_debt / ebitda', terms: LEV_TERMS, schedule: STEP_DOWN, nearBreachPct: 15 },
      { entity: 'Bristol Logistics', key: 'max_net_leverage', label: 'Max net leverage (TTM)', metricKey: 'net_leverage', comparator: 'LTE', threshold: 4.0, unit: 'x', period: 'ttm', formula: 'net_debt / ebitda', terms: LEV_TERMS, schedule: STEP_DOWN, nearBreachPct: 15 },
      { entity: 'Cedar Retail Group', key: 'min_liquidity', label: 'Minimum liquidity', metricKey: 'liquidity', comparator: 'GTE', threshold: 100, unit: 'USD millions', period: 'quarter', nearBreachPct: 20 },
      { entity: 'Delta Energy Partners', key: 'max_net_leverage', label: 'Max net leverage (TTM)', metricKey: 'net_leverage', comparator: 'LTE', threshold: 4.0, unit: 'x', period: 'ttm', formula: 'net_debt / ebitda', terms: LEV_TERMS, schedule: STEP_DOWN, nearBreachPct: 15 },
      { entity: 'Elm Street Media', key: 'max_net_leverage', label: 'Max net leverage (TTM)', metricKey: 'net_leverage', comparator: 'LTE', threshold: 4.0, unit: 'x', period: 'ttm', formula: 'net_debt / ebitda', terms: LEV_TERMS, schedule: STEP_DOWN, nearBreachPct: 15 },
      { entity: 'Fjord Shipping', key: 'min_liquidity', label: 'Minimum liquidity', metricKey: 'liquidity', comparator: 'GTE', threshold: 100, unit: 'USD millions', period: 'quarter', nearBreachPct: 20 },
    ];

    const defIds: Record<string, string> = {};
    for (const d of defs) {
      const created = await prisma.covenantDefinition.create({
        data: {
          workspaceId: ws.id,
          entityId: entityIds[d.entity],
          key: d.key,
          label: d.label,
          metricKey: d.metricKey,
          comparator: d.comparator,
          threshold: d.threshold,
          unit: d.unit,
          period: d.period,
          formula: d.formula ?? null,
          terms: (d.terms ?? null) as never,
          schedule: (d.schedule ?? null) as never,
          nearBreachPct: d.nearBreachPct ?? null,
          status: 'REVIEWED',
          confidence: 1,
          sourceExcerpt: '[demo seed] covenant definition',
          createdById: member.userId,
        },
      });
      defIds[`${d.entity}:${d.key}`] = created.id;
    }
    console.log(`Created ${defs.length} covenant definitions.`);

    // ── First covenant pass: every entity at its latest period ──────────
    // The runner recomputes CALCULATED observations (net_leverage,
    // interest_coverage) with full input lineage before testing — the
    // lineage dataset gets real edges from this.
    for (const name of ENTITIES) {
      const t = await runCovenantTests(ws.id, entityIds[name]);
      console.log(`${name}: tested=${t.tested} pass=${t.passed} fail=${t.failed} notTested=${t.notTested} near=${t.nearBreached}`);
    }

    // ── Delta: manual correction → revision + FAIL with previousStatus PASS ──
    // Push Q4 2026 TTM leverage above the step-down (3.5): net_debt edit.
    // TTM ebitda ≈ 480 → 1750/480 ≈ 3.6x > 3.5 (in force from Q3 2026).
    const deltaNew = 1750;
    const edited = await writeObservation({
      workspaceId: ws.id,
      entityId: entityIds['Delta Energy Partners'],
      entityName: 'Delta Energy Partners',
      metricKey: 'net_debt',
      label: 'Net debt',
      period: deltaQ4,
      value: deltaNew,
      unit: 'USD millions',
      derivation: 'REPORTED',
      confidence: 0.95,
      sourceExcerpt: `[demo seed] corrected net_debt, ${deltaQ4}: ${deltaNew} (USD millions) — revision case`,
      scale: { resolved: true, factor: 1, note: 'stated in USD millions' } as never,
      changedById: member.userId,
      reason: 'manual entry', // appends an ObservationRevision
      guard: 'allow',
      updateLabel: true,
      triggerRetest: true, // retest this one edit through the real path
    });
    if (edited.outcome === 'conflict') die('Unexpected conflict on Delta edit.');
    console.log('Delta Q4 2026 net_debt corrected (revision recorded, retest fired).');

    // One more revision: Northwind liquidity Q2 2025 restated.
    const nw = await writeObservation({
      workspaceId: ws.id,
      entityId: entityIds['Northwind Holdings'],
      entityName: 'Northwind Holdings',
      metricKey: 'liquidity',
      label: 'Liquidity',
      period: 'Q2 2025',
      value: liq(0, 1) + 5,
      unit: 'USD millions',
      derivation: 'REPORTED',
      confidence: 0.95,
      sourceExcerpt: '[demo seed] restated liquidity, Q2 2025 — revision case',
      changedById: member.userId,
      reason: 'manual entry',
      guard: 'allow',
      updateLabel: true,
      triggerRetest: false,
    });
    if (nw.outcome === 'conflict') die('Unexpected conflict on Northwind edit.');

    // ── Fjord: WAIVED — display-only cure context, set outside the runner ──
    // (The runner produces PASS/FAIL/NOT_TESTED only; waivers are human
    // decisions recorded as context, never auto-applied.)
    const fjordLiq = defIds['Fjord Shipping:min_liquidity'];
    const fjordResult = await prisma.covenantResult.findFirst({
      where: { definitionId: fjordLiq },
      orderBy: { period: 'desc' },
    });
    if (fjordResult) {
      await prisma.covenantResult.update({
        where: { id: fjordResult.id },
        data: { status: 'WAIVED', previousStatus: fjordResult.status },
      });
      await prisma.covenantDefinition.update({
        where: { id: fjordLiq },
        data: {
          cure: {
            events: [
              { period: fjordResult.period, note: 'Waiver letter dated 2026-11-01 accepted by agent', by: 'demo seed' },
            ],
          } as never,
        },
      });
      console.log(`Fjord min_liquidity ${fjordResult.period} set WAIVED (cure context recorded).`);
    }

    // ── Summary (counts only — no data, no secrets) ──────────────────
    const obsCount = await prisma.metricObservation.count({
      where: { entity: { workspaceId: ws.id, name: { in: ENTITIES } } },
    });
    const calcCount = await prisma.metricObservation.count({
      where: { entity: { workspaceId: ws.id, name: { in: ENTITIES } }, derivation: 'CALCULATED' },
    });
    const byStatus = await prisma.covenantResult.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: { definition: { workspaceId: ws.id, entity: { name: { in: ENTITIES } } } },
    });
    const revCount = await prisma.observationRevision.count({
      where: { observation: { entity: { workspaceId: ws.id, name: { in: ENTITIES } } } },
    });
    console.log('--- charts demo seed complete ---');
    console.log(`entities: ${ENTITIES.length}, observations: ${obsCount} (calculated: ${calcCount}), revisions: ${revCount}`);
    for (const g of byStatus) console.log(`covenant results ${g.status}: ${g._count._all}`);
    console.log('Expected: every status present (PASS, FAIL, NOT_TESTED, WAIVED), near-breach band on Cedar.');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
