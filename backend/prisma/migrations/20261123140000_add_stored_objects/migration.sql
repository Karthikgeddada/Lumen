-- StoredObject: DB-backed document storage — used when S3/R2 STORAGE_* env
-- vars are absent (STORAGE_DRIVER=db is the automatic default then).
-- Created by hand to match the Prisma schema (schema.prisma model StoredObject).

-- CreateTable
CREATE TABLE "StoredObject" (
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("key")
);