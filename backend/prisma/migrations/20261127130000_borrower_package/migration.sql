-- Borrower quarterly package (feature: borrower company page + portfolio heatmap)
-- 1) Documents can be tagged to a borrower (entity) so company pages and
--    quarterly package checks can find them.
-- 2) PackageItem = one expected line item per borrower per quarter, matched
--    against tagged document names by keyword.

ALTER TABLE "Document" ADD COLUMN "entityId" TEXT;

CREATE INDEX "Document_entityId_idx" ON "Document"("entityId");

ALTER TABLE "Document" ADD CONSTRAINT "Document_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PackageItem" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackageItem_entityId_idx" ON "PackageItem"("entityId");

-- AddForeignKey
ALTER TABLE "PackageItem" ADD CONSTRAINT "PackageItem_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
