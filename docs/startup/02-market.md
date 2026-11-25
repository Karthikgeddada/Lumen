# 02 — Market

## The market in one paragraph

Private credit is a ~$2T asset class (US-dominant, growing, with the UK as Europe's hub and the GCC emerging fast). Every direct-lending fund, many PE firms, and increasingly family offices receive **quarterly document packages** from the companies they lend to or own — financial statements, compliance certificates, amended agreements — and manually re-key the numbers into Excel trackers and covenant models. The monitoring-software incumbents (Chronograph, Allvue, iLevel, Linedata, eFront) sell portals into which **humans still type the data**. AI-native extraction with lineage is the open gap.

## Customer segments (in order of attack)

### 1. Mid-market private credit / direct lending funds (primary beachhead)
* 5–30 people, $500M–5B AUM, US and UK.
* Pain: ops team of 1–3 analysts manually processing dozens of borrower packages every quarter; covenant deadlines; audit pressure from LPs.
* Why they buy fast: small team, clear ROI (analyst-days saved per quarter), no procurement process.
* Count: thousands of such funds in the US alone; several hundred in the UK.

### 2. PE portfolio-operations teams
* Same workflow at the portfolio-company level: KPI scorecards, budget-vs-actual, vendor performance.
* Same buyer persona (ops/IR associate), slightly longer deal cycle.

### 3. GCC family offices (Dubai/Abu Dhabi/Riyadh)
* Thousands of family offices, many allocating into US/UK private credit and PE for the first time; they monitor those positions with email and Excel.
* Underserved: too small for Bloomberg-style tools, not targeted by US SaaS vendors.
* Buy on relationship + demonstration — matches the founder's network advantage. DIFC alone hosts hundreds of funds.

### 4. Adjacent (later): corporate development, credit-fintech risk teams, fund administrators

## Sizing (directional, honest — verify before quoting externally)

* **TAM**: global fund-ops/document-monitoring software spend — hundreds of millions of USD/yr and growing with private-credit AUM. Include the "replace analyst re-keying" labor budget and the number is far larger.
* **SAM**: English-language private credit + PE ops + family-office monitoring in US/UK/GCC — est. 3,000–8,000 addressable organizations.
* **SOM (3-yr)**: 25–50 paying funds/family offices at ~$30–40K/yr average = **$0.8M–2M ARR**. That is the whole first chapter: a focused, credible niche win.

## Why now

1. **Model capability** — LLM extraction of financial tables with page/sheet-level grounding is now good enough for supervised workflows (not good enough for unsupervised — which is exactly why the review-queue design wins).
2. **Incumbent slowness** — Chronograph/Allvue/iLevel are enterprise ships; bolting credible AI takes them 18–24 months.
3. **Private credit growth** — record AUM, understaffed ops teams, rising LP audit expectations.
4. **Cost asymmetry** — a solo founder on ~$0/month infra can iterate at a cost basis no funded competitor matches.

## Regional analysis

| Region | Entry segment | Why | Risk |
| --- | --- | --- | --- |
| USA | Mid-market credit funds | Largest, fastest-deciding buyer | Most competition for attention; need local references |
| UK | Credit funds + PE ops | Europe's private-credit hub; same product, zero localization | None structural |
| Dubai/GCC | Family offices + DIFC funds | Relationship-driven sales match founder network; underserved | Longer relationship cycles; local partner expectations |

## Market risks

* Incumbents ship credible AI extraction → window closes (mitigate: speed).
* Model providers (OpenAI/Anthropic/Google) ship a "covenant monitor" → they don't do workflows, but watch it.
* A macro credit downturn cuts fund opex budgets — but increases covenant-monitoring urgency (mixed effect).
