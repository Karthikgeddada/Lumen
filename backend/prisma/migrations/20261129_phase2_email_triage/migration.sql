-- Data Room phase 2: email triage. Emailed documents land in the Unassigned
-- inbox (no folder) with assignmentStatus NEEDS_CONFIRMATION instead of the
-- old "Email Inbox" collection. Legacy emailed documents still sitting in
-- that collection move over; the retired folder is soft-deleted.

ALTER TABLE "Document" ADD COLUMN "assignmentStatus" TEXT;

-- Detach legacy emailed documents from the "Email Inbox" collection into the
-- Unassigned inbox; they wait for confirmation like new arrivals. Documents a
-- user already filed elsewhere keep their folder.
UPDATE "Document" SET "collectionId" = NULL, "assignmentStatus" = 'NEEDS_CONFIRMATION'
WHERE "source" = 'EMAIL'
  AND "entityId" IS NULL
  AND "deletedAt" IS NULL
  AND "collectionId" IN (
    SELECT "id" FROM "Collection" WHERE "name" = 'Email Inbox' AND "deletedAt" IS NULL
  );

-- Retire the now-unused Email Inbox folders (soft delete; nothing is destroyed).
UPDATE "Collection" SET "deletedAt" = now() WHERE "name" = 'Email Inbox' AND "deletedAt" IS NULL;
