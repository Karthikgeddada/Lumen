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

**Internally (the ingestion pipeline):** file bytes stored safely (database or S3-compatible storage) → background worker parses per format (pdf-parse for PDFs, mammoth for Word, SheetJS for Excel) → chunks with heading/page/sheet labels → embedded locally (open-source MiniLM model, runs on our server, no data leaves) → AI summary generated from the chunks → status set honestly (scanned/image PDFs land in "needs review", not pretended-done).

**Gaps:** PDF tables are kept as text (no table reconstruction yet); scanned PDFs need OCR (not built); questionnaires page cannot yet pick data-room documents; feature pages cannot upload fresh docs inline (pick-only).

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

**Gaps:** none known in the extraction→analytics path. Adjacent open work: PDF table detection (tables are kept as text), OCR for scanned documents.

**Status: LIVE** — normalizer shipped and unit-verified 2026-11-26.

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

**Gaps:** charts/UX depth on the analytics page; scheduled recalculation of derived metrics.

**Status: LIVE** (seeded demo data in prod).

## 7. Covenants

**What it is:** the compliance engine — define credit-agreement covenants and test them against portfolio numbers every quarter.

**What it can do today:**
- Define tests manually: metric + comparator (must stay ≤ or ≥) + threshold + unit, linked to a company and the source document
- **AI extraction from credit agreements:** Lumen reads the agreement via RAG and proposes covenants with the exact clause excerpt, page, and confidence — you review before they go live (AI-proposed → reviewed)
- Run tests per company per quarter: each returns PASS/FAIL with the actual value vs threshold and **headroom** (how close to the line)
- Full result history per covenant
- Breach alerts as notifications ("Halden Industrial — Q3 2026: 1 of 5 covenants failed")
- Dashboard shows the board; Data Quality shows the reviewed/AI-proposed split

**Internally:** definitions (`CovenantDefinition`) → for each test, fetch that quarter's observation for the metric → evaluate comparator → store `CovenantResult` (value, status, headroom) → notification on FAIL.

**Gaps:** tests run on demand (manual) — auto re-run when new numbers land is the next build; email/webhook alerting.

**Status: LIVE.**

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

---

## Pipeline technology (open-source per task)

| Task | Tech | License | Why |
| --- | --- | --- | --- |
| Web framework | Express (API) + Next.js/React (UI) | MIT | Standard, hostable anywhere |
| Database + ORM | PostgreSQL (Neon) + Prisma | Apache-2.0 | Typed data layer, migrations |
| Object storage | Postgres BYTEA now; S3-compatible (Supabase Storage) when configured | — | Same code path both ways, lazy migration |
| PDF parsing | pdf-parse | MIT | Page-splitting, text + headings |
| Word parsing | mammoth | BSD-2 | DOCX → semantic HTML |
| Excel/CSV parsing | SheetJS (xlsx) | Apache-2.0 | Sheets → tables + rows |
| Chunking | custom (services/chunker.ts) | in-repo | Heading-path + page aware, source-linked |
| Embeddings | @huggingface/transformers, Xenova/all-MiniLM-L6-v2 (ONNX) | Apache-2.0 | **Runs locally in-process — free and private; no data leaves the server** |
| Job queue | Postgres `FOR UPDATE SKIP LOCKED` | — | No Redis needed; retries built in |
| Auth | bcryptjs + jsonwebtoken | MIT | Sessions, refresh tokens, revocation |
| LLM (chat/extract/summarize) | OpenRouter-hosted model (default gpt-4o-mini) | proprietary API | The **only** non-open-source, paid piece; swap path: self-hosted open model (Phase 0 "private AI path") |

**Cost posture:** everything is free-tier/open-source except LLM tokens and (later) paid hosting tiers.

---

## Known incident: "failed to fetch" in the AI Assistant

**Cause:** the free Render host sleeps after ~15 min without traffic. The next request (e.g. typing "hi") wakes it but the in-flight request fails — the UI shows "failed to fetch". The feature itself is fine.

**Fixes (in order):** external keep-alive ping every 10 min (free, immediate) → Render Starter $7/mo (guaranteed always-on) → Phase 0 always-on backend.
