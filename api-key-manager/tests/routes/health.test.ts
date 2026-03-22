import http from 'http';
import { Express } from 'express';
import Database from 'better-sqlite3';
import { createTestApp, startTestServer, stopTestServer, request } from './setup';

describe('GET /api/health', () => {
  let app: Express;
  let db: Database.Database;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const ctx = createTestApp();
    app = ctx.app;
    db = ctx.db;
    const srv = await startTestServer(app);
    server = srv.server;
    baseUrl = srv.baseUrl;
  });

  afterAll(async () => {
    await stopTestServer(server);
    db.close();
  });

  it('returns 200 with success: true and status "ok"', async () => {
    const res = await request(baseUrl, 'GET', '/api/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('includes a timestamp field in ISO format', async () => {
    const res = await request(baseUrl, 'GET', '/api/health');

    expect(res.body.data.timestamp).toBeDefined();
    const parsed = Date.parse(res.body.data.timestamp);
    expect(isNaN(parsed)).toBe(false);
  });

  it('does not include an uptime field', async () => {
    const res = await request(baseUrl, 'GET', '/api/health');

    expect(res.body.data.uptime).toBeUndefined();
  });
});
