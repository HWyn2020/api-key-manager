import Database from 'better-sqlite3';

export const version = 1;
export const description = 'Initial schema: api_keys, rotation_history, audit_logs';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      key_name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'revoked', 'rotating')),
      rate_limit_window_ms INTEGER NOT NULL DEFAULT 3600000,
      rate_limit_max_requests INTEGER NOT NULL DEFAULT 100,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT,
      revoked_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);
    CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);
    CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON api_keys(expires_at)
      WHERE expires_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS rotation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      old_key_id TEXT NOT NULL,
      new_key_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      rotated_by TEXT NOT NULL,
      old_key_valid_until TEXT NOT NULL,
      rotated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (old_key_id) REFERENCES api_keys(id),
      FOREIGN KEY (new_key_id) REFERENCES api_keys(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rotation_old_key ON rotation_history(old_key_id);
    CREATE INDEX IF NOT EXISTS idx_rotation_new_key ON rotation_history(new_key_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      metadata TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (key_id) REFERENCES api_keys(id)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_key_id ON audit_logs(key_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_actor_id ON audit_logs(actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function down(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS audit_logs;
    DROP TABLE IF EXISTS rotation_history;
    DROP TABLE IF EXISTS api_keys;
    DROP TABLE IF EXISTS schema_migrations;
  `);
}
