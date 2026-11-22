# Lumen — Document Intelligence

Lumen turns a workspace of documents — agreements, filings, spreadsheets, policies — into answers, structured data, and trackable metrics, with **every claim cited back to the page, sheet, or cell it came from**.

This repository is a production-ready full-stack SaaS: Next.js frontend, Express + Prisma backend, PostgreSQL, background worker for document processing and AI, and deployment configs for Vercel + Render.

## What it does

* **Document Library** — upload PDFs, Office documents, and spreadsheets (drag & drop), organized into collections, with processing status, pagination, and search.
* **Document Viewer** — AI summary, key facts, extracted structure (headings and passages by page), and spreadsheet tables with headers and rows — each with provenance.
* **AI Assistant** — streaming chat grounded strictly in workspace documents (RAG). Every answer carries numbered citations; evidence opens in a panel with the source excerpt. If the documents don't contain the answer, it says so — it never invents one.
* **Data Extraction** — define fields (or start from built-in templates) and extract structured values across documents with confidence scores, evidence excerpts, and a review workflow (verify / edit / reject).
* **Questionnaires** — build in-app or import from Excel, then let AI draft answers with citations and confidence. Workspace-configurable rules decide what requires human review; reviewers approve or reject each answer.
* **Analytics** — per-entity quarterly metrics with honest derivation labels (Reported / Calculated / AI-inferred). Feed metrics from verified extractions or enter reported figures directly. On-demand and scheduled reports.
* **Workspaces & Team** — isolated workspaces, five roles (Owner / Admin / Editor / Reviewer / Viewer), email invitations, and an activity log.
* **Security** — device-scoped sessions with rotating refresh tokens (access tokens in memory only), argon2id password hashing, workspace-scoped authorization on every route, and audit logging.

Demo content from the reference design ships as clearly-labeled demo data — never mixed with real customer data, and demo AI results are marked as sample output, not verified findings.

## Repository layout

```
lumen/
├─ backend/          Express API + worker (TypeScript)
│  ├─ src/routes/    auth, workspaces, collections, documents, search,
│  │                 conversations, extraction, questionnaires, analytics,
│  │                 dashboard, notifications
│  ├─ src/services/  ai (RAG), extraction, analytics, queue/worker
│  ├─ src/middleware/ auth (JWT + workspace roles), errors
│  ├─ prisma/schema.prisma
│  └─ seed.ts        built-in templates + reference demo dataset (isDemo)
├─ frontend/         Next.js 14 app (App Router, TypeScript, SWR)
└─ docs             README, ENVIRONMENT.md, DEPLOYMENT.md
```

## Quick start (local)

1. **Backend**
   ```bash
   cd backend
   cp .env.example .env         # fill DATABASE_URL, AUTH_SECRET; see ENVIRONMENT.md
   npm install
   npx prisma migrate deploy    # or prisma db push for a fresh dev db
   npx prisma db seed           # templates + demo dataset
   npm run dev                  # http://localhost:4000
   ```
2. **Frontend**
   ```bash
   cd ../frontend
   cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000
   npm install
   npm run dev                  # http://localhost:3000
   ```
3. Register a user, create a workspace, and the onboarding wizard walks you through the rest.

For every environment variable and its purpose, see [ENVIRONMENT.md](ENVIRONMENT.md). For production deployment on Vercel + Render, see [DEPLOYMENT.md](DEPLOYMENT.md).

## The AI honesty model

Three principles are enforced throughout:

1. **Citations are mandatory.** Assistant answers, extraction values, and questionnaire drafts each store their evidence — document, page/sheet/cell, and excerpt.
2. **Derivations are labeled.** Analytics values are always shown as Reported, Calculated, or AI-inferred, with inferred values visually distinguished.
3. **Confidence drives review.** Low-confidence AI output is flagged for human review by default; auto-approval is an explicit workspace setting.
