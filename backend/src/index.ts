import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { logger } from './logger';
import { generalLimiter, errorHandler, notFoundHandler } from './middleware/error';
import authRoutes from './routes/auth';
import workspaceRoutes from './routes/workspaces';
import collectionRoutes from './routes/collections';
import documentRoutes from './routes/documents';
import searchRoutes from './routes/search';
import conversationRoutes from './routes/conversations';
import extractionRoutes from './routes/extraction';
import questionnaireRoutes from './routes/questionnaires';
import analyticsRoutes from './routes/analytics';
import borrowerRoutes from './routes/borrowers';
import dashboardRoutes from './routes/dashboard';
import notificationRoutes from './routes/notifications';
import covenantRoutes from './routes/covenants';
import qualityRoutes from './routes/quality';
import inboundEmailRoutes from './routes/inboundEmail';
import dataroomRoutes from './routes/dataroom';

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

// ── API routes ────────────────────────────────────────────────────
app.use('/api/auth', generalLimiter, authRoutes);
app.use('/api/workspaces', generalLimiter, workspaceRoutes);
app.use('/api/workspaces/:workspaceId/collections', generalLimiter, collectionRoutes);
app.use('/api/workspaces/:workspaceId/documents', generalLimiter, documentRoutes);
app.use('/api/workspaces/:workspaceId/search', generalLimiter, searchRoutes);
app.use('/api', generalLimiter, conversationRoutes);
app.use('/api', generalLimiter, extractionRoutes);
app.use('/api', generalLimiter, questionnaireRoutes);
app.use('/api', generalLimiter, analyticsRoutes);
app.use('/api', generalLimiter, borrowerRoutes);
app.use('/api', generalLimiter, dataroomRoutes);
app.use('/api', generalLimiter, covenantRoutes);
app.use('/api', generalLimiter, qualityRoutes);
app.use('/api', generalLimiter, dashboardRoutes);
app.use('/api/notifications', generalLimiter, notificationRoutes);
// Inbound email webhook — unauthenticated (called by the email provider),
// protected by the shared INBOUND_EMAIL_WEBHOOK_SECRET instead.
app.use('/api/inbound-email', generalLimiter, inboundEmailRoutes);

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
