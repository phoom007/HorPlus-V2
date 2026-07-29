import http from 'http';
import { createApp } from './app.js';
import { validateEnv, redactSecrets } from './config/env.js';
import { logger } from './config/logger.js';
import { disconnectPrisma, checkDatabaseConnection } from './db/prisma.js';
import { disconnectRedis, checkRedisConnection } from './db/redis.js';

async function startServer() {
  let env;
  try {
    env = validateEnv(process.env);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('Fatal: Environment validation error:', err.message);
    process.exit(1);
  }

  logger.info({ config: redactSecrets(env as Record<string, unknown>) }, 'Environment validated successfully. Starting HorPlus API server...');

  // Pre-flight connection checks (non-blocking log warning if down on boot)
  const [dbOk, redisOk] = await Promise.all([
    checkDatabaseConnection(),
    checkRedisConnection(),
  ]);

  if (!dbOk) {
    logger.warn('Database connection check returned DOWN on server startup.');
  }
  if (!redisOk) {
    logger.warn('Redis connection check returned DOWN on server startup.');
  }

  const app = createApp();
  const server = http.createServer(app);

  server.listen(env.PORT, '0.0.0.0', () => {
    logger.info({ port: env.PORT, environment: env.NODE_ENV }, `HorPlus API server listening on 0.0.0.0:${env.PORT}`);
  });

  let isShuttingDown = false;

  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, `Received ${signal}. Initiating graceful shutdown...`);

    const timeout = setTimeout(() => {
      logger.error('Shutdown timeout reached. Forcing process termination.');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);

    server.close(async () => {
      logger.info('HTTP server closed. Cleaning up dependencies...');
      try {
        await disconnectPrisma();
        await disconnectRedis();
        logger.info('All connections closed cleanly. Process exiting.');
        clearTimeout(timeout);
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during graceful shutdown cleanup.');
        clearTimeout(timeout);
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer();
