# Lumen — Handoff Prompt: accuracy, trust, evidence & analytics

The complete state of the phase: what is DONE, what is REMAINING, and the rules
that govern every item. Read top to bottom, then resume the first unchecked
item in docs/PROGRESS.md. Source of truth for progress = docs/PROGRESS.md;
for design decisions = docs/DECISIONS.md.

## Project context

- Repo: `Karthikgeddada/Lumen` (GitHub), authoritative copy = Databricks Git
  folder `/Workspace/Users/karthikdeveloper.mail@gmail.com/Lumen-repo`.
  Working branch: `phase/accuracy-evidence` (merge to main ONCE, at the end,
  when CI is green).
- Stack: backend = Express + Prisma + TS (`backend/`, Neon Postgres); frontend
  = Next.js App Router + SWR (`frontend/`); python sidecar =
  `python-pipelines/` (FastAPI, deployed separately; PDF geometry only).
- Constraints: free tier everywhere (Render, Neon, Vercel, Resend); free-OSS
  licenses only; additive Prisma migrations (never destructive); all AI
  output stays NEEDS_REVIEW until a human verifies it.
- Local gates per item: backend `npx prisma generate && npm run typecheck &&
  npm test` (159 tests + any new ones); frontend `npm run build` (type-checks
  + bundles). Node lives at `/tmp/node-v22.14.0-linux-arm64` — re-download if
  /tmp was cleared. Commit + push after every item; update PROGRESS.md and
  DECISIONS.md in the same commit.

## Standing rules (do not regress)

1. **Trust rule**: no number is ever trusted silently. Confidence is a signal
   for reviewers; every extraction result stays NEEDS_REVIEW until verified;
   flagged/unresolved figures can never be auto-verified or silently accepted.
2. **Evidence honesty**: never fabricate a highlight or a location. The
   evidence viewer falls back (bbox → text search → page+excerpt notice) and
   discloses when it cannot show more.
3. **Never silent-accept or silent-correct data**: validation misses, scale
   conflicts, unit mismatches all land as note + flagged for a human to own.
4. **Fresh-event-only notifications**: alerts fire on state changes only,
   never on recomputes of the same state.
5. **Backward compatibility**: every schema change additive; null/legacy
   values keep the old code path working unchanged.

## DONE — completed items (verify via git log + PROGRESS.md)

### A. Close-outs (commit 20440cf)
- A1 DEPLOYMENT.md → `lumen-api-ctpy.onrender.com`; README verified (no URL).
- A2 Ingest overwrite guard: differing existing value → skip + conflict
  (entity, metric, period, existing vs new) surfaced in UI.
- A3 Scale tests: header "in thousands" w/o unit; header-vs-unit conflict
  flagged, not guessed.
- A4 CovenantResult.previousStatus (migration 20261126093000); shown on
  Covenants + Dashboard; FAIL→NOT_TESTED→FAIL does not re-alert.
- A5 ADMIN-only, audited, workspace-scoped entity delete endpoint. Prod
  deletion of "ITEM0 SCALE PROOF" docs = user action (no prod creds).

### B. PDF tables & regions + Python sidecar (commit 4cb4b12)
- B1 python-pipelines /parse: per-table page/header/rows, per-cell bbox +
  page size, contextAbove (~3 lines), per-page text lines w/ bboxes; 9 pytest
  cases (incl. backward-compat contract); CI pipelines job.
- B2 Node: PARSE_SERVICE_URL + PIPELINES_TOKEN; PDF → sidecar (90s, 1 retry)
  → pdf-parse fallback; `tablesUnavailable` = disclosed state (UI badge +
  note on results), never a hard failure.
- B3 Tables persisted w/ bbox in cells JSON; cell refs "p3 t1 r5 c2"; chunker
  keeps headers + cell ref per table-row chunk.
- B4 Additive DocumentChunk.regions JSONB (migration 20261126173000);
  reprocess backfills.
- B5 Extraction prefers table-row chunks (numeric fields, stable sort);
  records cell ref + bbox; scaleEnrich uses contextAbove.

### C. Validation, formulas, TTM, calculated metrics (commit abaef79)
- C1 Post-extraction validation per figure (component sums, balance-sheet
  identity, unit/scale consistency, QoQ outliers) — configurable per workspace
  (`validation.rules` setting, Settings UI, GET/PUT routes); hooked after
  scale enrichment, catch-and-warn (never blocks extraction).
- C2 mathjs strict sandbox: AST-walk whitelist (nodes/ops/fns: + - * / ^ min
  max abs sum round), ≤500 chars / ≤100 nodes / ≤20 calls, finite-only;
  FunctionNode `fn` child skipped in traversal (mathjs ≥13 string fn);
  13-case injection suite.
- C3 CovenantDefinition additive columns: formula, terms, schedule, cure,
  nearBreachPct (migration 20261126180000); null formula = legacy path
  unchanged; API cross-field validation (400 INVALID_FORMULA); display-only
  cure endpoint + UI history.
- C4 TRUE TTM: explicit period parser (ordinal ordering, year boundaries);
  flow = sum of 4 consecutive quarters (gap → NOT_TESTED, never partial
  sums); stock/ratio = period-end; annual targets not TTM-able; step-down
  schedules boundary-inclusive.
- C5 CovenantResult.nearBreach (additive): % headroom band on PASS only;
  fresh-event alerts.
- C6 Calculated metrics: recompute-first covenant runs; CALCULATED
  MetricObservations w/ inputs lineage; trust propagates from unresolved
  input scales.
- C7 Tests: 159 backend tests green (formula/periods/ttm/validation suites
  + prior); frontend build green; covenants page formula/cure/near-breach
  UI; Settings "Figure validation" card.

## REMAINING — work to do (in order; see PROGRESS.md for per-item checkboxes)

### D. Accuracy measurement — NEXT UP
- D1 `backend/golden/` 8–10 synthetic fixtures w/ hand-verified expected
  values (page + location).
- D2 Deterministic scorer in CI, fails below baseline.
- D3 `npm run golden:llm` (manual, AI env vars) → `backend/golden/latest.json`.
- D4 Data Quality page: both scores + dates.

### E. Universal evidence viewer
- E1 Backend GET `/api/workspaces/:wid/evidence/...` resolver
  (tenancy-checked, 404 non-members).
- E2 DOCX sanitized HTML endpoint (mammoth + DOMPurify, anchors); XLSX/CSV
  windowed slice endpoint (signed URLs, size limits).
- E3 `<EvidenceViewer>` panel: pdfjs render + bbox overlay, fallback chain
  (bbox → text search → page+excerpt notice), never a fake highlight; DOCX
  anchor highlight; XLSX/CSV virtualized grid; TXT line view.
- E4 Side info (value vs source text, confidence, derivation, scale
  provenance); prev/next, copy, full doc, zoom, keyboard.
- E5 Review queue: keyboard shortcuts, reason chips, confirm-all
  high-confidence (excludes flagged/unresolved); audited.
- E6 Vitest: location resolution + fallback order.

### F. Compliance certificate reconciliation
- F1 "Compliance certificate" extraction template (idempotent seed).
- F2 Reconciliation service (matches / tolerance / differs / cannot compare;
  WorkspaceSetting tolerance).
- F3 Side-by-side UI w/ evidence both sides; never overwrite; fresh-event-
  only notifications.

### G. Premium analytics
- G1 ECharts + TanStack Table wired in.
- G2 Clickable numbers w/ evidence viewer + derivation badge, confidence,
  as-of.
- G3 Covenant detail: trend + threshold + breach shading, headroom bars,
  "can fall X%" math.
- G4 Portfolio heatmap (entities × covenants) + roll-ups + click-through.
- G5 Package tracker (expected vs received per entity/quarter, overdue) on
  Dashboard.
- G6 ObservationRevision additive table, written on every change, viewable.
- G7 QoQ/YoY comparison + EBITDA bridge where inputs exist.
- G8 Templated commentary w/ source links; finance formatting util everywhere.
- G9 Filters (entity, period, status), saved views (additive), URL-synced
  state, skeleton/empty states.
- G10 Performance: server-side aggregation, indexes, pagination, SWR +
  hover-prefetch.
- G11 Tests: formatting, headroom, heatmap, package tracker, revision writes.

### H. Workflow
- H1 Auto-detect period + entity on upload w/ confidence gate; never
  auto-assign low confidence.
- H2 Deterministic QoQ summary per entity (templated, sourced).
- H3 Exports XLSX (SheetJS) + PDF (memory-light); quarterly covenant report
  via Report model + RUN_REPORT + Reports UI.
- H4 First-run guided empty states (Dashboard, Data Room, Covenants,
  Analytics, Extraction).

### I. Foundations
- I1 Job visibility UI (status, attempts, last error, retry).
- I2 Playwright E2E in separate CI job, continue-on-error.
- I3 OCR tesseract.js worker-only behind OCR_ENABLED (default off),
  low-confidence label, docs memory risk.
- I4 Free-tier keep-alive plan documented in ARCHITECTURE.md.

### Deliverables
- X1 `docs/MANUAL_TEST.md` (per feature + evidence-viewer case per format +
  env var names + sidecar setup).
- X2 `docs/samples/` synthetic files (PDF, DOCX, XLSX, CSV, TXT).

### Final
- Z1 CI green on phase branch (typecheck, tests, build both sides).
- Z2 Merge to main once; additive migrations auto-apply on boot.
- Z3 Verify Render deploy + `/api/health` once.
- Z4 Final report (≤30 lines).

## Resume instructions for a fresh agent

1. `cd Lumen-repo && git status` — expect clean on `phase/accuracy-evidence`.
2. Read `docs/PROGRESS.md` → resume the FIRST unchecked item (currently D1).
3. Follow the standing rules above; never merge to main before Z1.
4. After each item: run both gates, tick PROGRESS.md, append decisions to
   DECISIONS.md, commit + push to `phase/accuracy-evidence`.
