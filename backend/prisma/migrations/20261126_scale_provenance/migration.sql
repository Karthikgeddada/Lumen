-- Unit-scale provenance (additive): the detected scale for an extracted figure
-- (multiplier, label, where it was found — suffix/unit/table/page/document —
-- and the header text that fired the rule), stored on the extraction result
-- for the review queue, and carried onto the metric observation at ingest.
ALTER TABLE "ExtractionResult" ADD COLUMN "scale" JSONB;
ALTER TABLE "MetricObservation" ADD COLUMN "scale" JSONB;