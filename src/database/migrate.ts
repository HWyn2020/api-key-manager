import Database from 'better-sqlite3';
import * as initialSchema from './migrations/001_initial_schema';
import * as nullableAuditKeyId from './migrations/002_nullable_audit_key_id';

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
  down: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  initialSchema,
  nullableAuditKeyId,
];

function getCurrentVersion(db: Database.Database): number {
  try {
    const row = db.prepare(
      'SELECT MAX(version) as version FROM schema_migrations'
    ).get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

export function runMigrations(db: Database.Database): void {
  const currentVersion = getCurrentVersion(db);

  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    return;
  }

  const migrate = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db);
      db.prepare(
        'INSERT INTO schema_migrations (version, description) VALUES (?, ?)'
      ).run(migration.version, migration.description);
    }
  });

  migrate();
}

export function rollbackMigration(db: Database.Database): void {
  const currentVersion = getCurrentVersion(db);
  if (currentVersion === 0) return;

  const migration = migrations.find((m) => m.version === currentVersion);
  if (!migration) return;

  const rollback = db.transaction(() => {
    migration.down(db);
    db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(
      currentVersion
    );
  });

  rollback();
}

// CLI entry point
if (require.main === module) {
  const { loadConfig } = require('../config');
  const { createDatabase } = require('./connection');

  const config = loadConfig();
  const db = createDatabase(config.database);

  const action = process.argv[2] || 'up';

  if (action === 'up') {
    console.log('Running migrations...');
    runMigrations(db);
    console.log('Migrations complete.');
  } else if (action === 'down') {
    console.log('Rolling back last migration...');
    rollbackMigration(db);
    console.log('Rollback complete.');
  } else {
    console.error(`Unknown action: ${action}. Use 'up' or 'down'.`);
    process.exit(1);
  }

  db.close();
}
