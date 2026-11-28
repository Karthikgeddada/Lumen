-- Phase 5: Analytics Explore tab — saved chart views.
-- A saved view stores the dataset + filters (companies, metrics, window);
-- the chart is re-recommended when loaded, so views never go stale.

CREATE TABLE "SavedChartView" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedChartView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedChartView_workspaceId_createdAt_idx" ON "SavedChartView"("workspaceId", "createdAt");

ALTER TABLE "SavedChartView" ADD CONSTRAINT "SavedChartView_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
