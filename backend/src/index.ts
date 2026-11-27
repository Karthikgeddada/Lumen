import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { logger } from './logger';
import { generalLimiter, errorHandler, notFoundHandler } from './middleware/error';
import { MOUNTS } from './routes/mounts';

const app = express();

// Behind Render's proxy, honor X-Forwarded-* so rate limiting and req.ip work.
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin(origin, cb) {
      // Health checks / curl have no Origin; browsers always send one.
      if (!origin || config.allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Origin not allowed'));
    },
    credentials: true, // refresh cookie flows cross-site from Vercel
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ── Root: friendly landing for humans hitting the API URL ─────────
app.get('/', (_req, res) => {
  res.json({
    service: 'lumen-api',
    status: 'ok',
    env: config.env,
    ui: config.frontendUrl,
    hint: 'API only — this URL serves no pages. Open the "ui" link for the app.',
    health: '/api/health',
  });
});

// ── Health check (Render + uptime monitors) ────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'lumen-api', env: config.env, uptime: process.uptime() });
});

// ── API routes ── mounted from the single source of truth in routes/mounts.ts
// (same prefixes, same order, same shared rate limiter as before).
for (const { prefix, router } of MOUNTS) app.use(prefix, generalLimiter, router);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  logger.info(`lumen-api listening on :${config.port} (${config.env})`);
});

// Graceful shutdown: stop accepting, let in-flight requests finish.
const shutdown = (signal: string) => {
  logger.info(`${signal} received — shutting down`);
  server.close(() => {
    logger.info('http server closed');
    process.exit(0);
  });
  // Hard exit if something refuses to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
