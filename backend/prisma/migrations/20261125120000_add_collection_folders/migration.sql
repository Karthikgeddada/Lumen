-- Nested folders for the Data Room: collections can live inside collections.
ALTER TABLE "Collection" ADD COLUMN "parentId" TEXT;
CREATE INDEX "Collection_parentId_idx" ON "Collection"("parentId");
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;