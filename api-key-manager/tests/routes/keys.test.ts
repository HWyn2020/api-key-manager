import http from 'http';
import { Express } from 'express';
import Database from 'better-sqlite3';
import { KeyService } from '../../src/services/keyService';
import { createTestApp, startTestServer, stopTestServer, authRequest, createBootstrapKey, AuditService } from './setup';

describe('Keys routes', () => {
  let app: Express;
  let db: Database.Database;
  let keyService: KeyService;
  let auditService: AuditService;
  let server: http.Server;
  let baseUrl: string;
  let authToken: string;

  beforeAll(async () => {
    const ctx = createTestApp();
    app = ctx.app;
    db = ctx.db;
    keyService = ctx.keyService;
    auditService = ctx.auditService;
    const srv = await startTestServer(app);
    server = srv.server;
    baseUrl = srv.baseUrl;

    // Create a bootstrap key for authentication
    authToken = await createBootstrapKey(keyService, 'test-user');
  });

  afterAll(async () => {
    await stopTestServer(server);
    db.close();
  });

  // ── POST /api/keys ──────────────────────────────────────────────────

  describe('POST /api/keys', () => {
    it('returns 201 with valid body', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'test-key',
        scopes: ['read', 'write'],
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.keyId).toBeDefined();
      expect(res.body.data.keyName).toBe('test-key');
      expect(res.body.data.scopes).toEqual(['read', 'write']);
    });

    it('returns a plaintext key starting with "hg_"', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'prefix-test',
        scopes: ['read'],
      });

      expect(res.status).toBe(201);
      expect(res.body.data.plaintext).toBeDefined();
      expect(res.body.data.plaintext.startsWith('hg_')).toBe(true);
    });

    it('ignores userId from body and uses authenticated user', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        userId: 'should-be-ignored',
        keyName: 'auth-user-key',
        scopes: ['read'],
      });

      expect(res.status).toBe(201);
      expect(res.body.data.userId).toBe('test-user');
    });

    it('returns 400 when keyName is missing', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        scopes: ['read'],
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when scopes is missing', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'test-key',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when scopes is an empty array', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'test-key',
        scopes: [],
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 401 without auth header', async () => {
      const res = await authRequest(baseUrl, 'POST', '/api/keys', '', {
        keyName: 'no-auth-key',
        scopes: ['read'],
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // ── GET /api/keys ───────────────────────────────────────────────────

  describe('GET /api/keys', () => {
    it('returns 200 with an array of keys for the authenticated user', async () => {
      // Create a key first
      await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'list-test',
        scopes: ['read'],
      });

      const res = await authRequest(baseUrl, 'GET', '/api/keys', authToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('returns keys scoped to the authenticated user only', async () => {
      // Create a key with a different user via service
      await keyService.createKey(
        { userId: 'other-user', keyName: 'other-key', scopes: ['read'] },
        'test'
      );

      const res = await authRequest(baseUrl, 'GET', '/api/keys', authToken);

      expect(res.status).toBe(200);
      // Should not contain keys from other-user
      for (const key of res.body.data) {
        expect(key.userId).toBe('test-user');
      }
    });
  });

  // ── GET /api/keys/:id ──────────────────────────────────────────────

  describe('GET /api/keys/:id', () => {
    it('returns 200 with key data for a valid ID', async () => {
      const createRes = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'get-test',
        scopes: ['admin'],
      });
      const keyId = createRes.body.data.keyId;

      const res = await authRequest(baseUrl, 'GET', `/api/keys/${keyId}`, authToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.keyId).toBe(keyId);
      expect(res.body.data.keyName).toBe('get-test');
    });

    it('returns 404 for a non-existent ID', async () => {
      const res = await authRequest(baseUrl, 'GET', '/api/keys/nonexistent-id-12345', authToken);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when accessing another user\'s key', async () => {
      // Create a key for a different user via service
      const otherResult = await keyService.createKey(
        { userId: 'forbidden-user', keyName: 'forbidden-key', scopes: ['read'] },
        'test'
      );

      const res = await authRequest(baseUrl, 'GET', `/api/keys/${otherResult.key.keyId}`, authToken);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── PUT /api/keys/:id/rotate ───────────────────────────────────────

  describe('PUT /api/keys/:id/rotate', () => {
    it('returns 200 with old key, new key, and new plaintext', async () => {
      const createRes = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'rotate-test',
        scopes: ['read'],
      });
      const keyId = createRes.body.data.keyId;

      const res = await authRequest(baseUrl, 'PUT', `/api/keys/${keyId}/rotate`, authToken, {
        reason: 'scheduled rotation',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.oldKey).toBeDefined();
      expect(res.body.data.newKey).toBeDefined();
      expect(res.body.data.plaintext).toBeDefined();
      expect(res.body.data.plaintext.startsWith('hg_')).toBe(true);
      expect(res.body.data.oldKey.keyId).toBe(keyId);
      expect(res.body.data.newKey.keyId).not.toBe(keyId);
    });

    it('returns 400 without reason', async () => {
      const createRes = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'rotate-no-reason',
        scopes: ['read'],
      });
      const keyId = createRes.body.data.keyId;

      const res = await authRequest(baseUrl, 'PUT', `/api/keys/${keyId}/rotate`, authToken, {});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 for a non-existent key', async () => {
      const res = await authRequest(baseUrl, 'PUT', '/api/keys/nonexistent-key/rotate', authToken, {
        reason: 'does not matter',
      });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── PUT /api/keys/:id/revoke ───────────────────────────────────────

  describe('PUT /api/keys/:id/revoke', () => {
    it('returns 200 when revoking an active key', async () => {
      const createRes = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'revoke-test',
        scopes: ['read'],
      });
      const keyId = createRes.body.data.keyId;

      const res = await authRequest(baseUrl, 'PUT', `/api/keys/${keyId}/revoke`, authToken, {
        reason: 'compromised',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('revoked');
    });

    it('returns 400 without reason', async () => {
      const createRes = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'revoke-no-reason',
        scopes: ['read'],
      });
      const keyId = createRes.body.data.keyId;

      const res = await authRequest(baseUrl, 'PUT', `/api/keys/${keyId}/revoke`, authToken, {});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 409 when revoking an already-revoked key', async () => {
      const createRes = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'revoke-twice',
        scopes: ['read'],
      });
      const keyId = createRes.body.data.keyId;

      // Revoke first time
      await authRequest(baseUrl, 'PUT', `/api/keys/${keyId}/revoke`, authToken, {
        reason: 'first revoke',
      });

      // Revoke second time
      const res = await authRequest(baseUrl, 'PUT', `/api/keys/${keyId}/revoke`, authToken, {
        reason: 'second revoke',
      });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ALREADY_REVOKED');
    });
  });

  // ── POST /api/keys/:id/validate ────────────────────────────────────

  describe('POST /api/keys/:id/validate', () => {
    it('returns valid: true for a valid plaintext key', async () => {
      const createRes = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'validate-test',
        scopes: ['read'],
      });
      const keyId = createRes.body.data.keyId;
      const plaintext = createRes.body.data.plaintext;

      const res = await authRequest(baseUrl, 'POST', `/api/keys/${keyId}/validate`, authToken, {
        key: plaintext,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(true);
    });

    it('returns valid: false for an invalid plaintext key with unknown prefix', async () => {
      const createRes = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'validate-invalid',
        scopes: ['read'],
      });
      const keyId = createRes.body.data.keyId;

      const res = await authRequest(baseUrl, 'POST', `/api/keys/${keyId}/validate`, authToken, {
        key: 'hg_this_is_not_a_real_key_at_all_1234567890',
      });

      // With nullable key_id, validation completes and returns valid: false
      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
    });

    it('validate response does not include keyId', async () => {
      const createRes = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'validate-no-keyid',
        scopes: ['read'],
      });
      const keyId = createRes.body.data.keyId;
      const plaintext = createRes.body.data.plaintext;

      const res = await authRequest(baseUrl, 'POST', `/api/keys/${keyId}/validate`, authToken, {
        key: plaintext,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.keyId).toBeUndefined();
    });

    it('returns 400 when key field is missing from body', async () => {
      const createRes = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'validate-no-key',
        scopes: ['read'],
      });
      const keyId = createRes.body.data.keyId;

      const res = await authRequest(baseUrl, 'POST', `/api/keys/${keyId}/validate`, authToken, {});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ── GET /api/keys/:id/audit ────────────────────────────────────────

  describe('GET /api/keys/:id/audit', () => {
    it('returns audit entries for a key', async () => {
      const createRes = await authRequest(baseUrl, 'POST', '/api/keys', authToken, {
        keyName: 'audit-key-test',
        scopes: ['read'],
      });
      const keyId = createRes.body.data.keyId;

      const res = await authRequest(baseUrl, 'GET', `/api/keys/${keyId}/audit`, authToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      // At minimum there should be a key.created audit entry
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.some((e: any) => e.action === 'key.created')).toBe(true);
    });

    it('returns 404 for a non-existent key', async () => {
      const res = await authRequest(baseUrl, 'GET', '/api/keys/no-such-key-id/audit', authToken);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
