-- ObservationRevision: append-only history written by the single observation
-- writer (analytics/services/observations.ts) on every change. Additive only.

-- CreateTable
CREATE TABLE "ObservationRevision" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "previousValue" DOUBLE PRECISION,
    "previousUnit" TEXT,
    "previousDerivation" TEXT,
    "previousScale" JSONB,
    "previousSourceDocumentId" TEXT,
    "previousSourcePage" INTEGER,
    "previousSourceExcerpt" TEXT,
    "changedById" TEXT,
    "reason" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObservationRevision_observationId_changedAt_idx" ON "ObservationRevision"("observationId", "changedAt");

-- AddForeignKey
ALTER TABLE "ObservationRevision" ADD CONSTRAINT "ObservationRevision_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "MetricObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
