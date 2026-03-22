import Database from 'better-sqlite3';
import { up } from '../../src/database/migrations/001_initial_schema';
import { RotationRepository } from '../../src/database/repositories/RotationRepository';
import { KeyRepository } from '../../src/database/repositories/KeyRepository';
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

describe('RotationRepository', () => {
  let db: Database.Database;
  let rotationRepo: RotationRepository;
  let keyRepo: KeyRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    up(db);
    rotationRepo = new RotationRepository(db);
    keyRepo = new KeyRepository(db);

    // Create keys referenced by rotation records
    insertTestKey(keyRepo, 'old-key-1');
    insertTestKey(keyRepo, 'new-key-1');
    insertTestKey(keyRepo, 'old-key-2');
    insertTestKey(keyRepo, 'new-key-2');
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates a rotation record and returns it', () => {
      const record = rotationRepo.create({
        oldKeyId: 'old-key-1',
        newKeyId: 'new-key-1',
        reason: 'scheduled rotation',
        rotatedBy: 'admin',
        oldKeyValidUntil: new Date(Date.now() + 60000).toISOString(),
      });

      expect(record.id).toBeDefined();
      expect(record.oldKeyId).toBe('old-key-1');
      expect(record.newKeyId).toBe('new-key-1');
      expect(record.reason).toBe('scheduled rotation');
      expect(record.rotatedBy).toBe('admin');
      expect(record.rotatedAt).toBeDefined();
    });

    it('auto-increments IDs', () => {
      const r1 = rotationRepo.create({
        oldKeyId: 'old-key-1',
        newKeyId: 'new-key-1',
        reason: 'first',
        rotatedBy: 'admin',
        oldKeyValidUntil: new Date().toISOString(),
      });
      const r2 = rotationRepo.create({
        oldKeyId: 'old-key-2',
        newKeyId: 'new-key-2',
        reason: 'second',
        rotatedBy: 'admin',
        oldKeyValidUntil: new Date().toISOString(),
      });
      expect(r2.id).toBe(r1.id + 1);
    });

    it('enforces foreign key constraint on old_key_id', () => {
      expect(() =>
        rotationRepo.create({
          oldKeyId: 'nonexistent-key',
          newKeyId: 'new-key-1',
          reason: 'test',
          rotatedBy: 'admin',
          oldKeyValidUntil: new Date().toISOString(),
        })
      ).toThrow();
    });

    it('enforces foreign key constraint on new_key_id', () => {
      expect(() =>
        rotationRepo.create({
          oldKeyId: 'old-key-1',
          newKeyId: 'nonexistent-key',
          reason: 'test',
          rotatedBy: 'admin',
          oldKeyValidUntil: new Date().toISOString(),
        })
      ).toThrow();
    });
  });

  describe('findById', () => {
    it('returns record by ID', () => {
      const created = rotationRepo.create({
        oldKeyId: 'old-key-1',
        newKeyId: 'new-key-1',
        reason: 'test',
        rotatedBy: 'admin',
        oldKeyValidUntil: new Date().toISOString(),
      });

      const found = rotationRepo.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.reason).toBe('test');
    });

    it('returns null for non-existent ID', () => {
      expect(rotationRepo.findById(99999)).toBeNull();
    });
  });

  describe('findByKeyId', () => {
    beforeEach(() => {
      rotationRepo.create({
        oldKeyId: 'old-key-1',
        newKeyId: 'new-key-1',
        reason: 'rotation 1',
        rotatedBy: 'admin',
        oldKeyValidUntil: new Date().toISOString(),
      });
    });

    it('returns records where key is the old key', () => {
      const records = rotationRepo.findByKeyId('old-key-1');
      expect(records).toHaveLength(1);
      expect(records[0].oldKeyId).toBe('old-key-1');
    });

    it('returns records where key is the new key', () => {
      const records = rotationRepo.findByKeyId('new-key-1');
      expect(records).toHaveLength(1);
      expect(records[0].newKeyId).toBe('new-key-1');
    });

    it('returns empty for non-existent key', () => {
      const records = rotationRepo.findByKeyId('no-such-key');
      expect(records).toEqual([]);
    });

    it('orders by rotated_at DESC', () => {
      rotationRepo.create({
        oldKeyId: 'old-key-2',
        newKeyId: 'new-key-2',
        reason: 'rotation 2',
        rotatedBy: 'admin',
        oldKeyValidUntil: new Date().toISOString(),
      });

      // Both rotations involve different keys, so query for one that has multiple
      // Need to create another rotation for old-key-1
      insertTestKey(keyRepo, 'new-key-3');
      rotationRepo.create({
        oldKeyId: 'old-key-1',
        newKeyId: 'new-key-3',
        reason: 'rotation 3',
        rotatedBy: 'admin',
        oldKeyValidUntil: new Date().toISOString(),
      });

      const records = rotationRepo.findByKeyId('old-key-1');
      expect(records).toHaveLength(2);
      for (let i = 0; i < records.length - 1; i++) {
        expect(records[i].rotatedAt >= records[i + 1].rotatedAt).toBe(true);
      }
    });
  });

  describe('list', () => {
    beforeEach(() => {
      rotationRepo.create({
        oldKeyId: 'old-key-1',
        newKeyId: 'new-key-1',
        reason: 'r1',
        rotatedBy: 'admin',
        oldKeyValidUntil: new Date().toISOString(),
      });
      rotationRepo.create({
        oldKeyId: 'old-key-2',
        newKeyId: 'new-key-2',
        reason: 'r2',
        rotatedBy: 'ops-team',
        oldKeyValidUntil: new Date().toISOString(),
      });
    });

    it('returns all records without filters', () => {
      const records = rotationRepo.list();
      expect(records).toHaveLength(2);
    });

    it('filters by keyId (matches old or new)', () => {
      const records = rotationRepo.list({ keyId: 'old-key-1' });
      expect(records).toHaveLength(1);
      expect(records[0].oldKeyId).toBe('old-key-1');
    });

    it('filters by rotatedBy', () => {
      const records = rotationRepo.list({ rotatedBy: 'ops-team' });
      expect(records).toHaveLength(1);
      expect(records[0].reason).toBe('r2');
    });

    it('supports limit and offset', () => {
      const limited = rotationRepo.list({ limit: 1 });
      expect(limited).toHaveLength(1);

      const offset = rotationRepo.list({ offset: 1 });
      expect(offset).toHaveLength(1);
    });

    it('returns empty for no matches', () => {
      const records = rotationRepo.list({ keyId: 'nonexistent-key' });
      expect(records).toEqual([]);
    });
  });

  describe('countByKeyId', () => {
    it('counts rotation records for a key', () => {
      rotationRepo.create({
        oldKeyId: 'old-key-1',
        newKeyId: 'new-key-1',
        reason: 'r1',
        rotatedBy: 'admin',
        oldKeyValidUntil: new Date().toISOString(),
      });

      expect(rotationRepo.countByKeyId('old-key-1')).toBe(1);
      expect(rotationRepo.countByKeyId('new-key-1')).toBe(1);
    });

    it('returns 0 for no records', () => {
      expect(rotationRepo.countByKeyId('no-records-key')).toBe(0);
    });
  });
});
