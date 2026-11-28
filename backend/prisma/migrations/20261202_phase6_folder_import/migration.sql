-- Phase 6: folder import — staged intake batches with a confirm gate.
-- Files in a directory pick are stored + deduped but held out of the Data
-- Room (Document.status STAGED) until a user confirms the destination.

-- NOTE: ALTER TYPE ... ADD VALUE runs fine in this transaction on Postgres
-- 12+ as long as the new value is not USED in the same transaction — it
-- isn't (runtime code reads it later).
ALTER TYPE "DocumentStatus" ADD VALUE 'STAGED';

CREATE TABLE "IntakeBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejected" JSONB,
    "createdById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IntakeBatch_workspaceId_status_idx" ON "IntakeBatch"("workspaceId", "status");

ALTER TABLE "IntakeBatch" ADD CONSTRAINT "IntakeBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Document" ADD COLUMN "intakeBatchId" TEXT;
ALTER TABLE "Document" ADD COLUMN "intakePath" TEXT;
ALTER TABLE "Document" ADD CONSTRAINT "Document_intakeBatchId_fkey" FOREIGN KEY ("intakeBatchId") REFERENCES "IntakeBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Document_intakeBatchId_idx" ON "Document"("intakeBatchId");
