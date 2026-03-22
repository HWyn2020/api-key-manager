import http from 'http';
import { AddressInfo } from 'net';
import express, { Express } from 'express';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrate';
import { KeyRepository } from '../../src/database/repositories/KeyRepository';
import { RotationRepository } from '../../src/database/repositories/RotationRepository';
import { AuditRepository } from '../../src/database/repositories/AuditRepository';
import { createKeyService, KeyService } from '../../src/services/keyService';
import { createAuditService } from '../../src/services/auditService';
import { createRateLimiter } from '../../src/services/rateLimiter';
import { requestLogger, errorHandler, createRateLimitMiddleware, createAuthMiddleware } from '../../src/middleware';
import { createRouter } from '../../src/routes';

export type AuditService = ReturnType<typeof createAuditService>;

const TEST_ENCRYPTION_KEY = '0'.repeat(64);

export interface TestContext {
  app: Express;
  db: Database.Database;
  keyService: KeyService;
  auditService: AuditService;
  server: http.Server;
  baseUrl: string;
  cleanup: () => void;
}

export function createTestApp(): { app: Express; db: Database.Database; keyService: KeyService; auditService: AuditService } {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  const repos = {
    keys: new KeyRepository(db),
    rotations: new RotationRepository(db),
    audit: new AuditRepository(db),
  };

  const rateLimiter = createRateLimiter();
  const auditService = createAuditService(repos.audit);
  const keyService = createKeyService({
    keyRepo: repos.keys,
    rotationRepo: repos.rotations,
    auditRepo: repos.audit,
    encryptionKey: TEST_ENCRYPTION_KEY,
    db,
  });

  const app = express();
  app.use(express.json());
  app.use(requestLogger);
  app.use(createAuthMiddleware(keyService));
  app.use(createRateLimitMiddleware(rateLimiter));
  app.use('/api', createRouter({ keyService, auditService }));
  app.use(errorHandler);

  return { app, db, keyService, auditService };
}

export function startTestServer(app: Express): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({ server, baseUrl });
    });
  });
}

export function stopTestServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Create a bootstrap API key directly via the service (bypassing HTTP auth).
 * Returns the plaintext key to use as a Bearer token.
 */
export async function createBootstrapKey(
  keyService: KeyService,
  userId: string = 'bootstrap-user',
): Promise<string> {
  const result = await keyService.createKey(
    { userId, keyName: 'bootstrap-key', scopes: ['admin'] },
    'test-setup'
  );
  return result.plaintext;
}

/** Helper to make HTTP requests using Node's built-in fetch */
export async function request(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  const url = `${baseUrl}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const json = await res.json();
  return { status: res.status, body: json };
}

/** Helper to make authenticated HTTP requests using a Bearer token */
export async function authRequest(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  return request(baseUrl, method, path, body, {
    Authorization: `Bearer ${token}`,
    ...headers,
  });
}
