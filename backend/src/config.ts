import dotenv from 'dotenv';
dotenv.config();

const num = (v: string | undefined, d: number) => (v ? parseInt(v, 10) : d);

const databaseUrl = process.env.DATABASE_URL || '';
const authSecret = process.env.AUTH_SECRET || '';

if (!databaseUrl) throw new Error('Missing required env DATABASE_URL');
if (!authSecret) throw new Error('Missing required env AUTH_SECRET');

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: num(process.env.PORT, 4000),
  databaseUrl,
  authSecret,

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  mail: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.MAIL_FROM || 'Lumen <no-reply@localhost>',
    devMode: process.env.MAIL_DEV_MODE === 'true',
  },

  ai: {
    apiKey: process.env.AI_PROVIDER_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    chatModel: process.env.AI_CHAT_MODEL || 'gpt-4o-mini',
    // 'local' = run an open-source embedding model in-process (transformers.js)
    embeddingBaseUrl: process.env.AI_EMBEDDING_BASE_URL || '',
    embeddingModel: process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small',
    // Every provider HTTP call aborts after this long (default 60 s) so a hung
    // upstream can never pin an API request or a worker job.
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 60_000),
  },

  storage: {
    // 's3' forces the S3/R2 client; 'db' stores files in Postgres itself;
    // default: S3 when STORAGE_* vars are set, otherwise db (zero-config).
    driver: process.env.STORAGE_DRIVER || '',
    endpoint: process.env.STORAGE_ENDPOINT || '',
    region: process.env.STORAGE_REGION || 'us-east-1',
    bucket: process.env.STORAGE_BUCKET || '',
    accessKey: process.env.STORAGE_ACCESS_KEY || '',
    secretKey: process.env.STORAGE_SECRET_KEY || '',
  },

  parse: {
    // Python parser wiring (read directly by services/pipelineClient.ts):
    // PDF/DOCX/XLSX/CSV parse in-process by default — the worker spawns
    // python-pipelines/parse_once.py (LUMEN_PYTHON_BIN; on Render the
    // build-time venv). PARSE_SERVICE_URL is the optional escape hatch that
    // routes to a remote sidecar instead; on any Python failure the JS
    // parsers run and the document is honestly marked tablesUnavailable —
    // never a silent quality drop.
    serviceUrl: process.env.PARSE_SERVICE_URL || '',
    token: process.env.PIPELINES_TOKEN || '',
  },

  maxUploadBytes: num(process.env.MAX_UPLOAD_MB, 500) * 1024 * 1024,

  // Access token: short-lived, kept in memory on the client.
  accessTokenTtlSec: 15 * 60,
  // Refresh token: 30 days when "keep me signed in", else 12 hours.
  refreshLongTtlMs: 30 * 24 * 60 * 60 * 1000,
  refreshShortTtlMs: 12 * 60 * 60 * 1000,
} as const;

export const hasAI = () => Boolean(config.ai.apiKey);
export const hasStorage = () =>
  Boolean(config.storage.bucket && config.storage.accessKey && config.storage.secretKey);
