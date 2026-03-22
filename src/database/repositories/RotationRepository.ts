import Database from 'better-sqlite3';
import { RotationRecord, RotationCreate, RotationQuery } from '../../models/RotationHistory';

interface RotationRow {
  id: number;
  old_key_id: string;
  new_key_id: string;
  reason: string;
  rotated_by: string;
  old_key_valid_until: string;
  rotated_at: string;
}

function rowToRecord(row: RotationRow): RotationRecord {
  return {
    id: row.id,
    oldKeyId: row.old_key_id,
    newKeyId: row.new_key_id,
    reason: row.reason,
    rotatedBy: row.rotated_by,
    oldKeyValidUntil: row.old_key_valid_until,
    rotatedAt: row.rotated_at,
  };
}

export class RotationRepository {
  constructor(private db: Database.Database) {}

  create(data: RotationCreate): RotationRecord {
    const result = this.db.prepare(`
      INSERT INTO rotation_history (
        old_key_id, new_key_id, reason, rotated_by, old_key_valid_until
      ) VALUES (
        @oldKeyId, @newKeyId, @reason, @rotatedBy, @oldKeyValidUntil
      )
    `).run({
      oldKeyId: data.oldKeyId,
      newKeyId: data.newKeyId,
      reason: data.reason,
      rotatedBy: data.rotatedBy,
      oldKeyValidUntil: data.oldKeyValidUntil,
    });

    return this.findById(result.lastInsertRowid as number)!;
  }

  findById(id: number): RotationRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM rotation_history WHERE id = ?'
    ).get(id) as RotationRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  findByKeyId(keyId: string): RotationRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM rotation_history
      WHERE old_key_id = ? OR new_key_id = ?
      ORDER BY rotated_at DESC
    `).all(keyId, keyId) as RotationRow[];
    return rows.map(rowToRecord);
  }

  findByOldKeyId(oldKeyId: string): RotationRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM rotation_history WHERE old_key_id = ? ORDER BY rotated_at DESC LIMIT 1'
    ).get(oldKeyId) as RotationRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  list(query: RotationQuery = {}): RotationRecord[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.keyId) {
      conditions.push('(old_key_id = @keyId OR new_key_id = @keyId)');
      params.keyId = query.keyId;
    }
    if (query.rotatedBy) {
      conditions.push('rotated_by = @rotatedBy');
      params.rotatedBy = query.rotatedBy;
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const rows = this.db.prepare(`
      SELECT * FROM rotation_history ${where}
      ORDER BY rotated_at DESC
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset }) as RotationRow[];

    return rows.map(rowToRecord);
  }

  countByKeyId(keyId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM rotation_history WHERE old_key_id = ? OR new_key_id = ?'
    ).get(keyId, keyId) as { count: number };
    return row.count;
  }
}
