-- Item C: formulas, TTM terms, schedules, near-breach, calculated-metric
-- lineage. All additive — nulls keep prior behavior exactly (formula null =
-- single-metric covenant, unchanged).

ALTER TABLE "CovenantDefinition"
  ADD COLUMN "formula" TEXT,
  ADD COLUMN "terms" JSONB,
  ADD COLUMN "schedule" JSONB,
  ADD COLUMN "cure" JSONB,
  ADD COLUMN "nearBreachPct" DOUBLE PRECISION;

ALTER TABLE "CovenantResult" ADD COLUMN "nearBreach" JSONB;

-- Lineage for CALCULATED metric observations (spec C6): which input
-- observations fed the computed value, per period.
ALTER TABLE "MetricObservation" ADD COLUMN "inputs" JSONB;
