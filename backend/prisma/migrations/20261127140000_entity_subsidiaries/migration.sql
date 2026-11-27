-- Subsidiaries on the borrower company page: a self-relation on Entity. A
-- subsidiary points at its parent borrower; deleting the parent detaches
-- children (SetNull) rather than cascading them away.

ALTER TABLE "Entity" ADD COLUMN "parentId" TEXT;

ALTER TABLE "Entity" ADD CONSTRAINT "Entity_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Entity_parentId_idx" ON "Entity"("parentId");
