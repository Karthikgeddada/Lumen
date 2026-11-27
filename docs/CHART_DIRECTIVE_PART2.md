# CHART DIRECTIVE, PART 2 (continuation of the chart-engine build)

Operating rules are unchanged from the directive already received: autonomous; log decisions in docs/DECISIONS.md; keep docs/PROGRESS.md and commit after each item; branch feat/chart-engine; CI (backend, frontend, pipelines) green before moving on; merge to main ONCE at the end; unfinished work goes behind a flag (default off) or stays unmerged and is listed in the final report; additive 14-digit migrations only; existing endpoint paths and JSON shapes never change; tenancy on every query, 404-not-403, Zod validation, audit logging, lineage, derivation labels; the TRUST RULE (an unresolved-flag figure never silently becomes verified, an observation, or a covenant PASS/FAIL; charts show such points flagged and exclude them from aggregates); free OSS only, no AWS, 512 MB API limit, no secrets, auth unchanged; no prod probing or test data in prod. Do not redo finished work: item 0 and the first part of item 1 are done.

## 1 (remainder). Finish the analytics module layering (move-only)
Current state: flat files in backend/src/analytics/ (overview, periods, ttm, formula, tests, index barrel). Target layers:
- analytics/core/ PURE (imports nothing from prisma, express, env, services, routes): periods, ttm, formula, validation rules if pure, later units and charts.
- analytics/services/ Prisma logic: overview, quality, dashboard analytics parts, later observations, charts-data.
- analytics/routes/: analytics.ts, quality.ts (later charts.ts), mounted through routes/mounts.ts with IDENTICAL prefixes and order.
Rules: git mv, import-only diffs, typecheck green after each step, no logic/SQL/signature changes; the route-table snapshot (83 routes) and all 192 tests must pass unchanged. routes/dashboard.ts stays and delegates its analytics parts to analytics/services/dashboard.ts with an identical JSON shape (add a structural/type test of the shape). validation* and covenants.ts stay in services/ (as logged); they import analytics only via analytics/core.
Add: a dependency-rule Vitest test (core imports nothing from prisma/express/services/routes; analytics/services never imports routes; covenants/extraction/scale/validation import analytics only via analytics/core; routes of one module never import another module's routes; outsiders use analytics/index or analytics/core); AGENTS.md at repo root; "Backend module conventions" in docs/ARCHITECTURE.md; docs/ANALYTICS_MODULE.md (old -> new paths, public exports, how to add a feature).

## 2. Unit and period layer (pure, tested)
- analytics/core/units.ts: parse free-text units ("USD millions", "USD billions", "%", "x", counts, "$ in 000") into {dimension: currency|percent|multiple|count|unknown, currency, scale}; normalize(value, unit) to a base value; a display unit/scale chooser. Unknown units are flagged "unit unresolved": excluded from cross-metric aggregation, shown flagged. No schema change; derived at read time.
- Period granularity detector: quarterly and annual series never share one time axis; ordering always via the ordinal helpers, never string sort; gaps stay gaps.
- Tests for every unit variant in the seed and extraction templates, unknowns, mixed scales, annual vs quarterly.

## 3. One observation write path + revision history
- analytics/services/observations.ts becomes the SINGLE writer of MetricObservation (manual endpoint, ingest-from-extraction, calculated metrics all route through it; behavior preserved: upsert semantics, overwrite guard, scale JSON, covenant retest trigger).
- Additive ObservationRevision (observationId, previous value, unit, derivation, scale, source doc/page/excerpt, changedBy, changedAt, reason) written on every change by that writer; bounded GET revisions endpoint per observation; never rewrite history. Tests.
<!-- end chunk 1 -->