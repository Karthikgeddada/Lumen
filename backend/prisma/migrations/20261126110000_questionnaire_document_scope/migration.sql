-- Diligence questionnaires can be scoped to selected data-room documents;
-- empty means "answer from all workspace documents".
ALTER TABLE "Questionnaire" ADD COLUMN "documentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];