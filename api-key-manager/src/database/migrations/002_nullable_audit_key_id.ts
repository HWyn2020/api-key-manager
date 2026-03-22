import Database from 'better-sqlite3';

export const version = 2;
export const description = 'Make audit_logs.key_id nullable for failed validation logging';

export function up(db: Database.Database): void {
  // SQLite doesn't support ALTER COLUMN, so we recreate the table
  db.exec(`
    CREATE TABLE audit_logs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id TEXT REFERENCES api_keys(id),
      action TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      metadata TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO audit_logs_new SELECT * FROM audit_logs;
    DROP TABLE audit_logs;
    ALTER TABLE audit_logs_new RENAME TO audit_logs;
    CREATE INDEX idx_audit_key_id ON audit_logs(key_id);
    CREATE INDEX idx_audit_action ON audit_logs(action);
    CREATE INDEX idx_audit_actor ON audit_logs(actor_id);
    CREATE INDEX idx_audit_created ON audit_logs(created_at);
  `);
}

export function down(db: Database.Database): void {
  // Revert: make key_id NOT NULL again
  db.exec(`
    DELETE FROM audit_logs WHERE key_id IS NULL;
    CREATE TABLE audit_logs_old (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id TEXT NOT NULL REFERENCES api_keys(id),
      action TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      metadata TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO audit_logs_old SELECT * FROM audit_logs;
    DROP TABLE audit_logs;
    ALTER TABLE audit_logs_old RENAME TO audit_logs;
    CREATE INDEX idx_audit_key_id ON audit_logs(key_id);
    CREATE INDEX idx_audit_action ON audit_logs(action);
    CREATE INDEX idx_audit_actor ON audit_logs(actor_id);
    CREATE INDEX idx_audit_created ON audit_logs(created_at);
  `);
}
