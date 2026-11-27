-- SavedChartView: validated ChartSpec + name per workspace/user; pinned views
-- render on the Dashboard. Additive only, safe on boot.

-- CreateTable
CREATE TABLE "SavedChartView" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedChartView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedChartView_workspaceId_userId_idx" ON "SavedChartView"("workspaceId", "userId");

-- AddForeignKey
ALTER TABLE "SavedChartView" ADD CONSTRAINT "SavedChartView_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
