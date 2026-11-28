# Lumen — launch / deploy checklist (2026-11-28)

All spec'd product work is on `main` (HEAD `6510bb8`). What a deploy needs —
in order. Nothing here is destructive; every migration since the last deploy
is additive.

## 1. Database migrations (one command, idempotent)

From `backend/`:

    npx prisma migrate deploy

Production has not run anything after `20261126_scale_provenance`; the
migrations this applies, in order:

| Migration | Adds |
| --- | --- |
| `20261127120000_inbound_email` | per-workspace inbound email address |
| `20261127130000_borrower_package` | PackageItem quarterly expectations |
| `20261127140000_entity_subsidiaries` | Entity.parentId self-relation |
| `20261128_phase1_dataroom_tree` | folders-as-tree (entityId/kind/periodKey), email tags |
| `20261129_phase2_email_triage` | Document.assignmentStatus (moves legacy Email-Inbox docs to Unassigned) |
| `20261130_phase4_dedupe_revisions` | Document.contentHash + ObservationRevision |
| `20261201_phase5_explore_views` | SavedChartView |
| `20261202_phase6_folder_import` | STAGED status + IntakeBatch / intakePath |

`ALTER TYPE … ADD VALUE` for `STAGED` is transaction-safe on Postgres 12+.

Then regenerate the client so the new enum value and models exist:

    npx prisma generate

## 2. Backend (Render)

Auto-deploys from `main`. `npm run build` runs `prisma generate && tsc`
(backend/package.json), so the client is regenerated on every build — but
run `npx prisma migrate deploy` (step 1) against `DATABASE_URL` first so the
new tables exist when the app boots. Verify: `https://lumen-api-ctpy.onrender.com/api/health`.

## 3. Frontend (Vercel)

Auto-deploys from `main`. No new env vars.

## 4. Env vars (unchanged, but required by recent features)

- `INBOUND_EMAIL_DOMAIN` (default `in.lumen.app`) and
  `INBOUND_EMAIL_WEBHOOK_SECRET` — needed for email ingestion
  (`20261127120000`+). Set at the email provider's webhook too.
- `MAX_WORKSPACE_STORAGE_MB` (optional, default `5000`) — aggregate
  per-workspace storage cap, enforced at every intake point (upload, folder
  import, inbound email). Raise it if workspaces legitimately need more.

## 5. Post-deploy smoke checks

1. Login → Dashboard loads KPIs.
2. Data Room: tree shows companies/folders; **Add** menu offers "Import
   folder"; a directory pick previews and confirms (files appear Queued).
3. Company page: Subsidiaries card shows **Consolidate group** when the
   company has children; result line reports new/refreshed/skipped.
4. Analytics: **Explore** tab renders the recommended chart + "Why this
   chart?"; save a view and load it back.
5. Data Quality: figure-revisions card lists changes (source shows
   Manual entry / Formula recompute / Group consolidation).
6. Upload the same file twice → second upload is rejected with a duplicate
   reason.

## 6. Known state after deploy

- The old "Email Inbox" collections are soft-deleted; their documents moved
  to Unassigned and flag `NEEDS_CONFIRMATION` — nothing is lost.
- Existing flat collections remain as workspace folders at the top level.
