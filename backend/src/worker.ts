import { config } from './config';
import { logger } from './logger';
import { prisma } from './prisma';
import { claimJob, completeJob, failJob, requeueStaleJobs, newWorkerId } from './services/queue';
import { processDocument } from './services/processing';
import { runExtraction } from './services/extract';
import { draftQuestionnaire } from './services/questionnaire';
import { dueReports, runReport } from './analytics/overview';

// Background worker: polls the Postgres job queue and runs document
// processing, extraction runs, questionnaire drafting and scheduled reports.

const WORKER_ID = newWorkerId();
let running = true;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runJob(type: string, payload: Record<string, unknown>): Promise<void> {
  switch (type) {
    case 'PROCESS_DOCUMENT':
      await processDocument(String(payload.documentId));
      return;
    case 'RUN_EXTRACTION':
      await runExtraction(String(payload.taskId));
      return;
    case 'DRAFT_QUESTIONNAIRE':
      await draftQuestionnaire(String(payload.questionnaireId));
      return;
    case 'RUN_REPORT':
      await runReport(String(payload.reportId));
      return;
    default:
      logger.warn({ type }, 'unknown job type');
  }
}

async function tick(): Promise<boolean> {
  const job = await claimJob(WORKER_ID);
  if (!job) return false;

  logger.info({ jobId: job.id, type: job.type, attempt: job.attempts + 1 }, 'job started');
  try {
    await runJob(job.type, (job.payload ?? {}) as Record<string, unknown>);
    await completeJob(job.id);
    logger.info({ jobId: job.id }, 'job done');
  } catch (err) {
    const outcome = await failJob(job.id, err instanceof Error ? err.message : String(err));
    logger.error({ jobId: job.id, outcome, err: String(err) }, 'job failed');
  }
  return true;
}

async function main() {
  logger.info({ workerId: WORKER_ID, env: config.env }, 'lumen-worker started');
  // Startup stale-job requeue: retry until the database answers. A Neon cold
  // start or brief outage at boot must not crash the process (previously an
  // unhandled rejection here crash-looped the whole service).
  for (;;) {
    try {
      await requeueStaleJobs();
      break;
    } catch (err) {
      if (!running) return;
      logger.error({ err: String(err) }, 'startup requeue failed — retrying in 5s');
      await sleep(5000);
    }
  }
  let lastStaleCheck = Date.now();
  let lastReportCheck = Date.now();

  while (running) {
    try {
      const didWork = await tick();
      if (!didWork) await sleep(2000);

      // Every 10 minutes: recover crashed jobs.
      if (Date.now() - lastStaleCheck > 10 * 60 * 1000) {
        await requeueStaleJobs();
        lastStaleCheck = Date.now();
      }
      // Every 5 minutes: run scheduled reports that are due.
      if (Date.now() - lastReportCheck > 5 * 60 * 1000) {
        for (const id of await dueReports()) {
          await runReport(id).catch((e) => logger.error({ err: String(e), id }, 'report failed'));
        }
        lastReportCheck = Date.now();
      }
    } catch (err) {
      logger.error({ err: String(err) }, 'worker tick error — backing off');
      await sleep(5000);
    }
  }

  await prisma.$disconnect();
  logger.info('lumen-worker stopped');
}

process.on('SIGTERM', () => {
  logger.info('SIGTERM — finishing current job and stopping');
  running = false;
});
process.on('SIGINT', () => {
  running = false;
});

void main();
