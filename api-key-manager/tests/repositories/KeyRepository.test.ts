import Database from 'better-sqlite3';
import { up } from '../../src/database/migrations/001_initial_schema';
import { KeyRepository, KeyInsert } from '../../src/database/repositories/KeyRepository';
import { KeyStatus } from '../../src/models/Key';
import { encrypt, generateApiKey, generateKeyPrefix } from '../../src/services/encryptionService';

const TEST_ENC_KEY = '0'.repeat(64);

function makeKeyInsert(overrides: Partial<KeyInsert> = {}): KeyInsert {
  const plaintext = generateApiKey();
  const encrypted = encrypt(plaintext, TEST_ENC_KEY);
  const prefix = generateKeyPrefix(plaintext);
  return {
    id: `key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: 'user-1',
    keyName: 'test-key',
    keyHash: `hash-${Math.random().toString(36).slice(2)}`,
    keyPrefix: prefix,
    encryptedKey: encrypted.encryptedKey,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    scopes: ['read', 'write'],
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 100,
    expiresAt: null,
    ...overrides,
  };
}

describe('KeyRepository', () => {
  let db: Database.Database;
  let repo: KeyRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    up(db);
    repo = new KeyRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('inserts a key and returns the entity', () => {
      const data = makeKeyInsert();
      const entity = repo.create(data);

      expect(entity.id).toBe(data.id);
      expect(entity.userId).toBe('user-1');
      expect(entity.keyName).toBe('test-key');
      expect(entity.scopes).toEqual(['read', 'write']);
      expect(entity.status).toBe(KeyStatus.ACTIVE);
      expect(entity.createdAt).toBeDefined();
    });

    it('stores scopes as JSON', () => {
      const data = makeKeyInsert({ scopes: ['admin', 'read', 'write'] });
      const entity = repo.create(data);
      expect(entity.scopes).toEqual(['admin', 'read', 'write']);
    });

    it('stores rate limit settings', () => {
      const data = makeKeyInsert({ rateLimitWindowMs: 30000, rateLimitMaxRequests: 50 });
      const entity = repo.create(data);
      expect(entity.rateLimit.windowMs).toBe(30000);
      expect(entity.rateLimit.maxRequests).toBe(50);
    });

    it('stores expiration date', () => {
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      const data = makeKeyInsert({ expiresAt });
      const entity = repo.create(data);
      expect(entity.expiresAt).toBe(expiresAt);
    });

    it('throws on duplicate primary key', () => {
      const data = makeKeyInsert({ id: 'dup-key' });
      repo.create(data);
      expect(() => repo.create(data)).toThrow();
    });
  });

  describe('findById', () => {
    it('returns entity for existing key', () => {
      const data = makeKeyInsert({ id: 'find-me' });
      repo.create(data);
      const entity = repo.findById('find-me');
      expect(entity).not.toBeNull();
      expect(entity!.id).toBe('find-me');
    });

    it('returns null for non-existent key', () => {
      const entity = repo.findById('does-not-exist');
      expect(entity).toBeNull();
    });
  });

  describe('findByHash', () => {
    it('returns entity for matching hash', () => {
      const data = makeKeyInsert({ keyHash: 'unique-hash-123' });
      repo.create(data);
      const entity = repo.findByHash('unique-hash-123');
      expect(entity).not.toBeNull();
      expect(entity!.keyHash).toBe('unique-hash-123');
    });

    it('returns null when hash not found', () => {
      const entity = repo.findByHash('nonexistent-hash');
      expect(entity).toBeNull();
    });
  });

  describe('findByPrefix', () => {
    it('returns active entities for matching prefix', () => {
      const data = makeKeyInsert({ keyPrefix: 'abc12345' });
      repo.create(data);
      const entities = repo.findByPrefix('abc12345');
      expect(entities).toHaveLength(1);
      expect(entities[0].keyPrefix).toBe('abc12345');
    });

    it('returns empty array for non-active key with matching prefix', () => {
      const data = makeKeyInsert({ keyPrefix: 'revpfx01' });
      const entity = repo.create(data);
      repo.updateStatus(entity.id, KeyStatus.REVOKED);
      const found = repo.findByPrefix('revpfx01');
      expect(found).toHaveLength(0);
    });

    it('returns empty array when prefix not found', () => {
      const entities = repo.findByPrefix('xxxxxxxx');
      expect(entities).toEqual([]);
    });
  });

  describe('list', () => {
    beforeEach(() => {
      repo.create(makeKeyInsert({ id: 'k1', userId: 'user-a', keyName: 'key-a1' }));
      repo.create(makeKeyInsert({ id: 'k2', userId: 'user-a', keyName: 'key-a2' }));
      repo.create(makeKeyInsert({ id: 'k3', userId: 'user-b', keyName: 'key-b1' }));
    });

    it('returns all keys when no filter', () => {
      const keys = repo.list();
      expect(keys).toHaveLength(3);
    });

    it('filters by userId', () => {
      const keys = repo.list({ userId: 'user-a' });
      expect(keys).toHaveLength(2);
      keys.forEach(k => expect(k.userId).toBe('user-a'));
    });

    it('filters by status', () => {
      repo.updateStatus('k1', KeyStatus.REVOKED);
      const active = repo.list({ status: KeyStatus.ACTIVE });
      expect(active).toHaveLength(2);
      const revoked = repo.list({ status: KeyStatus.REVOKED });
      expect(revoked).toHaveLength(1);
    });

    it('supports limit', () => {
      const keys = repo.list({ limit: 2 });
      expect(keys).toHaveLength(2);
    });

    it('supports offset', () => {
      const all = repo.list();
      const offset = repo.list({ offset: 1 });
      expect(offset).toHaveLength(2);
      expect(offset[0].id).toBe(all[1].id);
    });

    it('combined userId and status filter', () => {
      repo.updateStatus('k1', KeyStatus.REVOKED);
      const keys = repo.list({ userId: 'user-a', status: KeyStatus.ACTIVE });
      expect(keys).toHaveLength(1);
      expect(keys[0].id).toBe('k2');
    });

    it('returns empty array for no matches', () => {
      const keys = repo.list({ userId: 'nonexistent-user' });
      expect(keys).toEqual([]);
    });

    it('orders by created_at DESC', () => {
      const keys = repo.list();
      for (let i = 0; i < keys.length - 1; i++) {
        expect(keys[i].createdAt >= keys[i + 1].createdAt).toBe(true);
      }
    });
  });

  describe('count', () => {
    beforeEach(() => {
      repo.create(makeKeyInsert({ id: 'c1', userId: 'user-a' }));
      repo.create(makeKeyInsert({ id: 'c2', userId: 'user-a' }));
      repo.create(makeKeyInsert({ id: 'c3', userId: 'user-b' }));
    });

    it('returns total count', () => {
      expect(repo.count()).toBe(3);
    });

    it('counts by userId', () => {
      expect(repo.count({ userId: 'user-a' })).toBe(2);
    });

    it('counts by status', () => {
      repo.updateStatus('c1', KeyStatus.REVOKED);
      expect(repo.count({ status: KeyStatus.ACTIVE })).toBe(2);
      expect(repo.count({ status: KeyStatus.REVOKED })).toBe(1);
    });
  });

  describe('updateStatus', () => {
    it('updates status to REVOKED with reason', () => {
      const data = makeKeyInsert({ id: 'revoke-me' });
      repo.create(data);
      const updated = repo.updateStatus('revoke-me', KeyStatus.REVOKED, 'compromised');
      expect(updated).toBe(true);

      const entity = repo.findById('revoke-me')!;
      expect(entity.status).toBe(KeyStatus.REVOKED);
      expect(entity.revokedAt).not.toBeNull();
      expect(entity.revokedReason).toBe('compromised');
    });

    it('updates status to EXPIRED', () => {
      const data = makeKeyInsert({ id: 'expire-me' });
      repo.create(data);
      const updated = repo.updateStatus('expire-me', KeyStatus.EXPIRED);
      expect(updated).toBe(true);

      const entity = repo.findById('expire-me')!;
      expect(entity.status).toBe(KeyStatus.EXPIRED);
    });

    it('updates status to ROTATING', () => {
      const data = makeKeyInsert({ id: 'rotate-me' });
      repo.create(data);
      const updated = repo.updateStatus('rotate-me', KeyStatus.ROTATING);
      expect(updated).toBe(true);

      const entity = repo.findById('rotate-me')!;
      expect(entity.status).toBe(KeyStatus.ROTATING);
    });

    it('returns false for non-existent key', () => {
      const updated = repo.updateStatus('no-such-key', KeyStatus.REVOKED);
      expect(updated).toBe(false);
    });
  });

  describe('updateLastUsed', () => {
    it('updates lastUsedAt timestamp', () => {
      const data = makeKeyInsert({ id: 'use-me' });
      const entity = repo.create(data);
      expect(entity.lastUsedAt).toBeNull();

      repo.updateLastUsed('use-me');
      const updated = repo.findById('use-me')!;
      expect(updated.lastUsedAt).not.toBeNull();
    });

    it('returns false for non-existent key', () => {
      const result = repo.updateLastUsed('no-such-key');
      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes an existing key', () => {
      repo.create(makeKeyInsert({ id: 'del-me' }));
      const deleted = repo.delete('del-me');
      expect(deleted).toBe(true);
      expect(repo.findById('del-me')).toBeNull();
    });

    it('returns false for non-existent key', () => {
      const deleted = repo.delete('no-such-key');
      expect(deleted).toBe(false);
    });
  });

  describe('findExpired', () => {
    it('returns keys past their expiration date', () => {
      repo.create(makeKeyInsert({ id: 'exp1', expiresAt: '2020-01-01T00:00:00.000Z' }));
      repo.create(makeKeyInsert({ id: 'exp2', expiresAt: '2099-01-01T00:00:00.000Z' }));
      repo.create(makeKeyInsert({ id: 'exp3', expiresAt: null }));

      const expired = repo.findExpired();
      expect(expired).toHaveLength(1);
      expect(expired[0].id).toBe('exp1');
    });

    it('does not return non-active expired keys', () => {
      repo.create(makeKeyInsert({ id: 'exp-rev', expiresAt: '2020-01-01T00:00:00.000Z' }));
      repo.updateStatus('exp-rev', KeyStatus.REVOKED);

      const expired = repo.findExpired();
      expect(expired).toHaveLength(0);
    });
  });

  describe('expireKeys', () => {
    it('marks expired active keys as expired', () => {
      repo.create(makeKeyInsert({ id: 'e1', expiresAt: '2020-01-01T00:00:00.000Z' }));
      repo.create(makeKeyInsert({ id: 'e2', expiresAt: '2020-06-01T00:00:00.000Z' }));
      repo.create(makeKeyInsert({ id: 'e3', expiresAt: '2099-01-01T00:00:00.000Z' }));

      const count = repo.expireKeys();
      expect(count).toBe(2);

      expect(repo.findById('e1')!.status).toBe(KeyStatus.EXPIRED);
      expect(repo.findById('e2')!.status).toBe(KeyStatus.EXPIRED);
      expect(repo.findById('e3')!.status).toBe(KeyStatus.ACTIVE);
    });

    it('returns 0 when no keys to expire', () => {
      repo.create(makeKeyInsert({ id: 'no-exp', expiresAt: null }));
      expect(repo.expireKeys()).toBe(0);
    });
  });

  describe('revokeKey', () => {
    it('revokes a key with reason', () => {
      repo.create(makeKeyInsert({ id: 'rk1' }));
      const revoked = repo.revokeKey('rk1', 'policy violation');
      expect(revoked).toBe(true);

      const entity = repo.findById('rk1')!;
      expect(entity.status).toBe(KeyStatus.REVOKED);
      expect(entity.revokedReason).toBe('policy violation');
    });
  });

  describe('createWithTransaction', () => {
    it('creates a key within a transaction', () => {
      const data = makeKeyInsert({ id: 'txn-key' });
      const entity = repo.createWithTransaction(data);
      expect(entity.id).toBe('txn-key');
      expect(repo.findById('txn-key')).not.toBeNull();
    });
  });
});
