# 01 — Product

## What Lumen is

Lumen is a document-intelligence platform for private capital teams. It reads the documents funds already receive every quarter — borrower financial packages, credit agreements, earnings releases, master service agreements, vendor scorecards — and turns them into **live, verifiable analytics**: quarterly metric series, covenant test results, exception alerts, and citable answers to any question.

The core differentiator is not "chat with your documents." It is **grounded analytics**:

* Every extracted number carries **lineage** — the exact PDF page, spreadsheet sheet, or cell it came from.
* Every metric carries a **derivation label**: `REPORTED` (stated in the document), `CALCULATED` (derived from reported figures), or `AI_INFERRED` (model extracted with confidence, pending human review).
* Every AI answer carries **citations** to specific pages, so a credit committee can audit it.
* A **human review queue** ("open reviews") lets analysts confirm, correct, or reject AI-extracted figures before they become official.

This design is the moat: funds cannot put an unauditable chatbot in front of a credit committee, but they can put a traceable extraction pipeline in front of one.

## The core workflow (the loop we sell)

1. **Receive** — borrower/LLC quarterly package lands by email. Drag PDFs, DOCX, XLSX, CSV into the Library (drag-and-drop upload, S3-backed storage).
2. **Parse** — the pipeline extracts text, structure, headings, tables, and sheets. Documents move through processing states to `COMPLETED` with page counts.
3. **Understand** — chunks are embedded and indexed; entities (borrowers, portfolio companies, counterparties) are tracked; metrics (revenue, EBITDA, net debt, leverage) are extracted into quarterly series with lineage.
4. **Test** — covenant templates (leverage ratio, liquidity, DSCR, EBITDA definitions from the credit agreement) are applied automatically each quarter. Breaches and near-breaches surface as alerts and dashboard KPIs.
5. **Review** — analysts confirm flagged figures in the review queue; `AI_INFERRED` becomes `REPORTED` once verified or corrected.
6. **Consume** — dashboards (KPIs, trends, YoY deltas), scheduled reports, citable Q&A over the whole corpus, and questionnaire workflows (e.g., vendor security assessments) with scored answers.

## Feature inventory (built and live in production today)

* **Auth & multi-workspace** — email/password, session + refresh tokens, role-based access (OWNER / ADMIN / EDITOR / VIEWER), multiple workspaces per account with per-workspace data isolation.
* **Library** — upload (PDF/DOCX/XLSX/CSV), processing pipeline, collections, delete with soft-delete, document detail with parsing status, signed download links (demo files restricted).
* **Search** — global search across document names and inside document text, with page/sheet/heading locations on every hit (⌘K in the UI).
* **Assistant** — RAG chat over the workspace corpus with streaming responses and page-level citations on every answer.
* **Extraction** — reusable extraction templates (e.g., "Credit agreement", "Supplier scorecard KPIs", "Covenant tests") producing structured fields with source locations.
* **Analytics** — entity registry, quarterly metric series with derivation flags, YoY deltas, on-demand and scheduled reports (quarterly / comparison; daily–monthly schedules).
* **Questionnaires** — reusable assessment templates with scored, sourced answers.
* **Notifications** — in-app notification center with unread counts.
* **Dashboard** — workspace KPIs (documents, pages understood, extractions, open reviews), recent documents, activity.
* **Audit log** — actions (document viewed, extraction run, report created) recorded per workspace.

## What is deliberately NOT in the product

* No generic "chat with any file" consumer positioning — the product is workflow software for teams, not a chatbot.
* No model training on customer data, ever (see [08 — Security](08-security.md)).

## The 24-hour demo (sales motion artifact)

The demo that closes pilots:

1. Prospect sends **one real borrower package** (quarterly financials + credit agreement) under NDA.
2. Within 24 hours Lumen returns: the entity dashboard, 4–8 quarters of key metrics with source pages, covenant test results with pass/fail, and 3 questions answered with citations.
3. The prospect's analyst verifies two numbers against the PDF — the moment of conversion.

The demo works because it uses **their documents**, not canned data — nobody in this market buys slides.

## Product naming

Working name: **Lumen**. Positioning name for the wedge: "covenant & portfolio monitoring, AI-native." Evaluate naming (availability, trademark in US/UK/UAE) before external launch.
