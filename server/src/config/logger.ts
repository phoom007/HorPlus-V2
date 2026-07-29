import { pino } from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

export const logger = pino({
  level: logLevel,
  formatters: {
    level: (label: string) => ({ severity: label.toUpperCase(), level: label }),
  },
  base: {
    service: 'horplus-api',
    environment: process.env.NODE_ENV || 'development',
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'password',
      'secret',
      'token',
      'DATABASE_URL',
      'REDIS_URL',
    ],
    remove: true,
  },
});
