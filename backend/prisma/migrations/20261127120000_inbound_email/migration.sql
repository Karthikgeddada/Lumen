-- Inbound email ingestion: every workspace gets a dedicated inbound address,
-- and documents record whether they arrived by upload or by email.
ALTER TABLE "Workspace" ADD COLUMN "inboundEmail" TEXT;
CREATE UNIQUE INDEX "Workspace_inboundEmail_key" ON "Workspace"("inboundEmail");

ALTER TABLE "Document" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'UPLOAD';
ALTER TABLE "Document" ADD COLUMN "emailFrom" TEXT;
ALTER TABLE "Document" ADD COLUMN "emailSubject" TEXT;
ALTER TABLE "Document" ADD COLUMN "emailReceivedAt" TIMESTAMP(3);
CREATE INDEX "Document_workspaceId_source_idx" ON "Document"("workspaceId", "source");