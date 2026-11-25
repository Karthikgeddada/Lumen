-- CreateEnum
CREATE TYPE "CovenantComparator" AS ENUM ('LTE', 'GTE');

-- CreateEnum
CREATE TYPE "CovenantStatus" AS ENUM ('AI_INFERRED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "CovenantResultStatus" AS ENUM ('PASS', 'FAIL', 'NOT_TESTED', 'WAIVED');

-- CreateTable
CREATE TABLE "CovenantDefinition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "documentId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "metricKey" TEXT NOT NULL,
    "comparator" "CovenantComparator" NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'x',
    "period" TEXT NOT NULL DEFAULT 'quarter',
    "sourceExcerpt" TEXT,
    "sourcePage" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "CovenantStatus" NOT NULL DEFAULT 'AI_INFERRED',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CovenantDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CovenantResult" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "status" "CovenantResultStatus" NOT NULL,
    "headroom" DOUBLE PRECISION,
    "observationId" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CovenantResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CovenantDefinition_workspaceId_idx" ON "CovenantDefinition"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CovenantDefinition_entityId_key_key" ON "CovenantDefinition"("entityId", "key");

-- CreateIndex
CREATE INDEX "CovenantResult_definitionId_period_idx" ON "CovenantResult"("definitionId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "CovenantResult_definitionId_period_key" ON "CovenantResult"("definitionId", "period");

-- AddForeignKey
ALTER TABLE "CovenantDefinition" ADD CONSTRAINT "CovenantDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CovenantDefinition" ADD CONSTRAINT "CovenantDefinition_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CovenantDefinition" ADD CONSTRAINT "CovenantDefinition_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CovenantResult" ADD CONSTRAINT "CovenantResult_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "CovenantDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

