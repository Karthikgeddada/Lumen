# Phase: accuracy, trust, evidence & analytics — progress checklist

Branch: `feat/chart-engine` (merge to main once, at the end, when CI is green).
Update after every item; commit + push each time. On restart: resume the first unchecked item.

## CHART ENGINE (2026-11-27 build directive; directive text arrived truncated — items 0–1 built, later items pending re-issue)
- [x] 0. pipelines CI job: command was already `pytest -q`; job failed with pytest exit 2 (collection interrupted) on GH runners only, 9/9 pass locally with exact command + pins. Fix: run pytest in a fresh venv; branch CI confirmation pending — see DECISIONS.md.
- [x] 1. Analytics module restructure (move-only): mounts.ts single source of truth; routeTable.test.ts walks routers without listen() and pins an inline snapshot of METHOD /api/... (192/192 Vitest, tsc clean). analytics/{overview,periods,ttm,formula}.ts moved via git mv + import-only edits; validation*/covenants deliberately stay in services (see DECISIONS.md).
- [ ] 2+. REMAINING ITEMS UNKNOWN — the build directive message was cut off mid-item-1; awaiting the rest.

## A. Close-outs
- [x] A1 Wrong backend URL: DEPLOYMENT.md → `lumen-api-ctpy.onrender.com`; README verified — contains no API URL at all (nothing to fix). Credentialed-request risk assessed in DECISIONS.md.
- [x] A2 Ingest overwrite guard: differing existing value → skip + conflict (entity, metric, period, existing vs new) returned to caller + shown in UI; derivation set correctly on update.
- [x] A3 Scale tests: header "in thousands" with no unit (table rule fires); header-vs-unit conflict flagged, not guessed.
- [x] A4 CovenantResult.previousStatus (additive migration `20261126093000`); "previously PASS/FAIL" shown on Covenants page + dashboard; FAIL→NOT_TESTED→FAIL does not alert as fresh.
- [x] A5 ADMIN-only, workspace-scoped, audited entity delete endpoint. `deploy/Caddyfile.py` already gone. Actual deletion of "ITEM0 SCALE PROOF" in prod → user action (see DECISIONS).

## B. PDF tables & regions (Python sidecar)
- [x] B1 python-pipelines /parse: per-table page, header row, rows, per-cell bbox + page size, contextAbove (~3 lines), per-page text lines w/ bboxes; pytest fixtures. (9 pytest cases incl. backward-compat base contract; new CI pipelines job)
- [x] B2 Node config PARSE_SERVICE_URL + PIPELINES_TOKEN; PDF parse via sidecar (90s, 1 retry) → fallback pdf-parse, tablesUnavailable surfaced in UI + flag reasons.
- [x] B3 Persist tables w/ bbox in cells JSON; cell refs "p3 t1 r5 c2"; chunker keeps headers + cell ref per table-row chunk.
- [x] B4 Additive DocumentChunk.regions JSONB (PDF/DOCX/XLSX/TXT); fill new docs; retry/reprocess backfills (reprocess rebuilds chunks each run). Migration 20261126173000_table_regions_and_parse.
- [x] B5 Extraction prefers table-row chunks (numeric fields, stable sort); records cell ref + bbox; scaleEnrich uses contextAbove.

## C. Validation, formulas, TTM, calculated metrics
- [x] C1 Post-extraction validation per figure (component sums, balance-sheet balance, unit/scale consistency, QoQ outliers; configurable).
- [x] C2 mathjs strict sandbox (parse-only, + - * / ^ min max abs sum round, ≤500 chars, node limit, numeric scope; injection tests).
- [x] C3 CovenantDefinition additive columns: formula, terms, schedule, cure, nearBreachPct (null formula = unchanged behavior).
- [x] C4 TRUE TTM (flow sum 4 consecutive quarters; stock period-end; ratio after aggregation; gaps → NOT_TESTED); explicit period parser.
- [x] C5 CovenantResult.nearBreach additive; fresh-event-only alerts.
- [x] C6 Calculated metrics → MetricObservation CALCULATED + inputs lineage; recompute before covenant retest; inherit unresolved.
- [x] C7 Tests: TTM gaps/boundaries, stock vs flow, step-downs, near-breach, injection, trust propagation, retest ordering.

## D. Accuracy measurement
- [ ] D1 backend/golden/ 8-10 fixtures w/ hand-verified expected values (page + location).
- [ ] D2 Deterministic scorer in CI, fails below baseline.
- [ ] D3 `npm run golden:llm` (manual, AI env vars) → backend/golden/latest.json.
- [ ] D4 Data Quality page: both scores + dates.

## E. Universal evidence viewer
- [ ] E1 Backend GET /api/workspaces/:wid/evidence/... resolver (tenancy-checked, 404 non-members).
- [ ] E2 DOCX sanitized HTML endpoint (mammoth + DOMPurify, anchors); XLSX/CSV windowed slice endpoint (signed URLs, size limits).
- [ ] E3 <EvidenceViewer> panel: pdfjs render + bbox overlay, fallback chain (bbox → text search → page+excerpt notice), never fake highlight; DOCX anchor highlight; XLSX/CSV virtualized grid; TXT line view.
- [ ] E4 Side info (value vs source text, confidence, derivation, scale provenance); prev/next, copy, full doc, zoom, keyboard.
- [ ] E5 Review queue: keyboard shortcuts, reason chips, confirm-all high-confidence (excludes flagged/unresolved); audited.
- [ ] E6 Vitest: location resolution + fallback order.

## F. Compliance certificate reconciliation
- [ ] F1 "Compliance certificate" extraction template (idempotent seed).
- [ ] F2 Reconciliation service (matches / tolerance / differs / cannot compare; WorkspaceSetting tolerance).
- [ ] F3 Side-by-side UI w/ evidence both sides; never overwrite; fresh-event-only notifications.

## G. Premium analytics
- [ ] G1 ECharts + TanStack Table wired in.
- [ ] G2 Clickable numbers w/ evidence viewer + derivation badge, confidence, as-of.
- [ ] G3 Covenant detail: trend + threshold + breach shading, headroom bars, "can fall X%" math.
- [ ] G4 Portfolio heatmap (entities × covenants) + roll-ups + click-through.
- [ ] G5 Package tracker (expected vs received per entity/quarter, overdue) on Dashboard.
- [ ] G6 ObservationRevision additive table, written on every change, viewable.
- [ ] G7 QoQ/YoY comparison + EBITDA bridge where inputs exist.
- [ ] G8 Templated commentary w/ source links; finance formatting util everywhere.
- [ ] G9 Filters (entity, period, status), saved views (additive), URL-synced state, skeleton/empty states.
- [ ] G10 Performance: server-side aggregation, indexes, pagination, SWR + hover-prefetch.
- [ ] G11 Tests: formatting, headroom, heatmap, package tracker, revision writes.

## H. Workflow
- [ ] H1 Auto-detect period + entity on upload w/ confidence gate; never auto-assign low confidence.
- [ ] H2 Deterministic QoQ summary per entity (templated, sourced).
- [ ] H3 Exports XLSX (SheetJS) + PDF (memory-light); quarterly covenant report via Report model + RUN_REPORT + Reports UI.
- [ ] H4 First-run guided empty states (Dashboard, Data Room, Covenants, Analytics, Extraction).

## I. Foundations
- [ ] I1 Job visibility UI (status, attempts, last error, retry).
- [ ] I2 Playwright E2E in separate CI job, continue-on-error.
- [ ] I3 OCR tesseract.js worker-only behind OCR_ENABLED (default off), low-confidence label, docs memory risk.
- [ ] I4 Free-tier keep-alive plan documented in ARCHITECTURE.md.

## Deliverables
- [ ] X1 docs/MANUAL_TEST.md (per feature + evidence-viewer case per format + env var names + sidecar setup).
- [ ] X2 docs/samples/ synthetic files (PDF, DOCX, XLSX, CSV, TXT).

## Final
- [ ] Z1 CI green on phase branch (typecheck, tests, build both sides).
- [ ] Z2 Merge to main once; additive migrations auto-apply on boot.
- [ ] Z3 Verify Render deploy + /api/health once.
- [ ] Z4 Final report (≤30 lines).
