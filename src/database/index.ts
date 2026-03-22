export { getDatabase, createDatabase, closeDatabase, withTransaction } from './connection';
export { runMigrations, rollbackMigration } from './migrate';
export { KeyRepository } from './repositories/KeyRepository';
export { RotationRepository } from './repositories/RotationRepository';
export { AuditRepository } from './repositories/AuditRepository';

import Database from 'better-sqlite3';
import { DatabaseConfig } from '../config';
import { createDatabase } from './connection';
import { runMigrations } from './migrate';
import { KeyRepository } from './repositories/KeyRepository';
import { RotationRepository } from './repositories/RotationRepository';
import { AuditRepository } from './repositories/AuditRepository';

export interface Repositories {
  keys: KeyRepository;
  rotations: RotationRepository;
  audit: AuditRepository;
}

export function initializeDatabase(config: DatabaseConfig): {
  db: Database.Database;
  repos: Repositories;
} {
  const db = createDatabase(config);
  runMigrations(db);

  return {
    db,
    repos: {
      keys: new KeyRepository(db),
      rotations: new RotationRepository(db),
      audit: new AuditRepository(db),
    },
  };
}
