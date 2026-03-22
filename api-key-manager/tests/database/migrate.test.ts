import Database from 'better-sqlite3';
import { runMigrations, rollbackMigration } from '../../src/database/migrate';

describe('database/migrate', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  describe('runMigrations', () => {
    it('creates all tables from initial migration', () => {
      runMigrations(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map(t => t.name);

      expect(tableNames).toContain('api_keys');
      expect(tableNames).toContain('rotation_history');
      expect(tableNames).toContain('audit_logs');
      expect(tableNames).toContain('schema_migrations');
    });

    it('records migration version', () => {
      runMigrations(db);

      const row = db
        .prepare('SELECT MAX(version) as version FROM schema_migrations')
        .get() as { version: number };
      expect(row.version).toBe(2);
    });

    it('is idempotent (running twice does not fail)', () => {
      runMigrations(db);
      expect(() => runMigrations(db)).not.toThrow();

      const row = db
        .prepare('SELECT COUNT(*) as count FROM schema_migrations')
        .get() as { count: number };
      expect(row.count).toBe(2);
    });

    it('creates indexes on api_keys', () => {
      runMigrations(db);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='api_keys'")
        .all() as { name: string }[];
      const indexNames = indexes.map(i => i.name);

      expect(indexNames).toContain('idx_api_keys_user_id');
      expect(indexNames).toContain('idx_api_keys_status');
      expect(indexNames).toContain('idx_api_keys_key_hash');
      expect(indexNames).toContain('idx_api_keys_key_prefix');
    });

    it('creates indexes on audit_logs', () => {
      runMigrations(db);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_logs'")
        .all() as { name: string }[];
      const indexNames = indexes.map(i => i.name);

      expect(indexNames).toContain('idx_audit_key_id');
      expect(indexNames).toContain('idx_audit_action');
      expect(indexNames).toContain('idx_audit_actor');
      expect(indexNames).toContain('idx_audit_created');
    });
  });

  describe('rollbackMigration', () => {
    it('rolls back the latest migration (002) successfully', () => {
      runMigrations(db);

      // Rolling back migration 002 (nullable audit key_id) should succeed
      // because it does not drop schema_migrations.
      expect(() => rollbackMigration(db)).not.toThrow();

      // After rolling back 002, the current version should be 1
      const row = db
        .prepare('SELECT MAX(version) as version FROM schema_migrations')
        .get() as { version: number };
      expect(row.version).toBe(1);

      // Tables should still be present
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('api_keys');
      expect(tableNames).toContain('audit_logs');
    });

    it('does nothing when no migrations have been applied', () => {
      expect(() => rollbackMigration(db)).not.toThrow();
    });
  });
});
