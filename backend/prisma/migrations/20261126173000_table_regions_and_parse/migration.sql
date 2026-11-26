-- Item B: PDF tables, regions and the parse sidecar. All additive; safe to
-- auto-apply on boot. Existing rows keep their defaults (no rewrites).

-- PDFs that fell back to pdf-parse (sidecar unreachable): tables/bboxes
-- missing — disclosed in the UI and in extraction flag reasons.
ALTER TABLE "Document" ADD COLUMN "tablesUnavailable" BOOLEAN NOT NULL DEFAULT false;

-- Table geometry from the Python sidecar (PDF only; null elsewhere).
ALTER TABLE "DocumentTable"
  ADD COLUMN "pageWidth" DOUBLE PRECISION,
  ADD COLUMN "pageHeight" DOUBLE PRECISION,
  ADD COLUMN "bbox" JSONB,
  ADD COLUMN "contextAbove" JSONB;

-- Evidence geometry per chunk: PDF {page,bbox}[] | DOCX {paragraph} |
-- XLSX {sheet,range} | TXT {startLine,endLine}. Backfilled on retry/reprocess.
ALTER TABLE "DocumentChunk" ADD COLUMN "regions" JSONB;

-- Evidence bbox for extraction results (PDF cell/row rectangle).
ALTER TABLE "ExtractionResult" ADD COLUMN "bbox" JSONB;
