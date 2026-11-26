-- Item 0.5: keep the status a CovenantResult had before its latest evaluation.
-- A FAIL -> NOT_TESTED -> FAIL sequence is the same known breach re-appearing,
-- not a new one — the alert logic reads this to avoid re-alerting known breaches.
ALTER TABLE "CovenantResult" ADD COLUMN "previousStatus" TEXT;
