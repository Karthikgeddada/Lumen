# Lumen — System Architecture

AI-native data room for private credit: document understanding, grounded AI answers, extraction, diligence questionnaires, portfolio analytics, and covenant monitoring.

Every claim below is backed by source files in this repo (verified 2026-11-25). Where a feature is partial, the doc says so.

---

## 1. Runtime Topology

| Tier | Host | What runs there |
| --- | --- | --- |
| Frontend | Vercel (Next.js App Router) | 9 app pages + auth pages; calls API via `NEXT_PUBLIC_API_URL` (`same-origin` mode supported) |
| API | Render web service (`backend/src/index.ts`) | Express REST API, 13 routers, auth + tenancy middleware |
| Worker | Same Render service, supervised by `scripts/start-all.js` (`backend/src/worker.ts`) | Claims jobs from the Postgres queue; runs parsing, embeddings, summaries, extraction, questionnaires |
| Database | Neon Postgres (serverless driver not used — Prisma 5) | System of record: 36 models incl. the `Job` table |
| Object storage | Postgres (`StoredObject`) today; S3-compatible (Supabase Storage) when `STORAGE_*` env vars set | Original uploaded files; lazy migration DB→S3 on first read (`services/storage.ts`) |
| LLM | OpenRouter-compatible chat API (`config.ai.chatModel`, default `gpt-4o-mini`) | Summaries, extraction, questionnaire drafting, assistant answers, covenant extraction |
| Embeddings | Local ONNX via `@huggingface/transformers` (`Xenova/all-MiniLM-L6-v2`, 384-dim) with remote fallback (`AI_EMBEDDING_MODEL`, default `text-embedding-3-small`) | Chunk embeddings |

Keep-alive: free tiers sleep on inactivity; external uptime pings hit `/api/health` (Render) and the Supabase storage URL.

---

## 2. Job Queue & Worker

**Mechanism:** Postgres-backed queue (`services/queue.ts`) — `Job` rows claimed with `SELECT … FOR UPDATE SKIP LOCKED`; safe with N workers. No Redis.

**Job types** (`JobType`):
- `PROCESS_DOCUMENT` — full ingestion pipeline
- `RUN_EXTRACTION` — template-based extraction
- `DRAFT_QUESTIONNAIRE` — AI questionnaire drafting
- `RUN_REPORT` — report generation

Retry: `maxAttempts` (default 3), `runAt` supports delayed execution. Worker (`worker.ts`) polls and dispatches per type.

---

## 3. Document Ingestion Pipeline (`services/processing.ts`)

Run by the worker on `PROCESS_DOCUMENT`:

1. Fetch original file from object storage → temp file
2. Parse per format (`services/parsers.ts`): `pdf-parse` (page-split on form-feed; **PDF tables are not detected** — stay as text), `mammoth` (DOCX → HTML; page = null), `xlsx` (sheets → tables), CSV, legacy `.doc` best-effort
3. Persist: `DocumentSection`, `DocumentTable` + `DocumentTableRow`, `DocumentChunk` (source-linked: page / sheet / headingPath)
4. Embed chunks in batches (optional — keyword retrieval works without)
5. Grounded AI summary: `DocumentSummary` with key facts + figures
6. Final status: `COMPLETED` / `NEEDS_REVIEW` (e.g. scanned PDFs with no text — honest, not pretended) / `FAILED`

A document is never `COMPLETED` unless content and chunks exist. Upload stores the file (`storageKey = workspaces/<wid>/documents/<docId>/original.<ext>`) and enqueues; the API stays fast.

---

## 4. Feature Architecture (one per sidebar item)

### 4.1 Dashboard — `/(app)/dashboard` ↔ `routes/dashboard.ts`
Command center. KPIs (covenants tracked, breaches red, open reviews, pages understood), covenant status board (latest result per covenant, FAIL-first, needs-review flags), processing-now, recent documents/conversations/activity. All from live workspace queries; fresh workspaces get honest zeros.

### 4.2 Data Room — `/(app)/library` + `/(app)/documents/[id]` ↔ `routes/documents.ts`, `routes/collections.ts`
Upload (PDF/DOCX/DOC/XLSX/CSV), collections, document detail: sections, tables, grounded summary (key facts, key figures with units + page refs), citations stats. File download via presigned URL (S3 mode) or HMAC-signed streaming endpoint (DB mode) — same trust model, expiring links.

### 4.3 AI Assistant — `/(app)/assistant` ↔ `routes/conversations.ts`, `services/rag.ts`
RAG over the workspace corpus: retrieve (hybrid score = keyword + 6× cosine of query/chunk embeddings; per-document scoping) → `buildContext` renders numbered blocks → chat model answers; **citations [n] map 1:1 to retrieved chunks** and are persisted (`Citation`). `ANTI_INJECTION_RULES` guard the prompt. Conversations + messages persisted per user.

### 4.4 Data Extraction — `/(app)/extraction` ↔ `routes/extraction.ts`, `services/extract.ts`
Templates (`ExtractionTemplate` → `ExtractionField`), tasks run on the worker (`RUN_EXTRACTION`), results per field with provenance → `NEEDS_REVIEW` → human verify. Verified values are the trusted path into analytics.

### 4.5 Diligence Questionnaires — `/(app)/questionnaires[/:id]` ↔ `routes/questionnaires.ts`, `services/questionnaire.ts`
`DRAFT_QUESTIONNAIRE` worker job drafts questions from documents; answers carry evidence (`AnswerEvidence`); review flow `NEEDS_REVIEW → approved`.

### 4.6 Portfolio Analytics — `/(app)/analytics` ↔ `routes/analytics.ts`, `services/analytics.ts`
`Entity` (portfolio companies) + `MetricObservation` (per metric per quarter; derivation `REPORTED`/`CALCULATED`, confidence, source page). Overview endpoint returns metric series for charting; per-quarter filters.

### 4.7 Covenants — `/(app)/covenants` ↔ `routes/covenants.ts`, `services/covenants.ts`
Definitions (`CovenantDefinition`: comparator LTE/GTE, threshold, unit, metricKey, status `AI_INFERRED → REVIEWED`, source excerpt + page + confidence) linked to `Entity`. AI extraction: RAG retrieval over the credit agreement (covenant-targeted query) → structured JSON extraction → stored with excerpt/page. Tests (`CovenantResult`: per period, `PASS`/`FAIL`/`NOT_TESTED`/`WAIVED`, value, headroom) run on demand per entity+period; breaches create `Notification` (kind `covenant.breach`). Review flow for AI-proposed definitions.

### 4.8 Data Quality — `/(app)/quality` ↔ `routes/quality.ts`
Workspace-level + per-document KPIs: extraction verification %, avg confidence, open reviews, provenance/citation stats, covenant status split (`AI_INFERRED`/`REVIEWED`), derivation split (`REPORTED`/`CALCULATED`).

### 4.9 Workspaces & Team — `/(app)/team` ↔ `routes/workspaces.ts`, `routes/notifications.ts`
Multi-tenant: `Workspace` + `Membership` (roles VIEWER < REVIEWER < EDITOR < ADMIN < OWNER), invitations, notifications (incl. breach alerts), `AuditEvent` trail.

### 4.10 Settings — `/(app)/settings`
Profile + workspace settings (`WorkspaceSetting`).

---

## 5. Tenancy & Auth (`middleware/auth.ts`)

1. **Authentication:** bcrypt password → `Session` row → short-lived JWT access token (`AUTH_SECRET`-signed, `sub`+`sid`) + opaque refresh token (hash-stored). `requireAuth` verifies token AND live session (logout revokes everywhere).
2. **Tenancy:** every data row carries `workspaceId`. `requireWorkspace(minRole)` resolves the workspace from path/body/query, checks `Membership`, returns **404 (not 403)** for non-members (no existence leak). All queries filter `workspaceId: req.ws.id`.
3. **Nested resources:** `assertDocAccess` resolves the owning workspace from the record and re-checks membership.

## 6. Storage Detail (`services/storage.ts`)

Mode is config-driven: S3 when `STORAGE_DRIVER=s3` or `STORAGE_BUCKET`+`STORAGE_ACCESS_KEY` set; else Postgres `StoredObject` (BYTEA). Same `putObject/getObject/deleteObject/presignedDownloadUrl` interface either way. S3 client is generic (AWS/R2/Supabase/MinIO; `forcePathStyle` for non-AWS endpoints). **Lazy migration:** in S3 mode, a missing key falls back to Postgres, serves the bytes, and copies to S3 in the background — zero-downtime switch. `deleteObject` clears both copies.

Supabase Storage (current S3 target): bucket `lumen-documents`, region `ap-northeast-2`, S3 access keys. Free tier pauses after 1 week without requests → covered by the Supabase keep-alive ping.

## 7. Environment Surface (config.ts)

- `DATABASE_URL`, `AUTH_SECRET`, `ACCESS_TOKEN_TTL_SEC`
- `AI_CHAT_MODEL` (default gpt-4o-mini), `AI_EMBEDDING_MODEL` (default text-embedding-3-small), OpenRouter-compatible base URL/key
- `STORAGE_DRIVER/ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY`
- `NEXT_PUBLIC_API_URL` (frontend; `same-origin` supported)

## 8. Known Gaps (honest list)

- PDF tables are **not** detected by `pdf-parse` — they stay paragraph text (noted in parsers.ts)
- Scanned/image-only PDFs land in `NEEDS_REVIEW` (no OCR yet)
- `RUN_REPORT` job type exists; the Reports surface (`Report` model) is minimal
- Keep-alive pings and Supabase S3 env vars are ops tasks, not code
- Phase 0 trust items: key rotation, private AI path, always-on backend (ping workaround active)
- Column-level scale detection is header-text-only (a scale buried mid-table in prose may be missed — such figures get the conservative missing-scale flag); per-share exemption is by unit/value shape, not semantic

## 9. Unit-Scale Detection (services/scale.ts + scaleEnrich.ts, 2026-11-26)

**Flow:** extraction completes → `enrichResultsWithScale(taskId)` loads each document's tables (title/header/page/sheet) and page texts → detects declared scales ("in thousands", "$ millions", "000s", "$ in 000", billions/trillions, currency-prefixed forms; anchored patterns never match plain numbers) at table, page, and document level → `decideScale` resolves **one** scale per figure by precedence — value's own suffix > extractor unit > table header > page header > document header; never stacked → provenance (multiplier, label, where found, header text, page/sheet/tableId) stored as `scale` JSONB on the extraction result, with `flagged` + `note` for conflicts and missing scale on currency figures → at analytics ingest the reviewed scale is applied exactly once and carried onto the metric observation.

**Exemptions:** ratios, multiples (4.5x), percentages, and per-share figures are never scaled ("in thousands, except per share data" handled by unit/value shape).

**Guarantees:** enrichment is best-effort (never fails an extraction); scale.ts is pure (no DB/env imports) so its tests run anywhere; conflicts and absences flag for review instead of guessing.

## 10. Tests & CI (2026-11-26)

- `npm test` (backend) runs Vitest: `src/services/normalizer.test.ts` (25 canonical parse cases via `it.each`), `src/services/scale.test.ts` (12 mandated scale cases — thousands/millions/billions/"000s"/"$ in 000"/mixed/per-share exception/double-scaling guard/missing scale/conflicting scales/unit-vs-table precedence/ratio exemption — plus pattern and detailed-parse checks, and Item 0.5 cases: header-only "in thousands" with no unit, unit-vs-header conflict flagged, unit-header agreement clean), and `src/services/trust.test.ts` (25 trust-rule cases: scale-resolution, verification gate, ingest refusal, covenant NOT_TESTED-with-reason; plus Item 0.5 suites: sameNumber/ingestConflict overwrite guard and isFreshBreach freshness).
- `npm run typecheck` (backend) and `npx tsc --noEmit` (frontend) gate both apps.
- GitHub Actions (`.github/workflows/ci.yml`) runs backend `npm ci → prisma generate → typecheck → test` and frontend `npm ci → tsc --noEmit` on every push (main AND feature branches — nothing merges to main without a green branch run) and every pull request (free tier).

## 11. Item 0.5 hygiene (2026-11-26)

- **Ingest overwrite guard** — `ingestFromExtraction` reads the existing observation for (entity, metric, period) before writing: a different value is skipped and returned as a structured conflict (`conflicts[]` in the ingest response); the same value refreshes metadata and now sets `derivation: AI_INFERRED` on update (previously update left a stale REPORTED label on extraction-refreshed figures). Pure comparison logic `sameNumber` (one part in a billion) in `services/trust.ts`.
- **Covenant `previousStatus`** — each re-evaluation stores what the result was before the run (`20261126093000_covenant_result_previous_status`, additive); fresh-breach alerting uses `isFreshBreach` so FAIL → NOT_TESTED → FAIL does not re-alert a known breach. Shown in the Covenants UI as "· was pass/breach".
- **Unit-vs-header scale conflicts** — `decideScale` flags a unit that disagrees with a table/page/document header (unit still wins by precedence); the flag routes the figure into the trust-rule resolution gate before verification/ingest.
- **ADMIN entity deletion** — `DELETE /:workspaceId/analytics/entities/:entityId` (audit-logged `entity.deleted`) removes entity + observations + covenant definitions/results, unlinks (not deletes) scheduled reports — used for cleaning up test entities.
- **Deploy URLs** — the live API is `lumen-api-ctpy.onrender.com` (Render subdomain `lumen-api` was taken by an unrelated service); DEPLOYMENT.md now carries the real URL.

## 12. Trust rule enforcement (services/trust.ts, 2026-11-26)

A figure with unresolved unit-scale flags can never silently flow into a covenant test. Enforcement points, all sharing the pure `scaleUnresolved` / `applyScaleResolution` / `evaluateCovenant` logic in `services/trust.ts`:

- **Review gate** — `PATCH /api/extraction-results/:id` returns 422 `UNRESOLVED_SCALE` if `status: "VERIFIED"` is attempted on a result whose scale JSON has unresolved flags without an explicit `scaleResolution` (confirm-as-shown, or a supplied multiplier). The resolution (who/when/multiplier) is persisted inside the scale JSON and audited as `extraction.scale_resolved`.
- **Ingest gate** — `ingestFromExtraction` refuses VERIFIED-but-unresolved results (they never become `MetricObservation` rows); its response reports `refused` counts. Ingested observations carry the full scale JSON (flags + resolution) with `unresolved: false`.
- **Covenant gate** — `runCovenantTests` evaluates via `evaluateCovenant`: an observation with unresolved scale flags yields `NOT_TESTED` with a human-readable `reason` (nullable `reason` column on `CovenantResult`, migration `20261126160000_covenant_result_reason`); a re-run may legitimately flip a previously-tested covenant to `NOT_TESTED` when its figure is unresolved — existing PASS/FAIL rows are never rewritten silently, only re-evaluated.
- **Legacy rows** — observations ingested before the resolution era (flags, no `resolution`) count as unresolved and are protected at covenant-test time.

**AI call hygiene (2026-11-26):** every AI provider HTTP call (chat, chat-stream connect, embeddings) is aborted after `AI_TIMEOUT_MS` (default 60 s) with a clear error; a hung upstream can no longer pin a worker job. Known limit: once an SSE chat stream has started, token reads are not capped.

**Migration naming (adopted 2026-11-26):** every new migration folder uses a full 14-digit UTC timestamp prefix (`YYYYMMDDHHMMSS_name`, e.g. `20261126160000_covenant_result_reason`), SQL-only, additive columns/tables only, safe to auto-apply via `prisma migrate deploy` on Render boot.

## 11. Backend module conventions (analytics layering, 2026-11-27)

The backend is organized into modules. `src/analytics/` is the first fully
layered module and the template for others (see docs/ANALYTICS_MODULE.md for
the full map):

- `analytics/core/` — PURE logic: periods, TTM, formula (mathjs), trust rules.
  No imports of prisma, express, env/config, logger, middleware, utils,
  services or routes; no upward (`..`) imports. Importable by anyone.
- `analytics/services/` — Prisma-backed analytics: overview, quality,
  dashboard analytics parts (later: observations, charts data). Never imports
  routes. Outsiders reach these through the barrel, never directly.
- `analytics/routes/` — the module's Express routers (analytics, quality),
  mounted by `routes/mounts.ts` (the single mount table `index.ts` applies;
  `routes/routeTable.test.ts` snapshots all 83 `METHOD /api/...` paths).
- `analytics/index.ts` — the barrel; outsiders (routes/, services/, worker)
  import analytics only via this barrel or `analytics/core/`.

`src/dependencyRules` enforcement is real, not convention:
`analytics/dependencyRules.test.ts` statically scans every non-test source
file and fails CI on any layering violation. Still flat/legacy: `services/`
(extraction, covenants, validation, scale, rag, ai …) — those import analytics
only via `analytics/core`, enforced by the same test. When another module
(e.g. documents, questionnaires) gets layered, copy this pattern:
core (pure) → services (Prisma) → routes (thin), plus mount table entry and
dependency-rule tests.
