import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDatabase, getDatabase, closeDatabase, withTransaction } from '../../src/database/connection';

describe('database/connection', () => {
  describe('createDatabase', () => {
    it('creates an in-memory database', () => {
      const db = createDatabase({
        path: ':memory:',
        walMode: false,
        busyTimeout: 5000,
      });
      expect(db).toBeDefined();
      expect(db.open).toBe(true);
      db.close();
    });

    it('attempts to set WAL mode pragma (in-memory stays as memory mode)', () => {
      const db = createDatabase({
        path: ':memory:',
        walMode: true,
        busyTimeout: 5000,
      });
      const mode = db.pragma('journal_mode', { simple: true }) as string;
      // In-memory databases don't support WAL, they remain in 'memory' mode
      expect(mode).toBe('memory');
      db.close();
    });

    it('enables foreign keys', () => {
      const db = createDatabase({
        path: ':memory:',
        walMode: false,
        busyTimeout: 5000,
      });
      const fk = db.pragma('foreign_keys', { simple: true }) as number;
      expect(fk).toBe(1);
      db.close();
    });

    it('creates data directory if it does not exist for file-based database', () => {
      const tmpDir = path.join(os.tmpdir(), `akm-conn-test-${Date.now()}`);
      const dbPath = path.join(tmpDir, 'test.db');

      try {
        const db = createDatabase({
          path: dbPath,
          walMode: true,
          busyTimeout: 5000,
        });
        expect(db.open).toBe(true);
        expect(fs.existsSync(tmpDir)).toBe(true);
        db.close();
      } finally {
        if (fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true });
        }
      }
    });
  });

  describe('getDatabase / closeDatabase', () => {
    afterEach(() => {
      closeDatabase();
    });

    it('getDatabase creates and returns a database instance', () => {
      const db = getDatabase({
        path: ':memory:',
        walMode: false,
        busyTimeout: 5000,
      });
      expect(db).toBeDefined();
      expect(db.open).toBe(true);
    });

    it('getDatabase returns same instance on subsequent calls (singleton)', () => {
      const config = { path: ':memory:', walMode: false, busyTimeout: 5000 };
      const db1 = getDatabase(config);
      const db2 = getDatabase(config);
      expect(db1).toBe(db2);
    });

    it('closeDatabase closes the singleton and allows new one', () => {
      const config = { path: ':memory:', walMode: false, busyTimeout: 5000 };
      const db1 = getDatabase(config);
      expect(db1.open).toBe(true);
      closeDatabase();
      const db2 = getDatabase(config);
      expect(db2).not.toBe(db1);
    });

    it('closeDatabase is safe to call when no database exists', () => {
      expect(() => closeDatabase()).not.toThrow();
    });
  });

  describe('withTransaction', () => {
    it('executes function within a transaction', () => {
      const db = new Database(':memory:');
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');

      const result = withTransaction(db, () => {
        db.prepare('INSERT INTO test (val) VALUES (?)').run('hello');
        db.prepare('INSERT INTO test (val) VALUES (?)').run('world');
        return db.prepare('SELECT COUNT(*) as count FROM test').get() as { count: number };
      });

      expect(result.count).toBe(2);
      db.close();
    });

    it('rolls back on error', () => {
      const db = new Database(':memory:');
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT NOT NULL)');

      db.prepare('INSERT INTO test (val) VALUES (?)').run('existing');

      try {
        withTransaction(db, () => {
          db.prepare('INSERT INTO test (val) VALUES (?)').run('new-1');
          db.prepare('INSERT INTO test (val) VALUES (NULL)').run(); // violates NOT NULL
        });
      } catch {
        // Expected to throw
      }

      const count = db.prepare('SELECT COUNT(*) as count FROM test').get() as { count: number };
      expect(count.count).toBe(1); // Only the pre-existing row
      db.close();
    });
  });
});
