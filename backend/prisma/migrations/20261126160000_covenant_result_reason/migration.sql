-- Trust rule: covenant results that cannot be tested (e.g. the backing metric
-- observation carries unresolved scale flags, or the metric was never
-- observed) now store a visible human-readable reason instead of silently
-- reading NOT_TESTED. Additive only — existing rows keep NULL (no reason).
ALTER TABLE "CovenantResult" ADD COLUMN "reason" TEXT;
