import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DatabaseConfig } from '../config';

let db: Database.Database | null = null;

export function getDatabase(config: DatabaseConfig): Database.Database {
  if (db) return db;
  db = createDatabase(config);
  return db;
}

export function createDatabase(config: DatabaseConfig): Database.Database {
  // Ensure data directory exists for file-based databases
  if (config.path !== ':memory:') {
    const dir = path.dirname(config.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const database = new Database(config.path);

  // Performance and reliability pragmas
  database.pragma('journal_mode = WAL');
  database.pragma(`busy_timeout = ${config.busyTimeout}`);
  database.pragma('synchronous = NORMAL');
  database.pragma('cache_size = -64000'); // 64MB cache
  database.pragma('foreign_keys = ON');
  database.pragma('temp_store = MEMORY');

  return database;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function withTransaction<T>(
  database: Database.Database,
  fn: () => T
): T {
  const transaction = database.transaction(fn);
  return transaction();
}
