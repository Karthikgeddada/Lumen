# 07 — Architecture

## Current stack (live in production today)

| Layer | Technology | Notes |
| --- | --- | --- |
| Frontend | Next.js 14 (App Router), TypeScript strict, CSS design system | Deployed on Vercel; auth-guarded shell, 11 feature areas |
| Backend | Node/Express + TypeScript + Zod validation | Modular routers: auth, workspaces, documents, collections, search, conversations, extraction, questionnaires, analytics, dashboard, notifications; global rate limiting; helmet; CORS allow-list |
| Database | PostgreSQL (Neon) via Prisma ORM | Migrations versioned; pooled connection (PgBouncer) + direct URL for migrations |
| Storage | S3-compatible object storage with signed URLs | Demo files download-restricted; expiry on links |
| Embeddings | Local embedding pipeline (no external API for vectors) | Chunks indexed per workspace; page/sheet/heading metadata preserved |
| LLM | OpenRouter (gpt-4o-mini class) for chat/extraction | **MUST CHANGE before fund sales — see below** |
| Parsing | Node parsers (PDF/DOCX/XLSX/CSV) + optional Python FastAPI sidecar | Sidecar (pdfplumber/python-docx/openpyxl/pandas) built & tested; deploy behind PARSE_SERVICE_URL when enabled, JS fallback otherwise |
| Email | SMTP via Resend | Verification + notifications |
| Hosting | Vercel (frontend), Render free tier (backend, sleeps after inactivity) | **Render free tier must go — 50s cold start kills demos** |

## Architecture strengths to keep

* **Lineage-first data model** — chunks keep page/sheet/heading; metric observations carry derivation + source document/page/excerpt. This schema IS the moat; protect it in every future migration.
* **Workspace isolation** — every query scoped by workspace + membership; roles enforced at middleware (requireWorkspace).
* **Audit logging** — actions recorded per workspace actor.
* **Async document pipeline** — status states (processing → completed), worker separate from API.

## Target architecture (Phase 0–1 changes)

1. **AI data path** (blocking):
   * Option A: Azure OpenAI in our own tenant, zero-data-retention deployment, region pinned (eu/us per customer) — fastest, ~enterprise credibility.
   * Option B: self-hosted open-weight models (Qwen/Llama class) on GPU spot or CPU for extraction — full sovereignty for the "private deployment" tier.
   * Blended plan: A for standard tiers, B for the private-deployment tier.
2. **Always-on backend**: AWS EC2 (already scripted) or equivalent; containerized API + worker; queue (Redis/BullMQ or SQS) for document processing; health checks on both services.
3. **Per-task model routing**: cheap mini-class models for chunking/table extraction; larger models only for covenant reasoning; every AI output stored with model + version for audit.
4. **Extraction confidence pipeline**: per-field confidence scores surfaced in the review queue; low-confidence fields default to `AI_INFERRED` + flagged for review.
5. **Usage metering**: per-workspace event log feeding fair-use caps and pilot metrics.
6. **Email-in ingestion** (Phase 2): inbound address → parse queue → workspace, with per-sender allow-lists.

## Deployment topology (target)

```
Browser ──▶ Vercel (Next.js)
              │  /api via custom domain + CORS allow-list
              ▼
         Always-on API (EC2 container)  ──▶  Postgres (managed, PITR backups)
              │                              │
              ├──▶ Worker (queue consumer) ──▶ S3-compatible storage
              │        │
              │        ├──▶ Azure OpenAI (zero-retention) or self-hosted model
              │        └──▶ Python parse sidecar (optional, token-gated)
              └──▶ SMTP (transactional email)
```

## Known gaps (honest list)
* LLM calls currently route through a third-party aggregator — must move before any customer MNPI touches the system.
* Free-tier backend sleeps — cold-start unacceptable for sales.
* Single-region deployment; EU/UK data residency will be requested by UK funds (plan per-region tenancy early).
* No PITR-verified backup drills yet (backups configured on Neon; restore never rehearsed).
* Test coverage: parsers have fixture tests; e2e (Playwright) configured but must run locally; no CI pipeline yet.
