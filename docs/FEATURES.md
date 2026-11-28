# Lumen — Founder's Feature Guide

Plain-language spec for every feature in the sidebar: what it is, what it can do today, how it works inside, and what's missing. Written for the founder, grounded in the actual code (paired with docs/ARCHITECTURE.md for the technical detail). Verified against source 2026-11-25.

---

## The one-paragraph story

You upload documents (credit agreements, earnings releases, spreadsheets). Lumen reads them — pages, headings, tables, footnotes — and makes them searchable and quotable. You ask questions and get answers with page-level citations. You define extraction templates and pull structured numbers into review queues. Approved numbers feed portfolio analytics (per company, per quarter). You define covenant tests against those numbers; Lumen runs them every quarter and tells you when a borrower breaches. A quality page shows you how trustworthy every number is — reported vs calculated vs AI-inferred, with confidence and sources.

---

## 1. Dashboard

**What it is:** the landing screen — the state of the whole workspace in one glance.

**What it can do today:**
- KPIs: covenants tracked, breaches (red when any), open reviews, pages understood
- Covenant status board: every covenant with its latest result (value vs threshold, headroom, review flag) — breaches sorted to the top
- "Processing now" — documents being read live (refreshes every 15s)
- Recent documents, recent AI conversations, workspace activity feed

**Internally:** one API call aggregating live counts + latest covenant results. No cached numbers; a fresh workspace shows honest zeros.

**Status: LIVE.**

## 2. Data Room

**What it is:** the document library — upload, organize, and read documents with Lumen's understanding attached.

**What it can do today:**
- Upload PDF, DOC, DOCX, XLSX, CSV (or drag-drop; up to 20 files at once); organize into collections
- **Nested folders** — folders inside folders ("Credit Agreements / 2026"), create-inside, move documents between folders per row, cycle-safe reorganization; deleting a folder destroys nothing (documents and subfolders move to the top level)
- Processing status per document (queued → reading → done / needs review / failed)
- Document detail view: section outline, extracted tables (with rows), AI summary with **key facts** and **key figures** (each grounded with unit + page reference)
- Download the original file via an expiring signed link
- Demo-tagged sample documents

**Internally (the ingestion pipeline):** file bytes stored safely (database or S3-compatible storage) → background worker parses per format — **via the in-process Python parsers by default** (pdfplumber for PDFs **including table reconstruction**, python-docx for Word body order, openpyxl for Excel values + formulas, spawned from the same service — zero configuration; falls back to the JS parsers — pdf-parse / mammoth / SheetJS — automatically if Python is missing, times out, or returns anything malformed) → chunks with heading/page/sheet labels → embedded locally (open-source MiniLM model, runs on our server, no data leaves) → AI summary generated from the chunks → status set honestly (scanned/image PDFs land in "needs review", not pretended-done).

**Gaps:** scanned PDFs need OCR (not built); questionnaires page cannot yet pick data-room documents; feature pages cannot upload fresh docs inline (pick-only).

**Status: LIVE** — nested folders shipped and verified 2026-11-25 (gaps noted).

## 3. AI Assistant

**What it is:** ask questions about your documents; get answers you can verify.

**What it can do today:**
- Chat grounded in your workspace documents
- Every claim carries **[n] citations** → exact page or spreadsheet sheet → click through to the source
- **Scope control, honestly enforced**: answer from everything, a whole folder (collection), one document, or **several documents you pick** — the scope is stored on the conversation, shown in the composer, and changing it mid-conversation applies immediately
- Conversation history per user; streaming responses
- Refuses to answer from thin air — only cites retrieved chunks; prompt-injection guardrails active; when phrasing doesn't keyword-match, retrieval falls back to the scoped documents' real text instead of a false "no evidence"

**Internally:** your question → hybrid search (keyword scoring + local embedding similarity, blended) over chunks from the documents in scope → top chunks rendered into the prompt with citation numbers → LLM answers → answer + citations stored.

**Gaps:** needs the backend awake — when the free host sleeps, you see "failed to fetch" (root cause: cold start, not the feature; fixed by the keep-alive ping / paid tier). Seeded demo documents carry no embeddings, so demo semantic matching relies on the fallback path.

**Status: LIVE** — scope + fallback fixes shipped and prod-verified 2026-11-25.

## 4. Data Extraction

**What it is:** turn unstructured documents into structured, reviewable data points.

**What it can do today:**
- Templates: define fields once (key, label, type, description — up to 40) and reuse
- Run an extraction across up to 20 documents at once (background job)
- Every result shows: value, confidence score, page/sheet/cell, exact source excerpt
- Review flow: verify / correct the value / reject / mark missing — nothing enters analytics unreviewed
- AI "suggest fields" from a document; add custom fields on the fly
- Export to CSV/Excel
- **Send verified values to Analytics** — one click creates/updates the portfolio entity and quarterly observations (marked AI-inferred, with source + confidence carried over)

**Internally:** task created → worker job → per document × field, the LLM reads retrieved chunks and returns a structured value + provenance → results stored for review. Verified results are upserted into analytics keyed by entity + metric + period (period parsed from the document name). **Value normalization:** raw strings like "$4.82 billion", "4,820 million", "(1,234)" (US and EU number formats, accounting negatives, spelled-out and abbreviated multipliers) are converted to true numbers on ingest — 25-case test suite against the shipped module.

**Gaps:** OCR for scanned documents. PDF table extraction now shipped (see 4b) alongside unit-scale detection (4a).

### 4a. Unit-scale detection (2026-11-26)

**What it is:** financial statements declare their scale in headers ("in thousands", "$ millions", "000s", "$ in 000"). The extractor is told this scale and applies it exactly once per figure, with provenance stored and ambiguity flagged — never guessed silently.

**How it works (one precedence order, documented):**
1. **Value's own suffix** — "4.82 billion" / "4,820mn" already carries scale; nothing else is applied.
2. **Extractor unit field** — "millions"/"USD mn" in the unit column wins over any header. (2026-11-26, Item 0.5: if the header declares a DIFFERENT scale than the unit, the unit still wins by precedence but the figure is flagged as a scale conflict for review — never silently trusted.)
3. **Table header** — scale found in the table title, column header, or first rows of the table the figure came from.
4. **Page header** — scale declared at the top of the page (e.g. "in thousands, except per share data").
5. **Document header** — scale declared once for the whole document.
Lower-precedence scales are never stacked on top of higher ones (explicit double-scaling guard, tested).

**Never scaled:** ratios, multiples ("4.5x"), percentages, and per-share figures — including under "in thousands, except per share data" headers.

**Conflicts & absence:** if table and page/document scales disagree, or if the extractor's unit and a header disagree, the figure is marked AI_INFERRED and flagged for review with the reason. If a monetary value has no detectable scale anywhere, the raw value is kept (units never assumed), flagged "scale not found" for review.

**Provenance stored with the value:** `scale` JSON on the extraction result (multiplier, label, where found: suffix/unit/table/page/document, page/sheet/tableId, and the header text that fired the rule) — visible in the review queue, and carried onto the metric observation at ingest.

**Verified by:** Vitest suite (`backend/src/services/*.test.ts`): the original 25 normalizer cases + 12 scale cases (thousands, millions, billions, "000s", "$ in 000", mixed scale, per-share exception, double-scaling guard, missing scale, conflicting scales) plus Item 0.5 cases (header-only "in thousands" with no unit; unit-vs-header conflict flagged; unit-header agreement not a conflict). CI (GitHub Actions) runs typecheck + tests on every push.

**Limits:** column-level scale detection is only as good as header text (a scale buried mid-table in prose may be missed — those figures get the conservative missing-scale flag); per-share detection is by unit/value shape ("/share", EPS-style units), not semantic.

**Status: LIVE** — see FEATURES item 4 above for the review flow it plugs into.

**Gaps resolved by 4a:** silent 1000×/1M× errors from ignored scale headers.

### 4b. PDF table extraction via the in-process Python parsers (2026-11-26)

**What it is:** financial statements are tables, and the JS pdf parser kept them as flat text — the biggest quality gap in the pipeline. Parsing is delegated to the open-source Python parsers (`backend/python-pipelines/`, pdfplumber), which reconstruct each table with header, rows, page number, and an honestly-attributed title.

**How it works:** one service, zero configuration. The worker spawns `python-pipelines/parse_once.py` per document (`LUMEN_PYTHON_BIN` selects the interpreter — on Render the build-time venv; default `python3`); the script prints the parse JSON to stdout, which maps into the exact shape the JS parsers produce (a drop-in swap inside `parseDocument()`), so tables flow into the existing table + row storage, table-aware chunks, the document viewer, and the table-level scale candidates of 4a. Titles never lie: a table's own title row if it has one ("Balance Sheets (In thousands)"), else the nearest text line **above** the table — never a heading from below it; table content is kept out of the paragraph stream so it is never double-reported. Every failure mode — interpreter missing, script missing, timeout, nonzero exit, malformed payload — falls back to the JS parsers with the reason logged; uploads never fail because Python is down. Off switch: `LUMEN_PYTHON_PARSERS=false`; remote-sidecar escape hatch: `PARSE_SERVICE_URL` (takes precedence when set).

**Verified by:** 17 Vitest cases in `pipelineClient.test.ts` for the remote-sidecar path plus 10 for the in-process runner (env wiring incl. the off switch, strict contract mapping incl. formula-cell provenance, ENOENT / exit-code / timeout / invalid-JSON / contract-violation / missing-script fallbacks); an end-to-end run of `parse_once.py` through the real worker path against a financial-statement PDF (tables, correct titles and headers) and with Python missing (logged fallback, honest JS parse). Full suite green, typecheck clean.

**Limits:** borderless or whitespace-aligned tables depend on pdfplumber's detection; scanned PDFs still need OCR; on a machine with no Python deps installed the parse degrades to the JS fallback (reason logged) — never silently.

**Status: LIVE (in-process, single service — no sidecar deploy, no env vars needed).**

## 5. Diligence Questionnaires

**What it is:** generate diligence question sets from the data room and answer them with evidence.

**What it can do today:**
- AI drafts a questionnaire from selected documents (background job)
- **Document scope, enforced**: pick which data-room documents the AI may draft answers from (multi-select at creation, changeable anytime — scope shown in the header; empty = all workspace documents)
- Questions, answers, and per-answer evidence (source document + excerpt)
- Review flow: answers land as needs-review → reviewer approves; low-confidence answers require review
- Import questions from Excel/CSV; add questions manually; per-questionnaire page with status; export

**Internally:** questionnaire created (with its document scope, tenancy-validated) → worker drafts answers via LLM from retrieved chunks of the scoped documents only → answers reference evidence chunks → approval recorded per answer with reviewer id.

**Status: LIVE** — document scope shipped and prod-verified 2026-11-26. Full drafting run on demo data not yet executed end-to-end (founder paused document testing); retrieval path is the same code verified for the AI Assistant.

## 6. Portfolio Analytics

**What it is:** the numbers layer — per portfolio company, per metric, per quarter, fully sourced.

**What it can do today:**
- Entities (portfolio companies) with quarterly metric observations
- Every observation carries: derivation (reported / calculated / AI-inferred), confidence, source document + page + excerpt
- Overview endpoint: metric time-series for charts (entity selector, quarter range)
- Feeds from three paths: manual entry, extraction ingest, calculated values (e.g. net leverage = net debt ÷ EBITDA)

**Internally:** `Entity` + `MetricObservation` (unique per entity+metric+period, so re-ingesting updates rather than duplicates) → series API → frontend charts.

**Gaps:** derived-metric formula engine ("CALCULATED" is a label set by hand or by seeding; no in-app formula definitions yet — e.g. net leverage = net debt ÷ EBITDA must be entered or computed outside); chart UX depth.

**Retrieval infrastructure (2026-11-26):** chunk search now runs on **pgvector** (HNSW cosine index over MiniLM embeddings) + **pg_trgm** (trigram index backing the keyword path — previously a sequential scan over every chunk). Ranking formula and all honest fallbacks unchanged. Semantic path engages for embedded documents; demo-seeded chunks (no embeddings) are served by the indexed keyword path.

**Status: LIVE** (seeded demo data in prod).

## 7. Covenants

**What it is:** the compliance engine — define credit-agreement covenants and test them against portfolio numbers every quarter.

**What it can do today:**
- Define tests manually: metric + comparator (must stay ≤ or ≥) + threshold + unit, linked to a company and the source document
- **AI extraction from credit agreements:** Lumen reads the agreement via RAG and proposes covenants with the exact clause excerpt, page, and confidence — you review before they go live (AI-proposed → reviewed)
- **Automatic compliance:** a covenant is tested the moment it's defined or changed; when new numbers land (manual entry or extraction ingest), every affected period's covenants re-test automatically — no manual run needed
- Breach alerts as notifications — **fresh breaches only** (re-tests never re-alert already-known breaches)
- Run tests per company per quarter: each returns PASS/FAIL with the actual value vs threshold and **headroom** (how close to the line)
- Full result history per covenant
- Dashboard shows the board; Data Quality shows the reviewed/AI-proposed split

**Internally:** definitions (`CovenantDefinition`) → for each test, fetch that quarter's observation for the metric → evaluate comparator → store `CovenantResult` (value, status, headroom) → notification on a **fresh** FAIL. Triggers: manual run, covenant create/update, and any metric observation upsert (manual entry + extraction ingest — fire-and-forget, entry never fails because of the retest).

**Gaps:** email/webhook alerting — email now SHIPPED (2026-11-26): fresh breaches email every active member via SMTP (branded, same freshness rule as in-app alerts; no-ops without SMTP config). Webhook alerting remains future work.

**Status: LIVE** — automatic compliance engine shipped and prod-verified 2026-11-26 (5/5 definitions auto re-tested on new entry; fresh-breach guard verified).

## 8. Data Quality

**What it is:** the trust dashboard — how much of the workspace's data is verified, and how trustworthy each document's understanding is.

**What it can do today:**
- Workspace-level KPIs: extraction verification %, average confidence, open reviews, citation stats
- Covenant governance split: reviewed vs AI-proposed
- Derivation split: reported vs calculated vs AI-inferred observations
- Per-document quality table

**Internally:** aggregation queries over extraction results, observations, citations, covenant definitions — one endpoint, no cached scores.

**Status: LIVE.**

## 9. Workspaces & Team

**What it is:** multi-tenant isolation and collaboration.

**What it can do today:**
- Multiple workspaces per user; every document, chat, covenant, and metric is scoped to one
- 5 roles (viewer → reviewer → editor → admin → owner) enforced on the backend on every request
- Email invitations, role changes, member removal
- Notification feed (incl. breach alerts), audit trail of important actions

**Internally:** membership table checked on every request; non-members get "not found" (never "forbidden" — so outsiders can't even learn a workspace exists). All queries filter by workspace id.

**Status: LIVE.**

## 10. Settings

**What it is:** profile and workspace preferences.

**Status: MINIMAL** — profile + workspace basics. Purpose-built settings (default AI model, alert thresholds, retention) are future work.

## Hidden: Reports

A `Report` model and a `RUN_REPORT` job type exist in the codebase, but there is no real Reports surface yet. Decision pending: build a portfolio report (PDF/Excel export of analytics + covenant status) or remove until needed.

## 11. Trust rule for unit-scale flags (2026-11-26)

**What:** a figure whose unit scale is unresolved (scale not found, conflicting scales) can never silently become a verified number, and can never silently feed a covenant test. Someone must explicitly own the resolution.

**Why:** Lumen's only promise is that every number is correct and traceable to its source. A "4.82" read under a missing "(in thousands)" header is 1,000× wrong — and a covenant PASS built on it would be a lie with a green badge on it.

**How (enforced at every layer, decision logic shared and unit-tested):**
- Review gate — `PATCH /api/extraction-results/:id` refuses `status: "VERIFIED"` while the result's scale JSON carries unresolved flags, unless the analyst explicitly passes `scaleResolution`:
  - `{confirm: true}` — "the figure as shown is correct" (existing multiplier, or none, stays), or
  - `{multiplier: <number>, label?: "thousands"}` — the analyst supplies the correct scale, which replaces the multiplier applied at ingest.
  The resolution (who, when, chosen multiplier, optional note) is stored inside the scale JSON on the result — the original flags are kept as the audit trail — and the action is audited (`extraction.scale_resolved`).
- Ingest gate — `ingestFromExtraction` skips any VERIFIED result whose scale is still unresolved (it can never become a `MetricObservation`); the ingest response reports the refused count. Observations created from resolved figures carry the full scale JSON (flags + resolution) as lineage.
- Covenant gate — a test whose backing observation carries unresolved scale flags stores `NOT_TESTED` with a human-readable `reason` (new nullable `reason` column on `CovenantResult`), visible on the Covenants page, instead of a PASS/FAIL. Missing observations also get a reason now.
- The pure decision logic (`scaleUnresolved`, `applyScaleResolution`, `evaluateCovenant`) lives in `services/trust.ts` with no I/O, and every path above is covered by `trust.test.ts` (Vitest).

**Limits:** scale flags are the resolution gate; figure validation (component sums, balance-sheet identity, QoQ outliers — see Item 2.5 below) now runs post-extraction as configurable per-workspace checks that flag without blocking. It is deliberately not retroactive-computing: observations ingested before 2026-11-26 with unresolved flags are protected at covenant-test time (NOT_TESTED with reason); re-verifying the underlying extraction remains an explicit analyst action. Existing PASS/FAIL covenant results are never rewritten; a re-run may legitimately flip a previously-tested covenant to NOT_TESTED if its figure is unresolved.

**Item 0.5 hardening (2026-11-26, same day):**
- **Ingest overwrite guard** — `ingestFromExtraction` never silently overwrites a stored observation with a different value: same figure (within a one-part-in-a-billion tolerance) refreshes metadata and sets `derivation: AI_INFERRED` on update; a different value is skipped and reported as a conflict (entity, metric, period, existing value + derivation + source vs new value + source) in the ingest response. Pure logic (`sameNumber`, `ingestConflict`) in `services/trust.ts`.
- **Covenant previousStatus** — every re-evaluation records what the result was before the run (`previousStatus`, migration `20261126093000_covenant_result_previous_status`, additive). The Covenants page shows "· was pass/breach" when a NOT_TESTED result previously had a real status. Fresh-breach alerting reads it: a FAIL → NOT_TESTED → FAIL flip is the same known breach re-appearing, not a new alert (`isFreshBreach`).
- **Unit-vs-header conflicts** — see §4a precedence note above; the flag makes such figures subject to the resolution gate.
- **Entity deletion** — `DELETE /api/:workspaceId/analytics/entities/:entityId` (ADMIN-only, audit-logged `entity.deleted`): removes the entity, its observations and covenant definitions/results; scheduled reports survive unlinked. Exists so test entities can be cleaned up properly instead of lingering.

**Status: LIVE.**

### Item 2.5 — Accuracy, evidence & analytics engines (2026-11-27)

Integrated from `phase/accuracy-evidence`, reconciled with the single-service parser architecture:

- **PDF evidence geometry** — every PDF table carries its page bbox, per-row bboxes and per-cell grid bboxes (null when the grid does not align 1:1 — never guessed); sections carry their line bboxes (matched by normalized text); pages expose text lines + headerText. `contextAbove` (~3 lines above each table) is what scale detection reads for "(in thousands)" headers. Chunks persist `regions` (migration `20261126173000`, additive); extraction prefers table-row chunks and cites cell refs (`p3 t1 r5 c2`). `tablesUnavailable` is a disclosed state (document badge + note on every extraction result) when PDFs fall back to pdf-parse.
- **Figure validation** — post-extraction checks per figure (component sums, balance-sheet identity, unit/scale consistency, QoQ outliers), configurable per workspace (`validation.rules` setting, Settings UI "Figure validation" card, GET/PUT routes). Hooked after scale enrichment; catch-and-warn — never blocks extraction. `services/validation.ts` + `validationRun.ts`.
- **Formula covenants** — mathjs strict sandbox (AST-walk whitelist, ≤500 chars / ≤100 nodes / ≤20 calls, finite-only; 13-case injection suite). `CovenantDefinition` gains `formula`, `terms`, `schedule`, `cure`, `nearBreachPct` (migration `20261126180000`, additive); null formula keeps the legacy path. API cross-field validation (400 INVALID_FORMULA); display-only cure endpoint + UI history; `nearBreach` % headroom band on PASS.
- **True TTM** — explicit period parser (ordinal ordering, year boundaries): flows = sum of 4 consecutive quarters (gap → NOT_TESTED, never partial sums); stocks/ratios = period-end; annual targets are not TTM-able; step-down schedules boundary-inclusive. `services/periods.ts` + `ttm.ts`.
- **Calculated metrics** — recompute-first covenant runs; CALCULATED MetricObservations with input lineage; trust propagates from unresolved input scales.

**Verified by:** 190 backend Vitest tests (incl. new formula/periods/ttm/validation suites), 9 pytest cases for the /parse geometry contract, both typechecks clean, end-to-end parse verified with geometry through the in-process runner.

**Status: LIVE** (part of main since the 2026-11-27 integration merge).

### Interactive charts — Apache ECharts (2026-11-27)

All charts run on Apache ECharts (Apache-2.0, free-OSS ✓), tree-shaken to the chart types we actually use (line/bar/pie + grid/tooltip/legend/dataZoom/markLine, canvas renderer) behind one wrapper (`components/EChart.tsx`): browser-only init, auto-resize with its container, disposed on unmount. Palette mirrors `globals.css` so charts sit natively in the UI.

- **Analytics — trend overview**: every metric indexed to its first quarter (= 100) on one shared scale, so wildly different units (USD millions, ratios, %) compare honestly as trajectories; legend toggles, inside + slider data zoom, hover shows the REAL values (with unit and an honest "(AI-inferred)" marker).
- **Analytics — metric cards**: the CSS bars are now real interactive bar charts — hover for period/value/unit, derivation (reported / calculated / AI-inferred) and the source page; the latest quarter is emphasized; AI-inferred bars render faded (55% opacity) so provenance is visible in the chart itself, not just a badge.
- **Dashboard — covenant donut**: the covenant status board opens with a donut over ALL covenants (the list shows six) — pass/breach/not-tested/waived in the app's status colors, with counts beside it; honest shape-first reading before any label.

**Verified by:** frontend `tsc --noEmit` clean + full `next build` green (analytics/dashboard routes ~320 kB first-load including ECharts); SSR-safe by construction (charts init in an effect, never during prerender).

**Status: LIVE.**

---

## Pipeline technology (open-source per task)

| Task | Tech | License | Why |
| --- | --- | --- | --- |
| Web framework | Express (API) + Next.js/React (UI) | MIT | Standard, hostable anywhere |
| Database + ORM | PostgreSQL (Neon) + Prisma | Apache-2.0 | Typed data layer, migrations |
| Object storage | Postgres BYTEA now; S3-compatible (Supabase Storage) when configured | — | Same code path both ways, lazy migration |
| PDF parsing | pdfplumber in-process (fallback: pdf-parse) | MIT | Table reconstruction + font-size headings + page geometry (bboxes, contextAbove); the JS fallback keeps page-splitting text + headings and is disclosed as `tablesUnavailable` |
| Word parsing | mammoth | BSD-2 | DOCX → semantic HTML |
| Excel/CSV parsing | SheetJS (xlsx) | Apache-2.0 | Sheets → tables + rows |
| Chunking | custom (services/chunker.ts) | in-repo | Heading-path + page aware, source-linked |
| Charts | Apache ECharts (tree-shaken) | Apache-2.0 | Interactive financial dashboards: zoom, tooltips, indexed multi-metric trends, honest provenance styling |
| Embeddings | @huggingface/transformers, Xenova/all-MiniLM-L6-v2 (ONNX) | Apache-2.0 | **Runs locally in-process — free and private; no data leaves the server** |
| Job queue | Postgres `FOR UPDATE SKIP LOCKED` | — | No Redis needed; retries built in |
| Auth | bcryptjs + jsonwebtoken | MIT | Sessions, refresh tokens, revocation |
| LLM (chat/extract/summarize) | OpenRouter-hosted model (default gpt-4o-mini) | proprietary API | The **only** non-open-source, paid piece; swap path: self-hosted open model (Phase 0 "private AI path") |

**Cost posture:** everything is free-tier/open-source except LLM tokens and (later) paid hosting tiers.

---

## Known incident: "failed to fetch" in the AI Assistant

**Cause:** the free Render host sleeps after ~15 min without traffic. The next request (e.g. typing "hi") wakes it but the in-flight request fails — the UI shows "failed to fetch". The feature itself is fine.

**Fixes (in order):** external keep-alive ping every 10 min (free, immediate) → Render Starter $7/mo (guaranteed always-on) → Phase 0 always-on backend.

---

## Phases 1–7 — monitoring, intake & consolidation (2026-11-28)

The complete quarterly-monitoring product: Data Room structure, three intake
channels with a confirm gate, honest analytics with saved views, and group
consolidation. All migrations additive.

### Data Room (phase 1)
- **Structure tree** — companies (borrowers) with subsidiaries, folders inside folders, and quarterly folders scoped to a company (`PERIOD` kind, e.g. "Q3 2026"); the left tree shows Unassigned / All documents / companies with document counts and a per-quarter package badge (received/expected). Legacy flat collections were NOT replaced — the existing `Collection` model was extended (`entityId`, `kind`, `periodKey`).
- **Unassigned inbox** — documents with no company live in their own view; emailed documents arrive flagged `NEEDS_CONFIRMATION` (legacy "Email Inbox" collections soft-deleted, docs preserved and moved to unassigned — migration `20261129_phase2`).
- **Email suggestion** — a sender/subject heuristic proposes the matching company ("File to Acme Corp") with one click, which also drops the file into the company's current-quarter folder; "Dismiss" keeps it unassigned without nagging.

### Monitoring (phases 2–3)
- **Certificates** (use case 4) — compliance-certificate documents are reconciled against stored observations of the same period: MATCH (≤1%), WITHIN_TOLERANCE (≤10%), DIFFERS_MATERIALLY, CANNOT_COMPARE, side by side with evidence on both sides (page numbers, source excerpts). Never overwrites anything.
- **Reports** (use case 2) — per-company quarterly report (package grid, covenant grid, figures with derivation/confidence), printable, plus XLSX export; audit-log export for a date window. Scheduled reports re-run in the worker.

### Upload dedupe & figure history (phase 4)
- **Content-hash dedupe** — every upload and email attachment is sha256-hashed; exact duplicates are rejected per file with the reason ("Duplicate of X"), never silently dropped, never double-stored.
- **Figure revision history** — every real overwrite of a stored figure (manual edit, formula recompute, later: consolidation) records an `ObservationRevision` (old → new value, derivations, who/when); the Data Quality page shows recent revisions.

### Analytics Explore (phase 5)
- **Explore tab** — pick companies × metrics × window; a rule-based recommendation picks the honest chart (multi-metric → indexed lines; single period → bars; else lines per company) and explains itself ("Why this chart?"). Missing observations render as gaps, never zeros. **Saved views** store the question, not a frozen picture — the chart re-recommends itself on every load.

### Folder import (phase 6)
- **Stage → preview → confirm** — a directory pick (up to 200 files) lands as a staged `IntakeBatch`: stored, hashed, deduped, junk skipped — but held out of the Data Room (`STAGED` documents are invisible everywhere) until the user reviews the exact folder tree it will create and confirms the destination (company and/or folder). Confirm files the tree, tags and enqueues the documents; "Decide later" keeps the batch resumable from the Add menu; "Discard" soft-deletes and releases its storage.

### Group consolidation (phase 7)
- **Consolidate group** — one button on a company with subsidiaries sums every child's figures per metric × period onto the group entity (`CALCULATED`), so covenants, reports and analytics read the group honestly. Ratio-like metrics (%, multiples, margins, coverage) are skipped as not summable; the group's own figures always win (only roll-up rows refresh); per-child lineage is stored; every refresh appears in the revision history; covenants retest automatically after.
