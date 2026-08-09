/**
 * Deterministic Local Fake LINE Platform HTTP Server for Playwright E2E Tests
 * Simulates LINE Messaging API (/v2/bot/info, /v2/bot/profile/:userId, /v2/bot/message/push)
 * @license Apache-2.0
 */

import http from 'http';
import { AddressInfo } from 'net';

export interface FakeLinePushRequest {
  to: string;
  messages: any[];
  retryKey?: string;
  authorization?: string;
}

export class FakeLineServer {
  private server: http.Server | null = null;
  public port: number = 0;
  public baseUrl: string = '';
  public pushRequests: FakeLinePushRequest[] = [];
  public retryTracker: Set<string> = new Set();
  public isWebhookActive: boolean = true;

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = req.url || '';
        const method = req.method?.toUpperCase() || 'GET';
        const auth = req.headers['authorization'];
        const retryKey = req.headers['x-line-retry-key'] as string | undefined;

        let bodyChunks: Buffer[] = [];
        req.on('data', (chunk) => bodyChunks.push(chunk));
        req.on('end', () => {
          const bodyStr = Buffer.concat(bodyChunks).toString('utf-8');
          let bodyObj: any = {};
          try {
            if (bodyStr) bodyObj = JSON.parse(bodyStr);
          } catch { /* ignore */ }

          // POST /oauth2/v3/token
          if (method === 'POST' && url.includes('/oauth2/v3/token')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                access_token: 'fake_stateless_token_e2e_12345',
                token_type: 'Bearer',
                expires_in: 2592000,
              })
            );
            return;
          }

          // GET /v2/bot/info
          if (method === 'GET' && url.includes('/v2/bot/info')) {
            if (!auth || !auth.startsWith('Bearer ')) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Unauthorized' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                userId: 'U_BOT_E2E',
                basicId: '@e2e_bot',
                displayName: 'E2E Bot',
                chatMode: 'chat',
              })
            );
            return;
          }

          // GET /v2/bot/profile/:userId
          if (method === 'GET' && url.includes('/v2/bot/profile/')) {
            const userId = url.split('/v2/bot/profile/')[1];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                displayName: userId === 'U_E2E_FAILURE' ? 'Fail User' : 'Somchai E2E',
                pictureUrl: 'https://profile.line-scdn.net/somchai.png',
              })
            );
            return;
          }

          // POST /v2/bot/message/push
          if (method === 'POST' && url.includes('/v2/bot/message/push')) {
            const to = bodyObj.to || '';
            this.pushRequests.push({
              to,
              messages: bodyObj.messages || [],
              retryKey,
              authorization: auth,
            });

            // U_E2E_FAILURE -> 400 Definitive Failure
            if (to === 'U_E2E_FAILURE') {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Definitive push failure' }));
              return;
            }

            // U_E2E_RETRY -> First 500, Retry with same retryKey -> 409 ALREADY_ACCEPTED
            if (to === 'U_E2E_RETRY') {
              if (retryKey && this.retryTracker.has(retryKey)) {
                res.writeHead(409, {
                  'Content-Type': 'application/json',
                  'x-line-accepted-request-id': 'req_retry_accepted',
                });
                res.end(JSON.stringify({ message: 'Already accepted' }));
                return;
              } else {
                if (retryKey) this.retryTracker.add(retryKey);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Transient LINE error' }));
                return;
              }
            }

            // Default / U_E2E_SUCCESS -> 200 Accepted
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                sentMessages: [{ id: `msg_${Date.now()}` }],
              })
            );
            return;
          }

          // PUT /v2/bot/channel/webhook/endpoint
          if (method === 'PUT' && url.includes('/v2/bot/channel/webhook/endpoint')) {
            if (!auth || !auth.startsWith('Bearer ')) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Unauthorized' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));
            return;
          }

          // GET /v2/bot/channel/webhook/endpoint
          if (method === 'GET' && url.includes('/v2/bot/channel/webhook/endpoint')) {
            if (!auth || !auth.startsWith('Bearer ')) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Unauthorized' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ endpoint: 'https://app.horplus.com/api/v1/line/webhook/test', active: this.isWebhookActive }));
            return;
          }

          // POST /v2/bot/channel/webhook/test
          if (method === 'POST' && url.includes('/v2/bot/channel/webhook/test')) {
            if (!auth || !auth.startsWith('Bearer ')) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Unauthorized' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: this.isWebhookActive,
              timestamp: new Date().toISOString(),
              statusCode: this.isWebhookActive ? 200 : 400,
              reason: this.isWebhookActive ? 'OK' : 'WEBHOOK_INACTIVE',
              detail: this.isWebhookActive ? 'Webhook test succeeded' : 'Webhook test failed: inactive',
            }));
            return;
          }

          // Fallback 404
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Not found' }));
        });
      });

      this.server.listen(5456, '127.0.0.1', () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        this.baseUrl = `http://127.0.0.1:${this.port}`;
        resolve(this.baseUrl);
      });

      this.server.on('error', (err) => reject(err));
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  reset(): void {
    this.pushRequests = [];
    this.retryTracker.clear();
  }
}
