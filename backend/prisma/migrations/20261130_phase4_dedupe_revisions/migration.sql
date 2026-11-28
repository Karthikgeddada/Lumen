-- Phase 4: upload dedupe + observation revision history.
-- Document.contentHash (sha256 of file bytes) backs duplicate detection on
-- upload and inbound email; ObservationRevision records every real overwrite
-- of a stored metric figure (manual edit or formula recompute).

-- Duplicate detection: sha256 of file bytes, per workspace.
ALTER TABLE "Document" ADD COLUMN "contentHash" TEXT;

CREATE INDEX "Document_workspaceId_contentHash_idx" ON "Document"("workspaceId", "contentHash");

-- Revision history for metric figures.
CREATE TABLE "ObservationRevision" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "oldValue" DOUBLE PRECISION NOT NULL,
    "newValue" DOUBLE PRECISION NOT NULL,
    "oldDerivation" "Derivation" NOT NULL,
    "newDerivation" "Derivation" NOT NULL,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservationRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ObservationRevision_workspaceId_createdAt_idx" ON "ObservationRevision"("workspaceId", "createdAt");

CREATE INDEX "ObservationRevision_entityId_metricKey_period_idx" ON "ObservationRevision"("entityId", "metricKey", "period");

ALTER TABLE "ObservationRevision" ADD CONSTRAINT "ObservationRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ObservationRevision" ADD CONSTRAINT "ObservationRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
