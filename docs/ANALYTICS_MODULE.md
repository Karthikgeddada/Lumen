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
