import pino from 'pino';
import { config } from './config';

// Structured JSON logs on Render. Secrets and credentials are redacted.
export const logger = pino({
  level: config.isProd ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'code',
      'token',
      'refreshToken',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.apiKey',
    ],
    censor: '[redacted]',
  },
});
