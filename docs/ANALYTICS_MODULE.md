# The analytics module (backend/src/analytics/)

Layered module for everything metric/covenant/chartable. Move-only
restructure completed 2026-11-27 — no logic, SQL or signature changed; the
route table (83 paths) and response shapes are identical and test-pinned.

## Old → new paths

| Old (services/ + routes/ flat) | New |
| --- | --- |
| services/analytics.ts | analytics/services/overview.ts |
| services/periods.ts | analytics/core/periods.ts |
| services/ttm.ts | analytics/core/ttm.ts |
| services/formula.ts | analytics/core/formula.ts |
| services/trust.ts (pure trust/evaluation rules) | analytics/core/trust.ts |
| routes/analytics.ts | analytics/routes/analytics.ts |
| routes/quality.ts (inline logic) | analytics/routes/quality.ts (thin) + analytics/services/quality.ts (buildQuality) |
| routes/dashboard.ts (inline analytics) | routes/dashboard.ts (stays, composes) + analytics/services/dashboard.ts (buildDashboardAnalytics) |

`services/validation.ts`, `services/validationRun.ts`, `services/covenants.ts`
deliberately stay in `services/` (extraction-adjacent / AI + CRUD heavy); they
import analytics only via `analytics/core/` (enforced).

## Layers

- `core/` — pure: periods (parse/compare/ordinals), ttm (rolling-4Q,
  formula covenants), formula (sandboxed mathjs), trust (covenant
  evaluation, scale flags, overwrite-guard helpers). Imports nothing but
  itself + mathjs.
- `services/` — Prisma-backed: overview (entityOverview, ingestFromExtraction,
  dueReports/runReport), quality (buildQuality), dashboard
  (buildDashboardAnalytics). Later: observations writer, charts data.
- `routes/` — thin routers: analytics.ts (entities, overview, observations,
  reports), quality.ts. Mounted from routes/mounts.ts.
- `index.ts` — barrel re-exporting core + services.

## Public exports (what outsiders may import)

Via the barrel `../analytics` (or `./analytics` from src root):
entityOverview, ingestFromExtraction, dueReports, runReport,
buildQuality, buildDashboardAnalytics, plus everything from core
(parsePeriod, comparePeriods, previousQuarter, evaluateFormulaCovenant,
validateFormula, evaluateCovenant, scaleFlags, scaleUnresolved, …).
Via `../analytics/core/<module>` for direct core imports.

## How to add a feature to this module

1. Pure logic (parsing, math, rules) → new file in `core/` (+ unit test,
   no mocks needed — that's the point of core).
2. Data access → function in `services/` (Prisma), workspace-scoped,
   lineage + derivation on every figure; shape-pinning test with mocked
   prisma if it feeds the frontend.
3. Endpoint → router file in `routes/`, Zod-validate, requireAuth +
   requireWorkspace, 404-not-403; register it in `src/routes/mounts.ts`
   (add prefix+router in order) and extend `routes/routeTable.test.ts`
   expectations — `vitest run -u` updates the snapshot deliberately.
4. Outsiders import only the barrel or core;
   `analytics/dependencyRules.test.ts` fails CI otherwise.

## Units layer (core/units.ts) — chart engine item 2

Free-text units parse to `{dimension, currency, scale, label, unitUnresolved}`:
`USD millions/billions`, `%`, `x`, counts (`days`, `employees`, …), `$ in 000`,
`$m/usd bn`, EUR/GBP/CAD/CHF/JPY/INR. `normalizeValue()` folds scale words to
base currency units; `canAggregateUnits()` is the cross-metric gate (same
dimension + same named currency; scale words without a currency marker parse
with `currency: null` so they never mix with named currencies); anything
unrecognizable or dimension-conflicting (`USD %`) is **unit unresolved** —
flagged, never guessed, excluded from aggregation. `chooseDisplayUnit()` picks
friendly chart magnitudes. Period granularity (`core/periods.ts`):
`periodGranularity`, `splitByGranularity` (quarterly and annual never share a
time axis; ordinal ordering only), `quarterSequenceWithGaps` (a gap stays a
visible gap on the axis).

## Single observation writer (services/observations.ts) — chart engine item 3

`writeObservation()` is the SINGLE writer of `MetricObservation`. The manual
observations endpoint, ingest-from-extraction, and the calculated-metric
recompute inside covenant runs all route through it. It owns: upsert semantics
on `(entityId, metricKey, period)`; the overwrite guard (`guard: 'overwrite'`
refuses to replace a differing stored figure — ingest; `guard: 'allow'`
overwrites — manual/recompute); scale-JSON and field-by-field update semantics
(undefined = leave untouched, explicit null = clear, and labels are updated
only when `updateLabel: true` — manual only); and the fire-and-forget covenant
re-test (skipped per-write for bulk ingest, which batches one retest per
affected period).

Every update appends an `ObservationRevision` (additive model, migration
`20261127090000_observation_revisions`) capturing the PREVIOUS state (value,
unit, derivation, scale, source doc/page/excerpt, changedBy, reason) in the
same transaction — append-only, never rewritten. Read path:
`GET /api/analytics/observations/:observationId/revisions` (VIEWER,
workspace-scoped, 404-not-403, newest first, bounded take 100). Route table is
now 84 routes; the snapshot gained exactly that one line.
