import Database from 'better-sqlite3';
import { up } from '../../src/database/migrations/001_initial_schema';
import { AuditRepository } from '../../src/database/repositories/AuditRepository';
import { KeyRepository } from '../../src/database/repositories/KeyRepository';
import { createAuditService } from '../../src/services/auditService';
import { AuditAction } from '../../src/models/AuditLog';
import { hashKey, encrypt, generateApiKey, generateKeyPrefix } from '../../src/services/encryptionService';

const TEST_ENC_KEY = '0'.repeat(64);

// Helper to create a key in the DB so foreign key constraints are satisfied
function createTestKey(keyRepo: KeyRepository, userId = 'user-1') {
  const plaintext = generateApiKey();
  const keyHash = require('crypto').randomBytes(32).toString('hex'); // fake hash for speed
  const encrypted = encrypt(plaintext, TEST_ENC_KEY);
  const prefix = generateKeyPrefix(plaintext);
  const id = require('crypto').randomUUID();

  return keyRepo.create({
    id,
    userId,
    keyName: 'test-key',
    keyHash,
    keyPrefix: prefix,
    encryptedKey: encrypted.encryptedKey,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    scopes: ['read'],
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 100,
    expiresAt: null,
  });
}

describe('auditService', () => {
  let db: Database.Database;
  let auditRepo: AuditRepository;
  let keyRepo: KeyRepository;
  let auditService: ReturnType<typeof createAuditService>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    up(db);
    auditRepo = new AuditRepository(db);
    keyRepo = new KeyRepository(db);
    auditService = createAuditService(auditRepo);
  });

  afterEach(() => {
    db.close();
  });

  it('log creates an entry and returns it', () => {
    const key = createTestKey(keyRepo);
    const entry = auditService.log({
      keyId: key.id,
      action: AuditAction.KEY_CREATED,
      actorId: 'actor-1',
    });

    expect(entry.id).toBeDefined();
    expect(entry.keyId).toBe(key.id);
    expect(entry.action).toBe(AuditAction.KEY_CREATED);
    expect(entry.actorId).toBe('actor-1');
    expect(entry.createdAt).toBeDefined();
  });

  it('log with metadata serializes correctly', () => {
    const key = createTestKey(keyRepo);
    const entry = auditService.log({
      keyId: key.id,
      action: AuditAction.KEY_UPDATED,
      actorId: 'actor-1',
      metadata: { reason: 'test', count: 42 },
      ipAddress: '127.0.0.1',
    });

    expect(entry.metadata).toEqual({ reason: 'test', count: 42 });
    expect(entry.ipAddress).toBe('127.0.0.1');
  });

  it('getKeyHistory returns entries for a key', () => {
    const key = createTestKey(keyRepo);
    auditService.log({ keyId: key.id, action: AuditAction.KEY_CREATED, actorId: 'a' });
    auditService.log({ keyId: key.id, action: AuditAction.KEY_ACCESSED, actorId: 'a' });
    auditService.log({ keyId: key.id, action: AuditAction.KEY_REVOKED, actorId: 'a' });

    const history = auditService.getKeyHistory(key.id);
    expect(history).toHaveLength(3);
    history.forEach((entry) => expect(entry.keyId).toBe(key.id));
  });

  it('query filters by action and actorId', () => {
    const key = createTestKey(keyRepo);
    auditService.log({ keyId: key.id, action: AuditAction.KEY_CREATED, actorId: 'alice' });
    auditService.log({ keyId: key.id, action: AuditAction.KEY_ACCESSED, actorId: 'bob' });
    auditService.log({ keyId: key.id, action: AuditAction.KEY_CREATED, actorId: 'bob' });

    const byAction = auditService.query({ action: AuditAction.KEY_CREATED });
    expect(byAction).toHaveLength(2);

    const byActor = auditService.query({ actorId: 'bob' });
    expect(byActor).toHaveLength(2);
  });

  it('query filters by date range', () => {
    const key = createTestKey(keyRepo);

    // Insert an entry with a manually set past date
    db.prepare(`
      INSERT INTO audit_logs (key_id, action, actor_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(key.id, AuditAction.KEY_CREATED, 'actor', '2020-01-01T00:00:00.000Z');

    auditService.log({ keyId: key.id, action: AuditAction.KEY_ACCESSED, actorId: 'actor' });

    const results = auditService.query({ startDate: '2024-01-01T00:00:00.000Z' });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe(AuditAction.KEY_ACCESSED);
  });

  it('cleanup deletes old entries and returns count', () => {
    const key = createTestKey(keyRepo);

    // Insert old entries directly
    db.prepare(`
      INSERT INTO audit_logs (key_id, action, actor_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(key.id, AuditAction.KEY_CREATED, 'actor', '2020-01-01T00:00:00.000Z');
    db.prepare(`
      INSERT INTO audit_logs (key_id, action, actor_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(key.id, AuditAction.KEY_ACCESSED, 'actor', '2020-06-01T00:00:00.000Z');

    // Insert a recent entry
    auditService.log({ keyId: key.id, action: AuditAction.KEY_REVOKED, actorId: 'actor' });

    const deleted = auditService.cleanup(30); // 30 days retention
    expect(deleted).toBe(2);

    // Only the recent entry should remain
    const remaining = auditService.getKeyHistory(key.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].action).toBe(AuditAction.KEY_REVOKED);
  });
});
