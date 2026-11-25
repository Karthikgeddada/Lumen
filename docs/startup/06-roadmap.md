# 06 — Roadmap

## Phase 0 — Trust & foundations (Weeks 1–4)

**Goal: the product can legally and safely hold a real fund's documents.**

* Rotate **every** credential exposed during development (Neon DB password, Resend key, any API keys in chat history/logs).
* Migrate the AI path off generic third-party routing (OpenRouter) to a **zero-retention enterprise endpoint** (Azure OpenAI in our own tenant) or self-hosted models — see [07](07-architecture.md)/[08](08-security.md). This is the #1 sales blocker.
* Move backend off sleeping free tier (Render cold-start ~50s kills demos) to always-on hosting (AWS EC2 path already prepared).
* Instrument usage events per workspace (for pilot metrics and fair-use caps).
* Kill the demo seed path in production workspaces; keep demo only on the public sandbox account.

**Exit criteria:** a security-conscious fund's diligence checklist answered honestly with evidence.

## Phase 1 — The wedge product (Weeks 5–12)

**Goal: the 24-hour demo is a productized, repeatable motion.**

* **Covenant engine v1**: credit-agreement template → automatic quarterly covenant tests (leverage, liquidity, DSCR) with pass/fail + breach alerts.
* **Verification UX**: review queue where an analyst confirms/corrects each extracted figure in seconds; `AI_INFERRED → REPORTED` transition with audit trail.
* **Quarterly report export**: the covenant dashboard as a branded PDF/Excel pack — the artifact funds forward to their IC.
* Billing (Stripe) + subscription tiers + fair-use metering.
* Real-document demo kit: process 5 anonymized borrower packages; build the "your documents in 24h" ops runbook.

**Exit criteria:** 3 paid pilots signed.

## Phase 2 — Pilot-to-product (Months 4–6)

**Goal: pilots convert; product earns its renewal.**

* Email-in ingestion (forward the borrower package to an @lumen address → auto-parsed, auto-queued).
* Multi-quarter trend analytics + YoY deltas on every metric; breach history timeline.
* Scheduled reports (daily/weekly/monthly) with subscriber management.
* Excel/CSV export of the metric series (analysts keep their models; we feed them).
* SOC2 Type I preparation (policy set, evidence collection — start now, it takes ~3 months).

**Exit criteria:** 10 paying customers, 2 case studies, NRR > 100%.

## Phase 3 — Expand the loop (Months 7–12)

* SSO/SAML + SCIM for the first enterprise buyers.
* Fund-admin integrations (export to Allvue/Chronograph-compatible formats — coexist before compete).
* PE portfolio KPI pack (scorecards, budget-vs-actual) as the second module.
* Private/VPC deployment option for GCC family offices.
* SOC2 Type II observation window running.

**Exit criteria:** 25+ customers, ~$1M ARR, inbound interest from Tier-1 incumbents (the exit conversation begins).

## Explicit non-goals (the discipline list)

* No consumer product, no browser extension, no "chat with any file" positioning.
* No hedge-fund research features (Hebbia's turf) until monitoring is owned.
* No building for enterprise procurement before ~10 customers demand it.
* No fine-tuning/training on customer data, ever.
