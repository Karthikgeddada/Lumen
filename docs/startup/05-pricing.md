# 05 — Pricing

## Principles

1. **Value anchor is analyst time**, not tokens: a fund paying an analyst ₹/$50–90K/yr to re-key documents will pay $30K+/yr to never do it again.
2. **Price per workspace (fund), not per seat** — seats punish the champion who invites teammates.
3. **Every tier is paid from day one** — free pilots churn; unpaid attention is worthless.
4. **AI usage is metered by fair-use caps**, not billed line-item — funds hate variable bills; we absorb model costs inside the margin (see [09 — Financials](09-financials.md)).

## Tiers

| Tier | Price | Includes | Target |
| --- | --- | --- | --- |
| **Analyst** | $499/mo ($6K/yr) | 1 workspace, 1 borrower/entity, 40 documents/qtr, covenant tests, dashboard, 3 seats | Single-analyst teams; land-and-expand entry |
| **Fund** (core tier) | $1,999/mo ($24K/yr) | 5 entities, 250 docs/qtr, scheduled quarterly reports, alerts, questionnaires, 10 seats | Mid-market credit fund — the wedge customer |
| **Fund+** | $3,999/mo ($48K/yr) | Unlimited entities + docs, priority processing, quarterly review-call, API access | Larger funds; early family offices |
| **Private deployment** | Custom (from ~$60K/yr) | VPC/Azure tenant, custom DPA, dedicated support | GCC family offices; larger funds with compliance teams |

Target blended ACV at scale: **~$30–40K/yr** (mix of Analyst→Fund upgrades).

## Expansion revenue (NRR engine)

* **More borrowers/entities** — Analyst → Fund → Fund+ as the fund adds coverage.
* **More workflows** — questionnaires, vendor scorecards, PE portfolio KPIs on the same platform.
* **Scheduled reports** — the quarterly covenant report generated automatically becomes renewal-proof.
* Every quarter of data accumulated raises switching costs: the lineage history is the lock-in.

## Pilot pricing

90-day paid pilot at **50% of Fund tier (~$12K/yr equivalent, ~$3K for the pilot)** with conversion to annual at full price. The pilot contract states success criteria up front (e.g., "2 borrower packages processed end-to-end, covenant dashboard delivered, analyst verification ≥95% of extracted figures").

## What we deliberately do NOT charge for

* Seats (invite the whole fund).
* Citations/audit trail — it's the product, not a premium feature.
* Onboarding the first borrower package (we do it manually — that's the 24h demo anyway).

## Pricing risks

* Underpricing at seed stage to win logos — acceptable once, never habitually; every discount sets the renewal anchor.
* Enterprise suites discounting down-market — respond with speed + trust posture, not price war.
* Model costs rising if we move to premium private-AI endpoints — model selection per task (cheap extraction models, premium reasoning models only where needed) keeps blended cost low.
