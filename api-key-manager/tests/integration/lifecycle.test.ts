/**
 * Integration tests: Full key lifecycle flows through service → repository → database
 */
import Database from 'better-sqlite3';
import { up } from '../../src/database/migrations/001_initial_schema';
import { up as up002 } from '../../src/database/migrations/002_nullable_audit_key_id';
import { KeyRepository } from '../../src/database/repositories/KeyRepository';
import { RotationRepository } from '../../src/database/repositories/RotationRepository';
import { AuditRepository } from '../../src/database/repositories/AuditRepository';
import { createKeyService } from '../../src/services/keyService';
import { createAuditService } from '../../src/services/auditService';
import { KeyStatus } from '../../src/models/Key';
import { AuditAction } from '../../src/models/AuditLog';

const TEST_ENC_KEY = '0'.repeat(64);

describe('Integration: Key lifecycle', () => {
  let db: Database.Database;
  let keyRepo: KeyRepository;
  let rotationRepo: RotationRepository;
  let auditRepo: AuditRepository;
  let keyService: ReturnType<typeof createKeyService>;
  let auditService: ReturnType<typeof createAuditService>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
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
    auditService = createAuditService(auditRepo);
  });

  afterEach(() => {
    db.close();
  });

  it('create → validate → rotate → validate new → list → revoke', async () => {
    // 1. Create a key
    const { key: created, plaintext } = await keyService.createKey(
      { userId: 'user-1', keyName: 'lifecycle-key', scopes: ['read', 'write'] },
      'admin',
      '10.0.0.1'
    );
    expect(created.status).toBe(KeyStatus.ACTIVE);
    expect(plaintext.startsWith('hg_')).toBe(true);

    // 2. Validate the key
    const validated = await keyService.validateKey(plaintext, '10.0.0.1');
    expect(validated).not.toBeNull();
    expect(validated!.id).toBe(created.keyId);

    // 3. Rotate the key
    const rotated = await keyService.rotateKey(created.keyId, 'quarterly rotation', 'admin');
    expect(rotated.oldKey.status).toBe(KeyStatus.REVOKED);
    expect(rotated.newKey.status).toBe(KeyStatus.ACTIVE);
    expect(rotated.plaintext.startsWith('hg_')).toBe(true);

    // 4. Old key should no longer validate (findByPrefix filters by ACTIVE + ROTATING only,
    //    so revoked key's prefix returns 0 candidates, and audit log uses keyId: null)
    const oldKeyResult = await keyService.validateKey(plaintext);
    expect(oldKeyResult).toBeNull();

    // 5. New key should validate
    const newValidation = await keyService.validateKey(rotated.plaintext);
    expect(newValidation).not.toBeNull();
    expect(newValidation!.id).toBe(rotated.newKey.keyId);

    // 6. List keys for user
    const keys = await keyService.listKeys('user-1');
    expect(keys).toHaveLength(2); // old (revoked) + new (active)

    // 7. Revoke the new key
    const revoked = await keyService.revokeKey(rotated.newKey.keyId, 'end of life', 'admin');
    expect(revoked.status).toBe(KeyStatus.REVOKED);

    // 8. Revoked key should not validate (returns null with nullable key_id)
    const revokedResult = await keyService.validateKey(rotated.plaintext);
    expect(revokedResult).toBeNull();
  });

  it('audit trail integrity through full lifecycle', async () => {
    // Create
    const { key } = await keyService.createKey(
      { userId: 'user-1', keyName: 'audit-trail-test', scopes: ['read'] },
      'admin'
    );

    // Validate (triggers KEY_ACCESSED)
    const { plaintext } = await keyService.createKey(
      { userId: 'user-1', keyName: 'validate-test', scopes: ['read'] },
      'admin'
    );
    await keyService.validateKey(plaintext);

    // Rotate
    await keyService.rotateKey(key.keyId, 'security policy', 'admin');

    // Check audit logs for the first key
    const logs = auditService.getKeyHistory(key.keyId);
    const actions = logs.map(l => l.action);
    expect(actions).toContain(AuditAction.KEY_CREATED);
    expect(actions).toContain(AuditAction.KEY_ROTATED);
  });

  it('rotation with grace period keeps both keys temporarily active', async () => {
    const { key, plaintext: oldPlaintext } = await keyService.createKey(
      { userId: 'user-1', keyName: 'grace-test', scopes: ['read'] },
      'admin'
    );

    // Rotate with 1-hour grace period
    const result = await keyService.rotateKey(
      key.keyId,
      'graceful rotation',
      'admin',
      3600000 // 1 hour
    );

    // Old key should be in ROTATING status (not revoked)
    expect(result.oldKey.status).toBe(KeyStatus.ROTATING);
    expect(result.newKey.status).toBe(KeyStatus.ACTIVE);

    // Rotation history should be created
    const history = rotationRepo.findByKeyId(key.keyId);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].reason).toBe('graceful rotation');
  });

  it('data consistency: key repo and audit repo stay in sync', async () => {
    const { key: key1 } = await keyService.createKey(
      { userId: 'user-1', keyName: 'sync-1', scopes: ['read'] },
      'admin'
    );
    const { key: key2 } = await keyService.createKey(
      { userId: 'user-1', keyName: 'sync-2', scopes: ['write'] },
      'admin'
    );

    await keyService.revokeKey(key1.keyId, 'test', 'admin');

    // Count keys in repo
    const totalKeys = keyRepo.count({ userId: 'user-1' });
    expect(totalKeys).toBe(2);

    const activeKeys = keyRepo.count({ userId: 'user-1', status: KeyStatus.ACTIVE });
    expect(activeKeys).toBe(1);

    // Audit logs should have entries for each key
    const key1Logs = auditRepo.findByKeyId(key1.keyId);
    const key1Actions = key1Logs.map(l => l.action);
    expect(key1Actions).toContain(AuditAction.KEY_CREATED);
    expect(key1Actions).toContain(AuditAction.KEY_REVOKED);

    const key2Logs = auditRepo.findByKeyId(key2.keyId);
    expect(key2Logs.some(l => l.action === AuditAction.KEY_CREATED)).toBe(true);
  });

  it('expiration flow: create with TTL → expire → verify status', async () => {
    const { key } = await keyService.createKey(
      { userId: 'user-1', keyName: 'expire-test', scopes: ['read'], expiresInHours: 1 },
      'admin'
    );
    expect(key.expiresAt).not.toBeNull();

    // Manually set expiration to past
    db.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      key.keyId
    );

    const count = await keyService.expireKeys();
    expect(count).toBe(1);

    const expired = await keyService.getKey(key.keyId);
    expect(expired!.status).toBe(KeyStatus.EXPIRED);

    // Audit should have an expiration entry
    const logs = auditRepo.findByKeyId(key.keyId);
    expect(logs.some(l => l.action === AuditAction.KEY_EXPIRED)).toBe(true);
  });

  it('multiple users have independent key spaces', async () => {
    await keyService.createKey(
      { userId: 'alice', keyName: 'key-a1', scopes: ['read'] },
      'admin'
    );
    await keyService.createKey(
      { userId: 'alice', keyName: 'key-a2', scopes: ['write'] },
      'admin'
    );
    await keyService.createKey(
      { userId: 'bob', keyName: 'key-b1', scopes: ['read'] },
      'admin'
    );

    const aliceKeys = await keyService.listKeys('alice');
    expect(aliceKeys).toHaveLength(2);

    const bobKeys = await keyService.listKeys('bob');
    expect(bobKeys).toHaveLength(1);
  });

  it('concurrent key creation produces unique keys', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      keyService.createKey(
        { userId: 'user-1', keyName: `concurrent-${i}`, scopes: ['read'] },
        'admin'
      )
    );

    const results = await Promise.all(promises);
    const keyIds = results.map(r => r.key.keyId);
    const plaintexts = results.map(r => r.plaintext);

    // All IDs should be unique
    expect(new Set(keyIds).size).toBe(10);
    // All plaintexts should be unique
    expect(new Set(plaintexts).size).toBe(10);
  });
});
