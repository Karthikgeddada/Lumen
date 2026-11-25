# 08 — Security & Compliance

**Principle: funds trust us with MNPI (material non-public information). Security is not a feature; it is the admission ticket to the market.** This document is written to be shown to a fund's COO after the gaps are closed.

## Current state — honest assessment (as of Nov 2026)

| Area | Status | Action |
| --- | --- | --- |
| Credential hygiene | ⚠️ DB password + email key exposed in dev chat history during development | **Rotate immediately (Phase 0, week 1). Never store secrets in chat/notes** |
| LLM data path | ❌ Calls route via third-party aggregator (OpenRouter); customer text leaves our boundary | Migrate to Azure OpenAI zero-retention (own tenant) or self-hosted models |
| Backend hosting | ⚠️ Free tier sleeps; no uptime SLA | Always-on containerized deploy (AWS) |
| Encryption in transit | ✅ HTTPS everywhere, signed URLs | Maintain |
| Encryption at rest | ✅ Managed DB + object storage encryption | Verify + document provider controls |
| Access control | ✅ RBAC (OWNER/ADMIN/EDITOR/VIEWER), per-workspace scoping in middleware | Add 2FA before paid pilots |
| Audit logging | ✅ Per-workspace action log | Extend to cover every state change on metric observations |
| Backups | ⚠️ Configured but restore never rehearsed | Monthly restore drill + documented RPO/RTO |
| Compliance attestations | ❌ None | SOC2 Type I by ~month 6; Type II window from month 9 |

## The trust posture we sell

1. **No training on customer data. Ever.** Contractual + technical (zero-retention endpoints; prompts/logs purged on schedule).
2. **Every number is auditable** — source page/sheet/cell, derivation flag, who reviewed it and when.
3. **Every AI output is stamped** — model name + version stored with the observation for reproducibility.
4. **Human review before official** — `AI_INFERRED` values never reach a credit committee without analyst confirmation.

## MNPI handling policy (customer-facing)

* Data isolated per workspace (enforced at query level, not just UI).
* Retention/deletion on request within N days; deletion propagates to storage, indexes, chunks, and derived metrics.
* Access logging on document views/downloads.
* Mutual NDA standard before receiving any customer document (24h-demo included).

## Compliance roadmap

* **Now**: credential rotation, private AI path, 2FA, backup drills, security policy set (access control, incident response, SDLC).
* **Month 3–6**: SOC2 Type I (policy + design audit); GDPR/UK GDPR DPA template; data-residency options (US/EU) for UK customers.
* **Month 9+**: SOC2 Type II observation window; consider ISO 27001 only if GCC enterprise deals require it.
* **Regional notes**: DIFC/UAE data-protection law (DFSA rules) for GCC family offices — lightweight, contract-first compliance; UK/EU GDPR for UK funds.

## Incident response (draft)

Detect → contain (revoke access/rotate) → assess scope → notify affected customers within 72h → post-mortem published to customers. Founder is on-call until first hire.
