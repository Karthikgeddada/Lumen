# AGENTS.md — how to work in this repo

Read these first, in order: docs/PROGRESS.md (what's done/open — resume from
the first unchecked item, never redo finished work), docs/DECISIONS.md
(non-obvious decisions and why), docs/ARCHITECTURE.md (structure and module
conventions), docs/ANALYTICS_MODULE.md (the analytics module map).

- **Branch discipline**: feature work happens on `feat/*` branches; merge to
  main ONCE at the end when CI is fully green. Never push intermediate work
  to main. Commit after every item; keep PROGRESS.md updated in the same
  commit.
- **Gates before every commit you consider done**: backend `npm run
  typecheck` + `npm test`, frontend `npx tsc --noEmit`, `pytest` in
  `backend/python-pipelines` (use a clean venv). CI (.github/workflows/ci.yml)
  runs all three — fix red yourself before moving on.
- **Module conventions**: see ARCHITECTURE.md §11 and
  analytics/dependencyRules.test.ts (layering is enforced by tests, not
  convention). New backend features follow: core (pure) → services (Prisma)
  → routes (thin) inside their module folder, mounted via routes/mounts.ts.
- **API stability**: existing endpoint paths and JSON shapes never change —
  new capabilities get new endpoints. routes/routeTable.test.ts pins the
  route table; analytics shape tests pin key response shapes. If you change a
  route, the snapshot test tells you — that is the point: update it
  deliberately (`vitest run -u`) only alongside the frontend change.
- **Migrations**: additive only, 14-digit UTC prefix (e.g.
  20261127090000_what), safe to apply on boot (`prisma migrate deploy`).
- **Trust rule**: a figure with unresolved flags never silently becomes
  verified, an observation, or a covenant PASS/FAIL. Charts show such points
  flagged and exclude them from aggregates. Preserve lineage and derivation
  labels on every figure.
- **Every query is workspace-scoped** (tenancy), 404-not-403, Zod-validate
  request bodies, audit-log mutations, log decisions you had to make
  yourself in DECISIONS.md with the reasoning.
