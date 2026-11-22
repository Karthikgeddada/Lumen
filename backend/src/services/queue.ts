import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

// Postgres-backed job queue. Workers claim jobs with
// SELECT … FOR UPDATE SKIP LOCKED — safe with any number of workers.

export type JobType = 'PROCESS_DOCUMENT' | 'RUN_EXTRACTION' | 'DRAFT_QUESTIONNAIRE' | 'RUN_REPORT';

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  opts: { delayMs?: number; maxAttempts?: number } = {},
): Promise<string> {
  const job = await prisma.job.create({
    data: {
      type,
      payload: payload as unknown as object,
      maxAttempts: opts.maxAttempts ?? 3,
      runAt: new Date(Date.now() + (opts.delayMs ?? 0)),
    },
  });
  return job.id;
}

type RawJob = {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
};

// Atomically claim the next runnable job for this worker.
export async function claimJob(workerId: string): Promise<RawJob | null> {
  const rows = await prisma.$queryRaw<RawJob[]>(
    Prisma.sql`UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, "updatedAt" = now()
     WHERE id = (
       SELECT id FROM "Job"
       WHERE status = 'QUEUED' AND "runAt" <= now()
       ORDER BY "runAt" ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, type, payload, attempts, "maxAttempts"`,
  );
  return rows[0] ?? null;
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'DONE', lockedAt: null, lockedBy: null, error: null, updatedAt: new Date() },
  });
}

export async function failJob(jobId: string, error: string): Promise<'RETRY' | 'DEAD'> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return 'DEAD';
  const attempts = job.attempts + 1;
  if (attempts < job.maxAttempts) {
    // exponential backoff: 30s, 60s, 120s …
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'QUEUED',
        attempts,
        error: error.slice(0, 500),
        runAt: new Date(Date.now() + Math.pow(2, attempts) * 30 * 1000),
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      },
    });
    return 'RETRY';
  }
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'FAILED', attempts, error: error.slice(0, 500), lockedAt: null, lockedBy: null, updatedAt: new Date() },
  });
  return 'DEAD';
}

// Crash recovery: release jobs stuck in RUNNING (worker died mid-flight).
export async function requeueStaleJobs(staleMinutes = 15): Promise<void> {
  await prisma.job.updateMany({
    where: {
      status: 'RUNNING',
      lockedAt: { lt: new Date(Date.now() - staleMinutes * 60 * 1000) },
    },
    data: { status: 'QUEUED', lockedAt: null, lockedBy: null },
  });
}

export const newWorkerId = () => `worker-${randomUUID().slice(0, 8)}`;
