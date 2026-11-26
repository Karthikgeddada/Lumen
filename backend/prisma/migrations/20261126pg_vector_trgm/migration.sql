-- pgvector + pg_trgm: indexed hybrid retrieval.
--  - emb vector(384): MiniLM embeddings (384 dims) searched with an HNSW
--    cosine index in Postgres instead of JS scoring over rows pulled to the app.
--  - trigram GIN index on text: the keyword ILIKE candidate query was a
--    sequential scan over every chunk — now index-backed.
-- The Json embedding column stays as the write-path source of truth.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "DocumentChunk" ADD COLUMN "emb" vector(384);

-- Backfill existing chunks whose Json embedding matches the model dims
-- (anything with another dimension count is skipped, never errors).
UPDATE "DocumentChunk"
SET "emb" = ("embedding"::text)::vector
WHERE "embedding" IS NOT NULL AND jsonb_array_length("embedding") = 384;

CREATE INDEX "DocumentChunk_emb_hnsw" ON "DocumentChunk" USING hnsw ("emb" vector_cosine_ops);
CREATE INDEX "DocumentChunk_text_trgm" ON "DocumentChunk" USING gin ("text" gin_trgm_ops);