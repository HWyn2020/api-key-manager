import Database from 'better-sqlite3';
import { up } from '../../src/database/migrations/001_initial_schema';
import { AuditRepository } from '../../src/database/repositories/AuditRepository';
import { KeyRepository } from '../../src/database/repositories/KeyRepository';
import { AuditAction } from '../../src/models/AuditLog';
import { encrypt, generateApiKey, generateKeyPrefix } from '../../src/services/encryptionService';

const TEST_ENC_KEY = '0'.repeat(64);

function insertTestKey(keyRepo: KeyRepository, id: string): void {
  const plaintext = generateApiKey();
  const encrypted = encrypt(plaintext, TEST_ENC_KEY);
  keyRepo.create({
    id,
    userId: 'user-1',
    keyName: 'test-key',
    keyHash: `hash-${id}`,
    keyPrefix: generateKeyPrefix(plaintext),
    encryptedKey: encrypted.encryptedKey,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    scopes: ['read'],
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 100,
    expiresAt: null,
  });
}

describe('AuditRepository', () => {
  let db: Database.Database;
  let auditRepo: AuditRepository;
  let keyRepo: KeyRepository;
  const testKeyId = 'audit-test-key';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    up(db);
    auditRepo = new AuditRepository(db);
    keyRepo = new KeyRepository(db);
    insertTestKey(keyRepo, testKeyId);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates an audit log entry and returns it', () => {
      const entry = auditRepo.create({
        keyId: testKeyId,
        action: AuditAction.KEY_CREATED,
        actorId: 'actor-1',
      });

      expect(entry.id).toBeDefined();
      expect(entry.keyId).toBe(testKeyId);
      expect(entry.action).toBe(AuditAction.KEY_CREATED);
      expect(entry.actorId).toBe('actor-1');
      expect(entry.metadata).toBeNull();
      expect(entry.ipAddress).toBeNull();
      expect(entry.createdAt).toBeDefined();
    });

    it('stores metadata as JSON', () => {
      const entry = auditRepo.create({
        keyId: testKeyId,
        action: AuditAction.KEY_UPDATED,
        actorId: 'actor-1',
        metadata: { reason: 'test', nested: { value: 42 } },
      });

      expect(entry.metadata).toEqual({ reason: 'test', nested: { value: 42 } });
    });

    it('stores IP address', () => {
      const entry = auditRepo.create({
        keyId: testKeyId,
        action: AuditAction.KEY_ACCESSED,
        actorId: 'actor-1',
        ipAddress: '192.168.1.1',
      });

      expect(entry.ipAddress).toBe('192.168.1.1');
    });

    it('auto-increments IDs', () => {
      const e1 = auditRepo.create({
        keyId: testKeyId,
        action: AuditAction.KEY_CREATED,
        actorId: 'a',
      });
      const e2 = auditRepo.create({
        keyId: testKeyId,
        action: AuditAction.KEY_ACCESSED,
        actorId: 'a',
      });
      expect(e2.id).toBe(e1.id + 1);
    });
  });

  describe('findById', () => {
    it('returns entry for existing ID', () => {
      const created = auditRepo.create({
        keyId: testKeyId,
        action: AuditAction.KEY_CREATED,
        actorId: 'actor-1',
      });

      const found = auditRepo.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for non-existent ID', () => {
      expect(auditRepo.findById(99999)).toBeNull();
    });
  });

  describe('findByKeyId', () => {
    it('returns entries for a key', () => {
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_CREATED, actorId: 'a' });
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_ACCESSED, actorId: 'b' });

      const entries = auditRepo.findByKeyId(testKeyId);
      expect(entries).toHaveLength(2);
      entries.forEach(e => expect(e.keyId).toBe(testKeyId));
    });

    it('respects limit parameter', () => {
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_CREATED, actorId: 'a' });
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_ACCESSED, actorId: 'a' });
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_REVOKED, actorId: 'a' });

      const entries = auditRepo.findByKeyId(testKeyId, 2);
      expect(entries).toHaveLength(2);
    });

    it('returns empty for non-existent key', () => {
      // Disable FK checks temporarily so we can query for a key that doesn't exist in api_keys
      const entries = auditRepo.findByKeyId('no-such-key');
      expect(entries).toEqual([]);
    });

    it('orders by created_at DESC', () => {
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_CREATED, actorId: 'a' });
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_ACCESSED, actorId: 'a' });

      const entries = auditRepo.findByKeyId(testKeyId);
      for (let i = 0; i < entries.length - 1; i++) {
        expect(entries[i].createdAt >= entries[i + 1].createdAt).toBe(true);
      }
    });
  });

  describe('list', () => {
    beforeEach(() => {
      const key2 = 'audit-key-2';
      insertTestKey(keyRepo, key2);

      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_CREATED, actorId: 'alice' });
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_ACCESSED, actorId: 'bob' });
      auditRepo.create({ keyId: key2, action: AuditAction.KEY_REVOKED, actorId: 'alice' });
    });

    it('returns all entries without filters', () => {
      const entries = auditRepo.list();
      expect(entries).toHaveLength(3);
    });

    it('filters by keyId', () => {
      const entries = auditRepo.list({ keyId: testKeyId });
      expect(entries).toHaveLength(2);
    });

    it('filters by action', () => {
      const entries = auditRepo.list({ action: AuditAction.KEY_CREATED });
      expect(entries).toHaveLength(1);
    });

    it('filters by actorId', () => {
      const entries = auditRepo.list({ actorId: 'alice' });
      expect(entries).toHaveLength(2);
    });

    it('filters by startDate', () => {
      // Insert an old entry directly
      db.prepare(`
        INSERT INTO audit_logs (key_id, action, actor_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(testKeyId, AuditAction.KEY_EXPIRED, 'system', '2020-01-01T00:00:00.000Z');

      const entries = auditRepo.list({ startDate: '2024-01-01T00:00:00.000Z' });
      expect(entries).toHaveLength(3); // only the 3 from beforeEach
    });

    it('filters by endDate', () => {
      // Insert a future-dated entry directly
      db.prepare(`
        INSERT INTO audit_logs (key_id, action, actor_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(testKeyId, AuditAction.KEY_EXPIRED, 'system', '2099-01-01T00:00:00.000Z');

      const entries = auditRepo.list({ endDate: '2098-01-01T00:00:00.000Z' });
      expect(entries).toHaveLength(3); // excludes the 2099 entry
    });

    it('supports limit and offset', () => {
      const limited = auditRepo.list({ limit: 2 });
      expect(limited).toHaveLength(2);

      const offset = auditRepo.list({ offset: 2 });
      expect(offset).toHaveLength(1);
    });

    it('combines multiple filters', () => {
      const entries = auditRepo.list({
        keyId: testKeyId,
        actorId: 'alice',
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe(AuditAction.KEY_CREATED);
    });
  });

  describe('count', () => {
    it('counts all entries', () => {
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_CREATED, actorId: 'a' });
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_ACCESSED, actorId: 'b' });
      expect(auditRepo.count()).toBe(2);
    });

    it('counts with action filter', () => {
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_CREATED, actorId: 'a' });
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_ACCESSED, actorId: 'a' });
      expect(auditRepo.count({ action: AuditAction.KEY_CREATED })).toBe(1);
    });

    it('counts with keyId filter', () => {
      const key2 = 'count-key-2';
      insertTestKey(keyRepo, key2);
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_CREATED, actorId: 'a' });
      auditRepo.create({ keyId: key2, action: AuditAction.KEY_CREATED, actorId: 'a' });
      expect(auditRepo.count({ keyId: testKeyId })).toBe(1);
    });

    it('counts with actorId filter', () => {
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_CREATED, actorId: 'alice' });
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_CREATED, actorId: 'bob' });
      expect(auditRepo.count({ actorId: 'alice' })).toBe(1);
    });
  });

  describe('deleteOlderThan', () => {
    it('deletes entries older than specified days', () => {
      // Insert old entry
      db.prepare(`
        INSERT INTO audit_logs (key_id, action, actor_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(testKeyId, AuditAction.KEY_CREATED, 'actor', '2020-01-01T00:00:00.000Z');

      // Insert recent entry
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_ACCESSED, actorId: 'actor' });

      const deleted = auditRepo.deleteOlderThan(30);
      expect(deleted).toBe(1);
      expect(auditRepo.count()).toBe(1);
    });

    it('returns 0 when nothing to delete', () => {
      auditRepo.create({ keyId: testKeyId, action: AuditAction.KEY_CREATED, actorId: 'a' });
      expect(auditRepo.deleteOlderThan(30)).toBe(0);
    });
  });
});
