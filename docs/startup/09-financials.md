# 09 — Financials

## The goal

**$1M ARR ≈ 25–30 funds/family offices at ~$30–40K blended ACV.** That is a real, fundable/acquirable company from a niche win — and the milestone at which this becomes a million-dollar startup by any standard (revenue multiple on $1M SaaS ARR is typically 5–10x).

## Path to $1M ARR

| Milestone | Customers | ARR | When |
| --- | --- | --- | --- |
| Paid pilots | 3 | ~$10K | Month 3 |
| Early revenue | 10 | ~$250K | Month 6–9 |
| Niche win | 25–30 | ~$1M | Month 18–24 |

Assumes ~85–90% pilot→paid conversion (paid pilots, tight ICP, weekly cadence) and NRR >100% from entity expansion.

## Cost structure (the solo-founder advantage)

| Cost | Today | At 10 customers | At 30 customers |
| --- | --- | --- | --- |
| Hosting + DB + storage | ~$0 (free tiers) | ~$150–300/mo (always-on + backups) | ~$800–1,500/mo |
| AI / models | ~$0 (mini-class) | ~$200–500/mo | ~$1,500–3,000/mo |
| Email/tooling | ~$0–20/mo | ~$100/mo | ~$300/mo |
| Compliance (SOC2 etc.) | $0 | ~$5–10K one-off spread | maintained |
| People | $0 (founder only) | $0 until ~$250K ARR | sales/CS hire ~$60–80K/yr |

**AI cost per customer is tiny relative to price**: a borrower package (~50 pages → a few hundred chunks; extraction + covenant calls on mini-class models) costs **cents to low single-digit dollars per quarter** per entity. Even premium zero-retention endpoints keep gross margin **≥85–90%** at Fund-tier pricing. The price anchors to analyst time saved, not tokens.

## Unit economics per Fund-tier customer

* ACV $24K · COGS (AI+infra allocation) ~$1.2–2.4K · **Gross margin ~90%**
* CAC target: warm-network intros ≈ near-zero cash CAC early; assume $5–10K effective (founder time) — payback < 2 months
* Churn guard: quarterly reports + accumulated lineage history = renewal moat; target logo churn <10%/yr, NRR 110%+

## Runway & funding philosophy

* Current burn ≈ **$0/month** (free tiers) — effectively infinite runway to build.
* Phase 0–1 spend (always-on hosting, Azure OpenAI, SOC2 Type I, Stripe): **~$5–10K total** — bootstrapable.
* Raise nothing until ~$250K ARR with 10 customers; then a seed (or skip to profitability — at 90% margins, 30 customers ≈ a very profitable one-person company).
* The acquirer path (see [03](03-competition.md)): monitoring incumbents and ratings/data players buy at far lower ARR than $1M if the wedge is defensible; revenue + trust posture is what makes the company sellable.

## Key financial risks
1. Discounting in year 1 to win logos — anchors renewals low; resist.
2. Model cost creep if premium models become default for all tasks — mitigate with per-task routing.
3. Solo-founder bandwidth is the true constraint — every dollar saved on infra is spent on founder time; hire the first person (ops/support) the moment support interrupts building.
