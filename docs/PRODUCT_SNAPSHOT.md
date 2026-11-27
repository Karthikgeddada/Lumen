# Lumen Product Snapshot — for chart planning (2026-11-27)

Read-only survey. Every claim comes from code/config in this repo at main
`1818a01`, or from commands run locally, except items marked UNVERIFIED.
No secrets printed (env var names only).

## 1. Build state

Latest main: `1818a01` (ECharts merge, 2026-11-27). Single branch: `main`.

| Area | State | Evidence |
| --- | --- | --- |
| Observation write path | **LIVE** | POST /analytics/observations (upsert + auto covenant re-test); ingest from extraction (POST /extraction-tasks/:id/ingest-analytics, overwrite guard) |
| Validation rules | **LIVE** | services/validation.ts + validationRun.ts; per-workspace rules via GET/PUT /workspaces/:wid/validation; Settings UI |
| Formula engine | **LIVE** | services/formula.ts (mathjs, strict sandbox, AST walk); CovenantDefinition.formula/terms/schedule/cure/nearBreachPct; migration 20261126180000 |
| True TTM | **LIVE** | services/ttm.ts (rolling 4 quarters, gap → NOT_TESTED, stock/ratio period-end); periods.ts ordinal parser |
| Calculated metrics | **LIVE** | MetricObservation.derivation=CALCULATED, inputs JSON lineage; recompute-first on covenant runs |
| Chart engine | **LIVE (ECharts)** | echarts 6.1.0 in frontend; TrendOverview + metric cards + covenant donut (see §6) |
| Analytics restructure (backend/src/analytics/) | **NOT STARTED** | no such directory; analytics lives in routes/analytics.ts + services/analytics.ts |
| Revision history (ObservationRevision) | **NOT STARTED** | no model in schema.prisma; PROGRESS.md G6 unchecked |
| Package tracker | **NOT STARTED** | PROGRESS.md G5 unchecked; no tables |
| PDF table sidecar wiring | **PARTLY** | PARSE_SERVICE_URL escape hatch exists (in-process Python is the default); sidecar deployments none |
| Evidence viewer | **NOT STARTED** | document page has summary/text/tables tabs only; no bbox overlay/pdfjs viewer (PROGRESS.md E1–E6 unchecked) |
| Review queue upgrades | **NOT STARTED** | PROGRESS.md E5 unchecked |
| Compliance certificate reconciliation | **NOT STARTED** | PROGRESS.md F1–F3 unchecked |
| Explore page | **NOT STARTED** | no route in frontend/app/(app) |
| Exports | **PARTLY** | GET /extraction-tasks/:taskId/export exists (task results); no analytics/covenant export (H3 unchecked) |
| OCR | **NOT STARTED** | no OCR code; PDFs parse as text/tables via pdfplumber |

**CI status (VERIFIED via GitHub API):** latest run on main `1818a01` — backend ✅ (tsc + 190 Vitest), frontend ✅ (tsc), **pipelines ❌ (pytest step fails)**. Reproduced the exact CI steps locally in a clean target dir with the pinned requirements: **9/9 pytest pass**. Root cause UNVERIFIED — job logs require repo-admin auth. The ci.yml line is `pytest -qpipelines` (odd argument; harmless in local pytest 8.3.4 but nonstandard) — SUSPECTED.

## 2. Where analytics code lives today

No restructure happened; everything is in services/ + routes/.

| File | One line | Imported by |
| --- | --- | --- |
| routes/analytics.ts | entities CRUD, overview, observation write, reports | index.ts |
| services/analytics.ts | entityOverview(): series, quarters, delta/latest | routes/analytics.ts |
| services/covenants.ts | covenant CRUD/extract/test runs, TTM + formula + recompute | routes/covenants.ts, routes/quality.ts, analytics routes (re-test on write) |
| services/ttm.ts | rolling-4Q sums / period-end stocks, gap handling | covenants.ts |
| services/periods.ts | period parse/compare ("Q3 2026" or "2026" → ordinal) | ttm.ts, covenants.ts, analytics.ts |
| services/formula.ts | sandboxed mathjs evaluation, term extraction, validation | covenants.ts |
| services/validation.ts + validationRun.ts | post-extraction figure checks, rule config | routes/extraction.ts, extract.ts |
| routes/dashboard.ts + quality.ts | chartable aggregates (KPIs, board, provenance) | index.ts |

No shim files; no known cycles (typecheck clean).

## 3. Chartable data inventory (Prisma models)

| Model | Row = | Chart-relevant fields | Unique/index | Demo seed rows |
| --- | --- | --- | --- | --- |
| MetricObservation | 1 metric × 1 period × 1 entity | metricKey, label, period, periodStart?, value, unit, derivation (REPORTED/CALCULATED/AI_INFERRED), confidence? | `@@unique([entityId, metricKey, period])`, index `[entityId, metricKey]` | 16 (8 keys × mostly 4 quarters; see §5) |
| Entity | portfolio company | name | `@@unique([workspaceId, name])` | 1 (Halden Industrial Group) |
| CovenantDefinition | covenant rule per entity | key, label, metricKey, comparator, threshold, unit, period (quarter or ttm), formula?, terms?, schedule? (step-downs), cure?, nearBreachPct?, status | `@@unique([entityId, key])`, index workspaceId | 0 (none seeded) |
| CovenantResult | 1 covenant × 1 period test | period, value?, status (PASS/FAIL/NOT_TESTED/WAIVED), headroom? (signed), nearBreach?, previousStatus?, reason?, observationId?, computedAt | `@@unique([definitionId, period])`, index both | 0 |
| ExtractionResult | 1 field × 1 doc | value?, unit?, confidence, page?, cell? ("B7" or "p3 t1 r5 c2"), bbox? (JSON), excerpt?, scale? (JSON), status, flagged | `@@unique([taskId, fieldId, documentId])` | 0 (demo docs are structure-only, no extraction tasks) |
| ExtractionTask / Field | run + fields | status, documentIds, fields (key/label/type: text, number, currency, percent, date) | index `[workspaceId, status]` | 0 |
| Document | uploaded doc | fileType, pageCount, status, isDemo, tablesUnavailable | — | 4 (pdf, pdf, docx, xlsx) |
| DocumentTable / Row | tables for XLSX + PDF | header[], cells[] | — | 1 table / 3 rows (supplier scorecard) |
| Job | queued work | type (PROCESS_DOCUMENT, RUN_EXTRACTION, DRAFT_QUESTIONNAIRE, RUN_REPORT), status, attempts | — | 0 |
| QuestionAnswer | questionnaire answers | draftAnswer, confidence?, status | — | 12 (10 with confidence; 2 MISSING) |
| Report | snapshot/scheduled report | type, schedule?, lastRunAt?, content? | index workspaceId | 1 (quarterly, no content yet) |
| ObservationRevision | **does not exist** | — | — | — |
| Package tracker tables | **do not exist** | — | — | — |

**Lineage per MetricObservation point:** sourceDocumentId?, sourcePage?, sourceExcerpt?, scale? (JSON provenance), inputs? (CALCULATED lineage: key, metricKey, kind, periods, observationIds, value), extractionResultId?, confidence?, derivation. **No bbox/region on observations** — geometry lives on ExtractionResult (bbox/cell) and DocumentChunk (regions); not yet linked through to observations (UNVERIFIED whether chunk regions are populated for observations ingested from extraction — code path exists in extract.ts; demo seed has none).

## 4. API shapes the frontend consumes

All under `/api`, requireAuth + requireWorkspace role. Unpaginated unless noted.

| METHOD path | Role | Query | Returns (trimmed) |
| --- | --- | --- | --- |
| GET /workspaces/:wid/analytics/entities | VIEWER | — | `{ entities: [{ id, name, _count: { observations, reports } }] }` |
| GET /workspaces/:wid/analytics/overview | VIEWER | entityId, quarters (4|8, default 4) | `{ overview: { metrics: [{ key, label, unit, series: [{ period, value, derivation, sourceExcerpt, sourcePage }], delta, latest }], quarters: [] } }` |
| POST /workspaces/:wid/analytics/observations | EDITOR | — | upserts; regex `^(Q[1-4]\s?\d{4}|\d{4})$`; re-tests covenants fire-and-forget |
| GET /workspaces/:wid/analytics/reports | VIEWER | — | take: 50, newest first |
| GET /workspaces/:wid/covenants | VIEWER | — | definitions incl. `results` array (newest first) — no limit (all results per definition) |
| POST /workspaces/:wid/covenants/test | EDITOR | — | runs tests for entity/period |
| GET /workspaces/:wid/dashboard | VIEWER | — | `{ dashboard: { kpis, covenants[6], portfolio, recentDocuments, activeProcessing, recentActivity, recentConversations } }` — covenants list is truncated to 6 in the route |
| GET /workspaces/:wid/quality | VIEWER | — | `{ quality: { extraction: { verified, review, missing, flagged, confidenceSum… }, answers[], covenants[], observations[] (groupBy derivation), documents[] (per-doc counts), citations } }` — full-table scans, workspace-scoped |
| GET /workspaces/:wid/extractions | VIEWER | — | tasks take: 100 (paginated by cap, no offset) |
| GET /workspaces/:wid/documents | VIEWER | q, collectionId, status, sort, page/limit | **paginated**: default limit 25, max 100; doc detail includes sections take 4000, table rows take 200 |

Example overview series point: `{ "period": "Q3 2026", "value": 4.82, "derivation": "REPORTED", "sourcePage": 1 }`.

## 5. Metrics and periods

**Demo seed metric keys** (unit): revenue (USD billions), operating_margin (%), free_cash_flow (USD millions), net_debt (USD billions), segment:industrial_automation / grid_components / fluid_systems / building_controls (USD billions, Q3 2026 only).

**Built-in extraction templates** (fields with types): Credit agreement (facility_amount: currency, interest_rate: percent, leverage_covenant: percent, …), Supplier scorecard KPIs (on_time_delivery: percent, defect_rate: number, annual_spend: currency, …), Covenant tests (leverage_ratio, interest_coverage, net_debt_ebitda: number; min_liquidity: currency).

* Periods: string column, `"Q3 2026"` or `"2026"`; normalized to single space on write. Ordering via periods.ts ordinals (year×4 + quarter) — sorts correctly, but is only applied where code uses comparePeriods (analytics overview orders by it; raw DB sorts elsewhere).
* TTM: covenants with period="ttm" sum 4 consecutive quarters — gaps → NOT_TESTED with reason; stocks/ratios use period-end. Flow-vs-stock kind comes from terms JSON.
* Known gaps: segment:* metrics have 1 quarter (no trend); annual "2026" periods mix with quarters in the same column (periodStart mostly null — no migration backfill); units are free-text ("USD millions" vs "USD billions" — no scale normalization across metrics).

**Derivation/confidence/scale to frontend:** analytics overview exposes per-point derivation (+ sourcePage/sourceExcerpt); DerivationBadge on cards, AI_INFERRED bars faded to 55% opacity + tooltip tag; extraction review shows confidence %, scale badge (`×1000 · from …`), nonScalable reason, flagged state; quality page groups observations by derivation. Covenant NOT_TESTED carries `reason` (e.g. unresolved scale flags).

## 6. Current frontend

Next 14.2.13 · React 18.3.1 · TypeScript ^5.5.4 · SWR 2.2.5 · lucide-react icons · **echarts 6.1.0** (only chart lib; no TanStack Table, no react-window, no pdfjs-dist — VERIFIED package.json).

Styling: single globals.css, CSS variables, no CSS framework; no dark mode (light theme only). Tokens: surfaces `--bg #fbfaf8`, `--surface #fff`, `--sunken #f5f4f1`, `--sidebar #f6f5f2`; text `--text-primary #1d1d1f`, `--text-secondary #48484d`, `--text-muted #6e6e73`; lines `--border #e8e6e1`, `--border-strong #d6d3cc`; primary `--blue #0071e3` family; status `--success #17703b`, `--warning #935000`, `--error #bf3326`, `--graphite #3a3a3f`; radii 8/12/16/22px; fonts: system SF stack + `--font-mono` SF Mono/Menlo.

Pages (routes): `/dashboard`, `/library`, `/documents/[id]`, `/extraction`, `/questionnaires`, `/questionnaires/[id]`, `/covenants`, `/analytics`, `/quality`, `/assistant`, `/settings`, `/team`, plus auth/onboarding outside (app).

SWR keys: dashboard `` `/api/workspaces/${wid}/dashboard` ``; analytics `ent-${wid}`, `ov-${entityId}-${quarters}`, `rep-${wid}`; quality/`extraction` similar per page (keys mirror prefetch.ts exactly — hover-prefetch module pre-populates dashboard/library/etc. first-paint data). No URL-synced filter state today (PROGRESS G9 unchecked); filters are local useState.

**Chart components today:**

| File | Draws | Notes |
| --- | --- | --- |
| components/EChart.tsx | wrapper | tree-shaken echarts core (line/bar/pie, grid/tooltip/legend/dataZoom/markLine, canvas); SSR-safe (init in effect), auto-resize, dispose on unmount; exports CHART palette + baseAxis() |
| analytics/page.tsx TrendOverview | indexed multi-line (first quarter = 100) | legend toggle, inside+slider dataZoom, tooltip shows real values + units + AI-inferred tag; height 280 |
| analytics/page.tsx MetricCard | per-metric bar chart | latest emphasized, AI_INFERRED 55% opacity, tooltip = period/value/unit/derivation/source page; height 140 |
| dashboard/page.tsx CovenantDonut | pass/breach/not-tested/waived donut | counts all covenants; colors match status semantics |

Shared UI (components/ui.tsx): Card/card-header/card-title/card-sub, table, badge (+badge-success/error/blue/warning), Modal, Field, LoadingBlock, EmptyState, skeletons, Avatar, DocStatusBadge, DerivationBadge, DemoTag, timeAgo/formatDate/formatBytes. **No shared number/currency formatter** — pages inline `toFixed`/`toLocaleString`/M-math (e.g. dashboard headroom does its own `x/1_000_000` format).

Layout: **Dashboard** = KPI row (documents, extractions, covenants, breaches, open reviews, pages) → grid 1.55fr/1fr: covenant status card (donut + 6-row board w/ headroom + previousStatus) + processing-now + recent documents ‖ right column (activity feed, conversations). **Analytics** = entity selector chips + 4Q/8Q tabs → TrendOverview card → metric cards (grid-2) → reports table. **Covenants** = list cards w/ latest result + last 4 result chips, formula display, cure modal, extract-from-doc flow. **Quality** = extraction pipeline status/counts → metric provenance (derivation mix) → diligence answers → covenant review coverage → grounding per document.

## 7. Evidence and lineage in the UI

No evidence viewer exists (PROGRESS E1–E6 open). Today a data point links to source via: analytics tooltip (sourcePage + excerpt text), observation sourceDocumentId → document page (tabs: summary / text sections / tables). Extraction results carry page/cell/bbox/excerpt/scale, shown as text in the review queue ("p.3 · B7"), with `tablesUnavailable` honestly badged when PDF parsed without table support. Missing source → fields are null → UI shows "—" / omits; never fakes.

## 8. Performance and limits

* API caps: pagination default 25 / max 100 (library); extractions take 100; reports take 50; document detail sections take 4000, rows take 200; overview limited to quarters=4|8 (validated). Covenants list and quality endpoints are unbounded workspace scans (fine at demo scale, risk at scale).
* Uploads: MAX_UPLOAD_MB env (default 500), 20 files per batch.
* Hosting: render.yaml `plan: free` (512 MB, single service lumen-api, in-process Python venv; frontend on Vercel — UNVERIFIED which Vercel plan). Cold starts expected on both free tiers.
* Bundle (measured `next build` locally, main): `/analytics` 323 kB first-load incl. ECharts, `/dashboard` 331 kB, shared-by-all 87.2 kB. ECharts is tree-shaken to bar/line/pie.
* No Lighthouse data available locally — UNVERIFIED.

## 9. Test setup

* Backend Vitest: 8 files in backend/src/services (formula, periods, pipelineClient, scale, trust, ttm, validation, normalizer) — **190 tests**, run via `npm test` in backend; `npm run typecheck` separate.
* Python Pytest: backend/python-pipelines/tests/test_parse.py — **9 tests** (in-memory synthetic fixtures), pass locally with pinned requirements.
* No frontend unit tests (typecheck only in CI). No route-table snapshot test, no dependency-rule test (verified by absence).
* CI (.github/workflows/ci.yml): 3 jobs — backend (npm ci → prisma generate → typecheck → npm test), frontend (npm ci → tsc), pipelines (pip install → pytest). Backend + frontend green on main; pipelines red (see §1).

## 10. Risks and open questions (ranked)

1. **CI pipelines job failing on main** — VERIFIED failing; root cause UNVERIFIED (logs need admin auth; local clean-room repro of exact CI steps = 9/9 pass). Blocks trust in every future merge.
2. **Free-text units with no scale normalization** ("USD millions" vs "USD billions" vs "x" vs "%") — VERIFIED in seed + schema. Any cross-metric aggregation or dual-axis chart needs a unit/scale resolver first; the indexing trick in TrendOverview sidesteps but hides magnitude.
3. **Unbounded queries behind chart endpoints** — covenants list returns all results per definition; quality endpoint scans all extraction results + documents with no take — VERIFIED. A chart engine hitting these repeatedly at scale will hurt (512 MB free tier).
4. **Mixed period granularity** ("Q3 2026" and "2026" in one string column; periodStart null on seed rows) — VERIFIED. Sorting is only safe through comparePeriods; chart time-axes should compute from ordinals, not string sort.
5. **No ObservationRevision** — VERIFIED absent; chart planning that assumes history/undo of numbers has nothing to read yet.
6. **Single-entity, 16-observation demo dataset** — VERIFIED from seed; every chart UX (legends, zoom, multi-entity compare) will look empty on demo data; needs richer seed before UX work.
7. **Lineage stops before geometry** — observations carry page/excerpt but not bbox/cell; ExtractionResult has the geometry but no link from observation → result bbox (extractionResultId exists — VERIFIED column — but demo/ingest path populating it is UNVERIFIED for older rows).
8. **SUSPECTED: period regex allows "Q3 2026" and "2026" but writes normalize only spaces** — no guard against quarterly metric on annual period (e.g. ttm over "2026" rows) beyond TTM gap logic; ttm handles it (NOT_TESTED) — VERIFIED via ttm.ts tests.

**Unanswered questions:** CI pipelines failure root cause (needs job logs: GitHub UI → Actions → failing run); whether production has data beyond demo (needs a read-only prod query — not done, out of scope); Vercel plan/limits (UNVERIFIED).

---

**The five lines:**
1. Lumen can chart today: per-entity quarterly metric trends (4/8Q) with honest derivation styling, covenant status distribution, and indexed cross-metric trajectories — all through one ECharts wrapper with data zoom.
2. It cannot chart yet: multi-entity portfolio views, covenant headroom history vs thresholds, TTM trend series, revision timelines, and package-tracking — data models or endpoints for those don't exist or return nothing (0 covenant rows seeded).
3. Biggest obstacle 1: units are free text with no scale normalization — cross-metric and portfolio charts need a unit/scale layer before any aggregation.
4. Biggest obstacle 2: chart-feeding endpoints are unbounded and demo data is 16 rows — richer seed + capped/aggregated endpoints are prerequisites for meaningful chart UX.
5. Biggest obstacle 3: red CI pipelines job — fix first so every chart-engine change is actually verified by the suite.
