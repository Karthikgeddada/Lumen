# 11 — The Entire Phased Execution Plan

**One document, every phase, start to exit.** Each phase has: goal, work items, exit criteria (do not advance without them), and the main risk. Timelines assume a solo founder building with AI assistance (~$0 infra burn).

---

## Phase 0 — Trust & Foundations (Weeks 1–4)

**Goal: the product can legally and safely hold a real fund's documents. Nothing gets sold before this phase ends.**

| # | Work item | Detail | Done when |
| --- | --- | --- | --- |
| 0.1 | Rotate every exposed credential | Neon DB password, Resend key, any API keys that appeared in chat history/logs | New secrets live only in platform secret managers; old ones revoked |
| 0.2 | Private AI path | Replace OpenRouter with Azure OpenAI (zero-retention, own tenant) or self-hosted models; region pinning (US/EU) | No customer text leaves our boundary; documented data-flow diagram |
| 0.3 | Always-on backend | Migrate API + worker off sleeping Render free tier to AWS EC2 (scripts already written: deploy/ec2-user-data.sh, lumen.service, Caddy) | `/api/health` responds < 1s any time, no cold starts |
| 0.4 | 2FA + session hardening | TOTP second factor; review refresh-token rotation | Auth flows tested incl. lost-device recovery |
| 0.5 | Usage metering | Per-workspace event log (documents, extractions, AI calls) feeding fair-use caps + pilot metrics | Dashboard shows per-workspace usage |
| 0.6 | Backup + restore drill | Restore Neon to a point-in-time; document RPO/RTO | A successful rehearsed restore, documented |
| 0.7 | Kill demo seed in prod | Demo data only on a public sandbox account, never in customer workspaces | Fresh workspace = empty |
| 0.8 | Security policy set | Access control, incident response, SDLC, MNPI handling (draft from doc 08) | Written, versioned in repo |

**Exit criteria:** a security-conscious fund's diligence checklist can be answered honestly with evidence.
**Main risk:** treating this as optional and selling early — one data mishap ends the company.

---

## Phase 1 — The Wedge Product (Weeks 5–12)

**Goal: the 24-hour demo becomes a productized, repeatable motion. The covenant engine is the centerpiece.**

| # | Work item | Detail | Done when |
| --- | --- | --- | --- |
| 1.1 | Covenant engine v1 | From a credit agreement: extract covenant definitions (leverage, liquidity, DSCR, EBITDA definitions); auto-test against each quarter's extracted financials; pass/fail + breach/near-breach alerts | A real credit agreement produces a correct covenant dashboard in < 24h |
| 1.2 | Verification UX | Review queue: confirm/correct/reject each extracted figure in seconds; `AI_INFERRED -> REPORTED` transition with who/when audit trail; confidence scores surfaced | An analyst can review a full borrower package in < 15 min |
| 1.3 | Quarterly report export | Branded PDF/Excel covenant pack (the artifact funds forward to their IC) | Generated one-click from the dashboard, with citations |
| 1.4 | Billing | Stripe subscriptions, tiers (Analyst $499 / Fund $1,999 / Fund+ $3,999), fair-use enforcement | A test workspace can subscribe and be metered |
| 1.5 | Real-document demo kit | Process 5 anonymized borrower packages; write the 24h-demo ops runbook | New package in -> dashboard out within one working day, repeatedly |
| 1.6 | Landing page + sandbox | Public site with the one-liner, pricing, trust posture, and a live demo sandbox | A stranger can self-serve a demo |
| 1.7 | Mutual NDA + pilot agreement | Templates ready (NDA, 90-day paid pilot with success criteria) | Signed-able PDFs in the repo |
| 1.8 | Outreach list | 50 named prospects across Dubai/UK/US, tiered by warmth | List exists with intros sequenced |

**Exit criteria:** 3 paid pilots signed.
**Main risk:** polishing the engine forever — v1 correctness on 3 covenant types beats 15 half-baked ones.

---

## Phase 2 — Pilots to Product (Months 4–6)

**Goal: pilots convert to annual contracts; the product earns renewal.**

| # | Work item | Detail | Done when |
| --- | --- | --- | --- |
| 2.1 | Weekly pilot cadence | Check-in per pilot; success criteria tracked against the agreement | Each pilot has a written status |
| 2.2 | Email-in ingestion | Forward the borrower package to an @lumen address -> auto-parse, auto-queue, per-sender allow-list | One real package processed hands-free |
| 2.3 | Trend analytics | Multi-quarter series, YoY deltas on every metric, breach-history timeline | A 2-year borrower shows a 2-year trend |
| 2.4 | Scheduled reports | Daily/weekly/monthly schedules with subscriber management | Quarterly covenant report arrives without a human |
| 2.5 | Excel/CSV export | Metric series export so analysts keep their own models | Analyst pulls Lumen data into their model |
| 2.6 | SOC2 Type I | Policy set, evidence collection, auditor engagement (start month 3) | Report in hand |
| 2.7 | Case studies | 2 pilot stories with numbers ("X hours saved per quarter") | Published (with permission) |
| 2.8 | Advisor recruit | Credit-fund COO advisor (US/UK) + GCC insider advisor | Both onboarded with equity agreed |

**Exit criteria:** 10 paying customers, 2 case studies, NRR > 100%.
**Main risk:** building feature requests from 3 pilots instead of the repeatable wedge — pilots advise, the ICP decides.

---

## Phase 3 — Expand the Loop (Months 7–12)

**Goal: from 10 to 25–30 customers ≈ $1M ARR; the niche win.**

| # | Work item | Detail | Done when |
| --- | --- | --- | --- |
| 3.1 | SSO/SAML + SCIM | First enterprise buyers demand it | One customer logs in via SSO |
| 3.2 | PE portfolio KPI pack | Scorecards, budget-vs-actual, vendor performance as module #2 | Second module sold to an existing customer |
| 3.3 | Fund-admin integrations | Export to Allvue/Chronograph-compatible formats (coexist before compete) | An admin imports our series without re-keying |
| 3.4 | Private/VPC deployment | For GCC family offices and compliance-heavy funds | One customer runs in its own boundary |
| 3.5 | SOC2 Type II window | Observation period starts | Auditor engaged, evidence flowing |
| 3.6 | First hires | Ops/support contractor at ~$250K ARR; sales/CS at 10+ customers | Founder's calendar has > 50% selling time |
| 3.7 | Regional push | Dubai family-office motion formalized (local partner if needed); UK/US volume outreach | Pipeline from all three regions |

**Exit criteria:** 25–30 customers, ~$1M ARR, inbound interest from Tier-1 incumbents.
**Main risk:** losing the 90% margin discipline — every new fixed cost must earn its keep at 30 customers.

---

## Phase 4 — Scale or Sell (Months 12–24+)

**Goal: the decision point — three honest options, in order of founder preference.**

| Option | What it takes | When it's right |
| --- | --- | --- |
| **A. Bootstrap to profitability** | ~30 customers x ~90% margin = a very profitable one-person company; add hires only as margin allows | Default choice; keeps all optionality |
| **B. Raise a seed** | $250K+ ARR, 10+ customers, NRR > 110% — then raise to fund sales + a second module | Only if the incumbent window (18–24 mo) demands speed money can buy |
| **C. Sell to an incumbent** | Tier-1 acquirers (monitoring platforms, ratings/data players, GCC wealth platforms) buy defensible wedges at or before $1M ARR | If an offer arrives that de-risks your life; revenue + trust posture is what makes you sellable |

**Work in this phase:** due-diligence readiness (clean cap table, contracts, audit trails, SOC2 Type II), deliberate PR (a couple of finance-trade-press mentions), and option-preservation — never take a deal that forecloses the other two.

---

## The Master Rule

**Phases do not overlap on trust items.** You may pre-build Phase 1 features during Phase 0, and sell during Phase 2 — but no customer document ever touches a system that hasn't passed Phase 0. Everything else is negotiable; that is not.

## Quick reference

| Phase | Duration | Theme | Exit |
| --- | --- | --- | --- |
| 0 | Weeks 1–4 | Trust & foundations | Diligence-ready |
| 1 | Weeks 5–12 | Wedge product + demo motion | 3 paid pilots |
| 2 | Months 4–6 | Pilots -> product | 10 customers, SOC2 I |
| 3 | Months 7–12 | Expand the loop | 25–30 customers, ~$1M ARR |
| 4 | Months 12–24+ | Scale or sell | Founder's choice, from strength |
