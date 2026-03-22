import Database from 'better-sqlite3';
import { ApiKeyRow, ApiKeyEntity, KeyStatus, rowToEntity } from '../../models/Key';
import { withTransaction } from '../connection';

export interface KeyInsert {
  id: string;
  userId: string;
  keyName: string;
  keyHash: string;
  keyPrefix: string;
  encryptedKey: string;
  iv: string;
  authTag: string;
  scopes: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  expiresAt: string | null;
}

export interface KeyListOptions {
  userId?: string;
  status?: KeyStatus;
  limit?: number;
  offset?: number;
}

export class KeyRepository {
  constructor(private db: Database.Database) {}

  create(data: KeyInsert): ApiKeyEntity {
    const stmt = this.db.prepare(`
      INSERT INTO api_keys (
        id, user_id, key_name, key_hash, key_prefix,
        encrypted_key, iv, auth_tag, scopes, status,
        rate_limit_window_ms, rate_limit_max_requests, expires_at
      ) VALUES (
        @id, @userId, @keyName, @keyHash, @keyPrefix,
        @encryptedKey, @iv, @authTag, @scopes, 'active',
        @rateLimitWindowMs, @rateLimitMaxRequests, @expiresAt
      )
    `);

    stmt.run({
      id: data.id,
      userId: data.userId,
      keyName: data.keyName,
      keyHash: data.keyHash,
      keyPrefix: data.keyPrefix,
      encryptedKey: data.encryptedKey,
      iv: data.iv,
      authTag: data.authTag,
      scopes: JSON.stringify(data.scopes),
      rateLimitWindowMs: data.rateLimitWindowMs,
      rateLimitMaxRequests: data.rateLimitMaxRequests,
      expiresAt: data.expiresAt,
    });

    return this.findById(data.id)!;
  }

  findById(id: string): ApiKeyEntity | null {
    const row = this.db.prepare(
      'SELECT * FROM api_keys WHERE id = ?'
    ).get(id) as ApiKeyRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  findByHash(keyHash: string): ApiKeyEntity | null {
    const row = this.db.prepare(
      'SELECT * FROM api_keys WHERE key_hash = ?'
    ).get(keyHash) as ApiKeyRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  findByPrefix(prefix: string): ApiKeyEntity[] {
    const rows = this.db.prepare(
      'SELECT * FROM api_keys WHERE key_prefix = ? AND status IN (?, ?)'
    ).all(prefix, KeyStatus.ACTIVE, KeyStatus.ROTATING) as ApiKeyRow[];
    return rows.map(rowToEntity);
  }

  list(options: KeyListOptions = {}): ApiKeyEntity[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (options.userId) {
      conditions.push('user_id = @userId');
      params.userId = options.userId;
    }
    if (options.status) {
      conditions.push('status = @status');
      params.status = options.status;
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const rows = this.db.prepare(`
      SELECT * FROM api_keys ${where}
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset }) as ApiKeyRow[];

    return rows.map(rowToEntity);
  }

  count(options: Omit<KeyListOptions, 'limit' | 'offset'> = {}): number {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (options.userId) {
      conditions.push('user_id = @userId');
      params.userId = options.userId;
    }
    if (options.status) {
      conditions.push('status = @status');
      params.status = options.status;
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM api_keys ${where}`
    ).get(params) as { count: number };

    return row.count;
  }

  updateStatus(id: string, status: KeyStatus, reason?: string): boolean {
    const now = new Date().toISOString();
    let stmt;

    if (status === KeyStatus.REVOKED) {
      stmt = this.db.prepare(`
        UPDATE api_keys
        SET status = @status, revoked_at = @now, revoked_reason = @reason
        WHERE id = @id
      `);
      return stmt.run({ id, status, now, reason: reason ?? null }).changes > 0;
    }

    stmt = this.db.prepare(`
      UPDATE api_keys SET status = @status WHERE id = @id
    `);
    return stmt.run({ id, status }).changes > 0;
  }

  updateLastUsed(id: string): boolean {
    const now = new Date().toISOString();
    return this.db.prepare(
      'UPDATE api_keys SET last_used_at = ? WHERE id = ?'
    ).run(now, id).changes > 0;
  }

  delete(id: string): boolean {
    return this.db.prepare(
      'DELETE FROM api_keys WHERE id = ?'
    ).run(id).changes > 0;
  }

  findExpired(): ApiKeyEntity[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM api_keys
      WHERE expires_at IS NOT NULL
        AND expires_at <= ?
        AND status = 'active'
    `).all(now) as ApiKeyRow[];

    return rows.map(rowToEntity);
  }

  expireKeys(): number {
    const now = new Date().toISOString();
    return this.db.prepare(`
      UPDATE api_keys
      SET status = 'expired'
      WHERE expires_at IS NOT NULL
        AND expires_at <= ?
        AND status = 'active'
    `).run(now).changes;
  }

  revokeKey(id: string, reason: string): boolean {
    return this.updateStatus(id, KeyStatus.REVOKED, reason);
  }

  createWithTransaction(data: KeyInsert): ApiKeyEntity {
    return withTransaction(this.db, () => this.create(data));
  }
}
