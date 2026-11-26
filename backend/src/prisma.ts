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

// Keep-alive: Neon's free tier suspends its Postgres compute after a few
// idle minutes, and the wake-up adds seconds to the next query. A cheap
// SELECT 1 every 4 minutes counts as activity and keeps the compute (and
// the Prisma connection pool) warm. Harmless on any provider. unref() so
// it never blocks process shutdown.
if (config.isProd) {
  const ping = () => {
    prisma.$queryRaw`SELECT 1`.catch(() => {});
  };
  ping();
  setInterval(ping, 4 * 60_000).unref();
}
