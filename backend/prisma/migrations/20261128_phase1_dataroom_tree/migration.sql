-- Data Room phase 1: entity-scoped folders. A Collection (folder) can belong
-- to one company/subsidiary; PERIOD folders carry a periodKey. Deleting an
-- entity detaches its folders (SetNull) — folders and documents survive.

ALTER TABLE "Collection" ADD COLUMN "entityId" TEXT;
ALTER TABLE "Collection" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE "Collection" ADD COLUMN "periodKey" TEXT;

ALTER TABLE "Collection" ADD CONSTRAINT "Collection_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Collection_entityId_idx" ON "Collection"("entityId");
