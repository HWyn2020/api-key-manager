import Database from 'better-sqlite3';
import {
  AuditLogEntry,
  AuditLogCreate,
  AuditLogQuery,
  AuditAction,
} from '../../models/AuditLog';

interface AuditRow {
  id: number;
  key_id: string | null;
  action: string;
  actor_id: string;
  metadata: string | null;
  ip_address: string | null;
  created_at: string;
}

function rowToEntry(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    keyId: row.key_id,
    action: row.action as AuditAction,
    actorId: row.actor_id,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  };
}

export class AuditRepository {
  constructor(private db: Database.Database) {}

  create(data: AuditLogCreate): AuditLogEntry {
    const result = this.db.prepare(`
      INSERT INTO audit_logs (key_id, action, actor_id, metadata, ip_address)
      VALUES (@keyId, @action, @actorId, @metadata, @ipAddress)
    `).run({
      keyId: data.keyId,
      action: data.action,
      actorId: data.actorId,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      ipAddress: data.ipAddress ?? null,
    });

    return this.findById(result.lastInsertRowid as number)!;
  }

  findById(id: number): AuditLogEntry | null {
    const row = this.db.prepare(
      'SELECT * FROM audit_logs WHERE id = ?'
    ).get(id) as AuditRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  findByKeyId(keyId: string, limit = 50): AuditLogEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM audit_logs
      WHERE key_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(keyId, limit) as AuditRow[];
    return rows.map(rowToEntry);
  }

  list(query: AuditLogQuery = {}): AuditLogEntry[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.keyId) {
      conditions.push('key_id = @keyId');
      params.keyId = query.keyId;
    }
    if (query.action) {
      conditions.push('action = @action');
      params.action = query.action;
    }
    if (query.actorId) {
      conditions.push('actor_id = @actorId');
      params.actorId = query.actorId;
    }
    if (query.startDate) {
      conditions.push('created_at >= datetime(@startDate)');
      params.startDate = query.startDate;
    }
    if (query.endDate) {
      conditions.push('created_at <= datetime(@endDate)');
      params.endDate = query.endDate;
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const rows = this.db.prepare(`
      SELECT * FROM audit_logs ${where}
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset }) as AuditRow[];

    return rows.map(rowToEntry);
  }

  count(query: Omit<AuditLogQuery, 'limit' | 'offset'> = {}): number {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.keyId) {
      conditions.push('key_id = @keyId');
      params.keyId = query.keyId;
    }
    if (query.action) {
      conditions.push('action = @action');
      params.action = query.action;
    }
    if (query.actorId) {
      conditions.push('actor_id = @actorId');
      params.actorId = query.actorId;
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM audit_logs ${where}`
    ).get(params) as { count: number };

    return row.count;
  }

  deleteOlderThan(days: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return this.db.prepare(
      "DELETE FROM audit_logs WHERE created_at < ?"
    ).run(cutoff.toISOString()).changes;
  }
}
