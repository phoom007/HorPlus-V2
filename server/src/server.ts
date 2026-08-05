import 'dotenv/config';
import http from 'http';
import { cleanupService } from './services/cleanup.service.js';
import { createApp } from './app.js';
import { validateEnv, redactSecrets } from './config/env.js';
import { logger } from './config/logger.js';
import { disconnectPrisma, checkDatabaseConnection } from './db/prisma.js';
import { disconnectRedis, checkRedisConnection, connectRedis } from './db/redis.js';

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
  await connectRedis().catch(() => { /* handled by checkRedisConnection failure log */ });
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

  const host = process.env.HOST || '0.0.0.0';
  // Start cleanup service
  cleanupService.startHourly();

  server.listen(env.PORT, host, () => {
    logger.info({ port: env.PORT, host, environment: env.NODE_ENV }, `HorPlus API server listening on ${host}:${env.PORT}`);
  });

  server.on('error', async (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Fatal: Port ${env.PORT} is already in use. Please ensure no other backend instance is running.`);
      try {
        await disconnectPrisma();
        await disconnectRedis();
      } catch (cleanupErr) {
        logger.error({ err: cleanupErr }, 'Error during EADDRINUSE cleanup.');
      }
      process.exit(1);
    } else {
      logger.error({ err }, 'Server encountered an unexpected error.');
    }
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
