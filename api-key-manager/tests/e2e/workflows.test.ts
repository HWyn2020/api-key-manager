/**
 * End-to-end tests: Full workflows from HTTP API through database
 * Uses real Express server with in-memory SQLite
 */
import http from 'http';
import { Express } from 'express';
import Database from 'better-sqlite3';
import { createTestApp, startTestServer, stopTestServer, request, authRequest, createBootstrapKey } from '../routes/setup';
import { KeyService } from '../../src/services/keyService';

describe('E2E: Complete API workflows', () => {
  let app: Express;
  let db: Database.Database;
  let keyService: KeyService;
  let server: http.Server;
  let baseUrl: string;
  let authToken: string;

  beforeAll(async () => {
    const ctx = createTestApp();
    app = ctx.app;
    db = ctx.db;
    keyService = ctx.keyService;
    const srv = await startTestServer(app);
    server = srv.server;
    baseUrl = srv.baseUrl;

    // Create a bootstrap key for authentication
    authToken = await createBootstrapKey(keyService, 'e2e-user');
  });

  afterAll(async () => {
    await stopTestServer(server);
    db.close();
  });

  describe('Full key lifecycle via API', () => {
    let keyId: string;
    let plaintext: string;

    it('Step 1: Create API key', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'e2e-test-key',
        scopes: ['read', 'write'],
        expiresInHours: 24,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.plaintext).toBeDefined();
      expect(res.body.data.keyId).toBeDefined();
      expect(res.body.data.status).toBe('active');

      keyId = res.body.data.keyId;
      plaintext = res.body.data.plaintext;
    });

    it('Step 2: Validate the key', async () => {
      const res = await authRequest(baseUrl, 'POST', `/api/keys/${keyId}/validate`, authToken, {
        key: plaintext,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
    });

    it('Step 3: Get key details', async () => {
      const res = await authRequest(baseUrl, 'GET', `/api/keys/${keyId}`, authToken);

      expect(res.status).toBe(200);
      expect(res.body.data.keyId).toBe(keyId);
      expect(res.body.data.keyName).toBe('e2e-test-key');
      expect(res.body.data.scopes).toEqual(['read', 'write']);
      expect(res.body.data.lastUsedAt).not.toBeNull(); // Updated by validate
    });

    it('Step 4: List keys for user', async () => {
      const res = await authRequest(baseUrl, 'GET', '/api/keys', authToken);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.some((k: any) => k.keyId === keyId)).toBe(true);
    });

    it('Step 5: Rotate the key', async () => {
      const res = await authRequest(baseUrl, 'PUT', `/api/keys/${keyId}/rotate`, authToken, {
        reason: 'e2e rotation test',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.oldKey.keyId).toBe(keyId);
      expect(res.body.data.newKey.keyId).not.toBe(keyId);
      expect(res.body.data.plaintext.startsWith('hg_')).toBe(true);

      // Old key should be revoked, new should be active
      expect(res.body.data.oldKey.status).toBe('revoked');
      expect(res.body.data.newKey.status).toBe('active');

      // Update for next steps
      keyId = res.body.data.newKey.keyId;
      plaintext = res.body.data.plaintext;
    });

    it('Step 6: Validate new key works', async () => {
      const res = await authRequest(baseUrl, 'POST', `/api/keys/${keyId}/validate`, authToken, {
        key: plaintext,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
    });

    it('Step 7: View audit trail for key', async () => {
      const res = await authRequest(baseUrl, 'GET', `/api/keys/${keyId}/audit`, authToken);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('Step 8: Revoke the key', async () => {
      const res = await authRequest(baseUrl, 'PUT', `/api/keys/${keyId}/revoke`, authToken, {
        reason: 'e2e test complete',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('revoked');
    });

    it('Step 9: Revoked key fails validation with valid: false', async () => {
      const res = await authRequest(baseUrl, 'POST', `/api/keys/${keyId}/validate`, authToken, {
        key: plaintext,
      });

      // With nullable key_id, validation completes and returns valid: false
      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
    });

    it('Step 10: Revoking again returns 409', async () => {
      const res = await authRequest(baseUrl, 'PUT', `/api/keys/${keyId}/revoke`, authToken, {
        reason: 'double revoke',
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_REVOKED');
    });
  });

  describe('Error handling workflows', () => {
    it('returns 404 for non-existent key ID', async () => {
      const res = await authRequest(baseUrl, 'GET', '/api/keys/does-not-exist', authToken);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for malformed create request', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {});
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing scopes on create', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'key',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for rotate without reason', async () => {
      const create = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'err-key',
        scopes: ['read'],
      });
      const id = create.body.data.keyId;

      const res = await authRequest(baseUrl, 'PUT', `/api/keys/${id}/rotate`, authToken, {});
      expect(res.status).toBe(400);
    });

    it('returns 400 for revoke without reason', async () => {
      const create = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'err-key-2',
        scopes: ['read'],
      });
      const id = create.body.data.keyId;

      const res = await authRequest(baseUrl, 'PUT', `/api/keys/${id}/revoke`, authToken, {});
      expect(res.status).toBe(400);
    });

    it('returns 400 for validate without key field', async () => {
      const create = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'err-key-3',
        scopes: ['read'],
      });
      const id = create.body.data.keyId;

      const res = await authRequest(baseUrl, 'POST', `/api/keys/${id}/validate`, authToken, {});
      expect(res.status).toBe(400);
    });

    it('returns 404 for rotate of non-existent key', async () => {
      const res = await authRequest(baseUrl, 'PUT', '/api/keys/no-such-id/rotate', authToken, {
        reason: 'test',
      });
      expect(res.status).toBe(404);
    });

    it('returns 409 for rotating a revoked key', async () => {
      const create = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'err-key-4',
        scopes: ['read'],
      });
      const id = create.body.data.keyId;

      await authRequest(baseUrl, 'PUT', `/api/keys/${id}/revoke`, authToken, {
        reason: 'revoke first',
      });

      const res = await authRequest(baseUrl, 'PUT', `/api/keys/${id}/rotate`, authToken, {
        reason: 'try rotate after revoke',
      });
      expect(res.status).toBe(409);
    });
  });

  describe('Audit query workflows', () => {
    it('audit logs are generated for key operations', async () => {
      // Create a key
      const create = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'audit-e2e-key',
        scopes: ['read'],
      });
      const keyId = create.body.data.keyId;

      // Query audit for this key
      const res = await authRequest(baseUrl, 'GET', `/api/audit?keyId=${keyId}`, authToken);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.some((e: any) => e.action === 'key.created')).toBe(true);
    });

    it('audit supports pagination', async () => {
      const all = await authRequest(baseUrl, 'GET', '/api/audit', authToken);
      expect(all.status).toBe(200);

      if (all.body.data.length > 1) {
        const page = await authRequest(baseUrl, 'GET', '/api/audit?limit=1&offset=0', authToken);
        expect(page.body.data).toHaveLength(1);
      }
    });
  });

  describe('Key creation with custom options', () => {
    it('creates key with custom rate limits', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'custom-rate-key',
        scopes: ['admin'],
        rateLimit: { windowMs: 30000, maxRequests: 10 },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.rateLimit.windowMs).toBe(30000);
      expect(res.body.data.rateLimit.maxRequests).toBe(10);
    });

    it('creates key with expiration', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'expiring-key',
        scopes: ['read'],
        expiresInHours: 48,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.expiresAt).not.toBeNull();
    });
  });

  describe('Actor ID from authenticated user', () => {
    it('records actor from authenticated user', async () => {
      const create = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'actor-key',
        scopes: ['read'],
      });
      const keyId = create.body.data.keyId;

      const audit = await authRequest(baseUrl, 'GET', `/api/keys/${keyId}/audit`, authToken);
      // Actor should be the authenticated user's userId
      expect(audit.body.data.some((e: any) => e.actorId === 'e2e-user')).toBe(true);
    });
  });

  describe('Health check', () => {
    it('health endpoint is always available without auth', async () => {
      const res = await request(baseUrl, 'GET', '/api/health');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ok');
    });
  });
});
