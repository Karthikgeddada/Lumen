# 03 — Competition

Ranked by actual threat, not fame. Re-verify quarterly — this space moves fast.

## Tier 1 — Direct incumbents (the companies we displace; also the acquirers)

| Competitor | What they are | Weakness vs. Lumen |
| --- | --- | --- |
| **Chronograph** | Portfolio monitoring + valuation for PE/credit; classiest incumbent | Priced and built for $10B+ funds; assumes humans curate data; heavy onboarding |
| **Allvue** | Fund admin + monitoring suites (private credit focus) | Assembled from acquisitions; clunky UX; analysts still key in numbers |
| **iLevel** | Long-standing PE portfolio data platform | Fundamentally a data-entry portal with workflow on top |
| **Linedata** | Large asset-management software house | Enterprise sales cycles; dated UX; AI bolted on late |
| **eFront (Moody's)** | PE/real-estate fund software inside a ratings giant | Enterprise-grade, slow, expensive; Moody's bought rather than built |
| **Octus (ex-Reorg)** | Credit intelligence + covenant analysis, analyst-driven | Sells research subscriptions, not workflow; humans read the documents |

**Threat model:** these firms own the customer relationships but not the AI-native loop. Real risk = Chronograph or Allvue shipping credible extraction before we reach ~$1M ARR. Their likely move is to **acquire** rather than build (that's the exit path). Window: ~18–24 months.

## Tier 2 — AI-native, adjacent (fund money already flows here)

* **Hebbia (Matrix)** — strongest AI-doc brand in finance; superb analyst Q&A and diligence grids. Episodic **research** tool, not recurring monitoring. Watch for expansion into our loop.
* **Rogo** — AI for investment-banking workflows (decks, comps). Sell-side shaped; different buyer.
* **AlphaSense** — external research/market intelligence; not internal private documents.
* **Glean** — enterprise search/knowledge; funds use it, but it's not monitoring analytics.
* **Harvey** — legal AI; owns the law-firm segment, different document workflows.
* A constant stream of YC-stage startups doing one-off **AI diligence** (parsing data rooms). Crowded end of the pool; recurring monitoring is quieter and stickier.

## Tier 3 — The competitor that actually kills most tools

**An analyst, ChatGPT, and Excel.** Free-ish, flexible, the default. It loses on exactly what we sell: repeatability, lineage (which page did that EBITDA come from?), derivation flags, review queues, audit trail, and institutional memory when the analyst leaves.

**The anti-ChatGPT pitch line:** "You're already doing this with ChatGPT and a spreadsheet — here's why that can't survive an LP audit."

## Positioning matrix

```
                AI-native (extraction → analytics with lineage)
                  │
     Hebbia       │      ★ LUMEN
     (research-    │      (recurring covenant monitoring,
      heavy)      │       mid-market price, day-one deploy)
  AlphaSense/     │
  ChatGPT+Excel   │
                  │
                  ├──────────────────────────────
                  │                              │
        Rogo      │              Chronograph    Allvue / iLevel
                  │              ($10B funds)  Linedata / eFront
                  │                          (data-entry portals,
                  │                           humans key numbers)
                  └──────────────────────────────► enterprise price/complexity
```

**Our cell:** AI-native + recurring monitoring + mid-market price + private-AI trust posture. Nobody owns it today.

## Why we win (and where we could lose)

| We win on | We could lose if |
| --- | --- |
| Traceable numbers (lineage + derivation + review queue) | We ship a wrong covenant number into a real fund — accuracy bar is brutal |
| Price point (~$30–40K/yr vs. enterprise $100K+) | Chronograph launches a mid-market AI tier quickly |
| Speed: solo founder, ~$0 infra, weekly ships | Sales bandwidth: one founder doing build + sell + support |
| Private-AI posture (no data to third-party APIs) — see [08](08-security.md) | We don't actually fix the OpenRouter data path before selling |
| 24-hour demo on the prospect's own documents | We rely on canned demo data instead of their files |

## Monitoring list

Track quarterly: Chronograph, Allvue, Hebbia product launches; Y Combinator batches for new diligence/monitoring startups; Moody's/Bloomberg M&A activity in fund ops (acquirer signals).
