import Database from 'better-sqlite3';
import { up } from '../../src/database/migrations/001_initial_schema';
import { up as up002 } from '../../src/database/migrations/002_nullable_audit_key_id';
import { KeyRepository } from '../../src/database/repositories/KeyRepository';
import { RotationRepository } from '../../src/database/repositories/RotationRepository';
import { AuditRepository } from '../../src/database/repositories/AuditRepository';
import { createKeyService } from '../../src/services/keyService';
import { compareKey } from '../../src/services/encryptionService';
import { KeyStatus } from '../../src/models/Key';
import { AuditAction } from '../../src/models/AuditLog';

const TEST_ENC_KEY = '0'.repeat(64);

describe('keyService', () => {
  let db: Database.Database;
  let keyRepo: KeyRepository;
  let rotationRepo: RotationRepository;
  let auditRepo: AuditRepository;
  let keyService: ReturnType<typeof createKeyService>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');
    up(db);
    up002(db);
    keyRepo = new KeyRepository(db);
    rotationRepo = new RotationRepository(db);
    auditRepo = new AuditRepository(db);
    keyService = createKeyService({
      keyRepo,
      rotationRepo,
      auditRepo,
      encryptionKey: TEST_ENC_KEY,
      db,
    });
  });

  afterEach(() => {
    db.close();
  });

  // Helper
  async function createTestKey(overrides: Record<string, unknown> = {}) {
    return keyService.createKey(
      {
        userId: 'user-1',
        keyName: 'test-key',
        scopes: ['read', 'write'],
        ...overrides,
      },
      'actor-1',
      '127.0.0.1'
    );
  }

  describe('createKey', () => {
    it('returns key response and plaintext starting with hg_', async () => {
      const { key, plaintext } = await createTestKey();
      expect(plaintext.startsWith('hg_')).toBe(true);
      expect(key.keyId).toBeDefined();
      expect(key.keyName).toBe('test-key');
      expect(key.scopes).toEqual(['read', 'write']);
      expect(key.status).toBe(KeyStatus.ACTIVE);
    });

    it('plaintext key can be validated', async () => {
      const { plaintext } = await createTestKey();
      const entity = await keyService.validateKey(plaintext);
      expect(entity).not.toBeNull();
      expect(entity!.userId).toBe('user-1');
    });

    it('creates audit log entry', async () => {
      const { key } = await createTestKey();
      const logs = auditRepo.findByKeyId(key.keyId);
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const createLog = logs.find((l) => l.action === AuditAction.KEY_CREATED);
      expect(createLog).toBeDefined();
      expect(createLog!.actorId).toBe('actor-1');
    });

    it('with custom scopes and rate limits', async () => {
      const { key } = await createTestKey({
        scopes: ['admin'],
        rateLimit: { windowMs: 30000, maxRequests: 50 },
      });
      expect(key.scopes).toEqual(['admin']);
      expect(key.rateLimit).toEqual({ windowMs: 30000, maxRequests: 50 });
    });

    it('with expiration', async () => {
      const { key } = await createTestKey({ expiresInHours: 1 });
      expect(key.expiresAt).not.toBeNull();
      const expiresAt = new Date(key.expiresAt!).getTime();
      const expectedMin = Date.now() + 55 * 60 * 1000; // allow 5 min slack
      expect(expiresAt).toBeGreaterThan(expectedMin);
    });
  });

  describe('validateKey', () => {
    it('valid key returns entity', async () => {
      const { plaintext } = await createTestKey();
      const entity = await keyService.validateKey(plaintext);
      expect(entity).not.toBeNull();
      expect(entity!.status).toBe(KeyStatus.ACTIVE);
    });

    it('invalid key returns null', async () => {
      const entity = await keyService.validateKey('hg_nonexistentkey12345678');
      expect(entity).toBeNull();
    });

    it('expired key returns null', async () => {
      const { key } = await createTestKey({ expiresInHours: 1 });
      // Manually set expiration to past
      db.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').run(
        '2020-01-01T00:00:00.000Z',
        key.keyId
      );
      const { plaintext: plaintext2 } = await createTestKey();
      // Create a new key, then expire it
      db.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').run(
        '2020-01-01T00:00:00.000Z',
        (await keyService.getKey(key.keyId))?.keyId
      );

      // Use the first expired key's plaintext - we need to re-create for this test
      // Actually let's create a fresh key and expire it properly
      const { plaintext, key: freshKey } = await keyService.createKey(
        { userId: 'user-1', keyName: 'expire-test', scopes: ['read'], expiresInHours: 1 },
        'actor-1'
      );
      db.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').run(
        '2020-01-01T00:00:00.000Z',
        freshKey.keyId
      );
      const result = await keyService.validateKey(plaintext);
      expect(result).toBeNull();
    });

    it('revoked key returns null', async () => {
      const { key, plaintext } = await createTestKey();
      await keyService.revokeKey(key.keyId, 'test', 'actor-1');
      const result = await keyService.validateKey(plaintext);
      expect(result).toBeNull();
    });

    it('updates lastUsedAt', async () => {
      const { key, plaintext } = await createTestKey();
      expect(key.lastUsedAt).toBeNull();
      await keyService.validateKey(plaintext);
      const updated = await keyService.getKey(key.keyId);
      expect(updated!.lastUsedAt).not.toBeNull();
    });
  });

  describe('rotateKey', () => {
    it('creates new key and sets old to revoked (no grace period)', async () => {
      const { key: oldKey } = await createTestKey();
      const result = await keyService.rotateKey(oldKey.keyId, 'scheduled', 'actor-1');

      expect(result.newKey.keyId).not.toBe(oldKey.keyId);
      expect(result.plaintext.startsWith('hg_')).toBe(true);
      expect(result.oldKey.status).toBe(KeyStatus.REVOKED);
      expect(result.newKey.status).toBe(KeyStatus.ACTIVE);
    });

    it('with grace period keeps old key as rotating', async () => {
      const { key: oldKey } = await createTestKey();
      const result = await keyService.rotateKey(
        oldKey.keyId,
        'scheduled',
        'actor-1',
        60000 // 60 second grace period
      );

      expect(result.oldKey.status).toBe(KeyStatus.ROTATING);
      expect(result.newKey.status).toBe(KeyStatus.ACTIVE);
    });

    it('throws for non-existent key', async () => {
      await expect(
        keyService.rotateKey('non-existent-id', 'reason', 'actor-1')
      ).rejects.toThrow('Key not found');
    });

    it('throws for already revoked key', async () => {
      const { key } = await createTestKey();
      await keyService.revokeKey(key.keyId, 'test', 'actor-1');
      await expect(
        keyService.rotateKey(key.keyId, 'reason', 'actor-1')
      ).rejects.toThrow('Cannot rotate key');
    });
  });

  describe('revokeKey', () => {
    it('sets status to revoked', async () => {
      const { key } = await createTestKey();
      const revoked = await keyService.revokeKey(key.keyId, 'policy violation', 'actor-1');
      expect(revoked.status).toBe(KeyStatus.REVOKED);
    });

    it('throws for already revoked key', async () => {
      const { key } = await createTestKey();
      await keyService.revokeKey(key.keyId, 'first', 'actor-1');
      await expect(
        keyService.revokeKey(key.keyId, 'second', 'actor-1')
      ).rejects.toThrow('already revoked');
    });

    it('throws for non-existent key', async () => {
      await expect(
        keyService.revokeKey('non-existent-id', 'reason', 'actor-1')
      ).rejects.toThrow('Key not found');
    });
  });

  describe('listKeys', () => {
    it('returns keys for user', async () => {
      await createTestKey({ userId: 'user-1' });
      await createTestKey({ userId: 'user-1' });
      await createTestKey({ userId: 'user-2' });

      const user1Keys = await keyService.listKeys('user-1');
      expect(user1Keys).toHaveLength(2);
      user1Keys.forEach((k) => expect(k.keyName).toBe('test-key'));
    });

    it('filters by status', async () => {
      const { key: key1 } = await createTestKey({ userId: 'user-1' });
      await createTestKey({ userId: 'user-1' });
      await keyService.revokeKey(key1.keyId, 'test', 'actor-1');

      const activeKeys = await keyService.listKeys('user-1', { status: 'active' });
      expect(activeKeys).toHaveLength(1);
      expect(activeKeys[0].status).toBe(KeyStatus.ACTIVE);

      const revokedKeys = await keyService.listKeys('user-1', { status: 'revoked' });
      expect(revokedKeys).toHaveLength(1);
      expect(revokedKeys[0].status).toBe(KeyStatus.REVOKED);
    });
  });

  describe('getKey', () => {
    it('returns key by ID', async () => {
      const { key } = await createTestKey();
      const result = await keyService.getKey(key.keyId);
      expect(result).not.toBeNull();
      expect(result!.keyId).toBe(key.keyId);
      expect(result!.keyName).toBe('test-key');
    });

    it('returns null for non-existent key', async () => {
      const result = await keyService.getKey('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('expireKeys', () => {
    it('expires keys past their expiration date', async () => {
      const { key: key1 } = await createTestKey({ expiresInHours: 1 });
      await createTestKey(); // no expiration

      // Set key1 to expired time
      db.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').run(
        '2020-01-01T00:00:00.000Z',
        key1.keyId
      );

      const count = await keyService.expireKeys();
      expect(count).toBe(1);

      const expired = await keyService.getKey(key1.keyId);
      expect(expired!.status).toBe(KeyStatus.EXPIRED);
    });
  });
});
