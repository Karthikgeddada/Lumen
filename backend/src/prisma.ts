import { PrismaClient } from '@prisma/client';
import { config } from './config';

// Prisma returns BigInt columns (Workspace.storageUsedBytes, Document.sizeBytes)
// as BigInt, which JSON.stringify cannot serialize — sign-in and any listing that
// includes them would 500. Coerce BigInts to plain numbers in JSON responses
// (safe here: these byte counts sit far below Number.MAX_SAFE_INTEGER).
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function toJSON() {
  return Number(this);
};

export const prisma = new PrismaClient({
  log: config.isProd ? ['error', 'warn'] : ['error', 'warn'],
});
