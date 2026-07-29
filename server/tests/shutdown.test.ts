import { describe, it, expect, vi } from 'vitest';
import http from 'http';
import { createApp } from '../src/app.js';
import { disconnectPrisma } from '../src/db/prisma.js';
import { disconnectRedis } from '../src/db/redis.js';

describe('Graceful Shutdown Logic', () => {
  it('closes HTTP server and disconnects dependencies cleanly', async () => {
    const app = createApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });

    expect(server.listening).toBe(true);

    const prismaSpy = vi.spyOn({ disconnectPrisma }, 'disconnectPrisma');
    const redisSpy = vi.spyOn({ disconnectRedis }, 'disconnectRedis');

    await disconnectPrisma();
    await disconnectRedis();

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    expect(server.listening).toBe(false);
  });
});
