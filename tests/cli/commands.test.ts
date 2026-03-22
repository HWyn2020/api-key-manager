import Database from 'better-sqlite3';
import { up } from '../../src/database/migrations/001_initial_schema';
import { up as up002 } from '../../src/database/migrations/002_nullable_audit_key_id';
import { KeyRepository } from '../../src/database/repositories/KeyRepository';
import { RotationRepository } from '../../src/database/repositories/RotationRepository';
import { AuditRepository } from '../../src/database/repositories/AuditRepository';
import { createKeyService } from '../../src/services/keyService';
import { createAuditService } from '../../src/services/auditService';
import { CliDeps } from '../../src/cli/types';
import { create } from '../../src/cli/commands/create';
import { validate } from '../../src/cli/commands/validate';
import { rotate } from '../../src/cli/commands/rotate';
import { revoke } from '../../src/cli/commands/revoke';
import { list } from '../../src/cli/commands/list';
import { history } from '../../src/cli/commands/history';
import { audit } from '../../src/cli/commands/audit';

const TEST_ENCRYPTION_KEY = '0'.repeat(64);

let db: Database.Database;
let deps: CliDeps;
let logOutput: string[];
let errorOutput: string[];

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up(db);
  up002(db);

  const keyRepo = new KeyRepository(db);
  const rotationRepo = new RotationRepository(db);
  const auditRepo = new AuditRepository(db);

  const keyService = createKeyService({
    keyRepo,
    rotationRepo,
    auditRepo,
    encryptionKey: TEST_ENCRYPTION_KEY,
    db,
  });

  const auditService = createAuditService(auditRepo);

  deps = {
    keyService,
    auditService,
    rotationRepo,
  };
});

afterAll(() => {
  db.close();
});

beforeEach(() => {
  logOutput = [];
  errorOutput = [];
  jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logOutput.push(args.join(' '));
  });
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errorOutput.push(args.join(' '));
  });
  jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// create command
// ---------------------------------------------------------------------------
describe('create command', () => {
  it('prints a plaintext key starting with hg_', async () => {
    await create(['user-1', 'my-key', 'read', 'write'], deps);

    const plaintextLine = logOutput.find((l) => l.includes('Plaintext Key:'));
    expect(plaintextLine).toBeDefined();

    const plaintext = plaintextLine!.split('Plaintext Key:')[1].trim();
    expect(plaintext).toMatch(/^hg_/);
  });

  it('prints key response with keyName and scopes', async () => {
    await create(['user-2', 'another-key', 'admin'], deps);

    const jsonLines = logOutput.join('\n');
    expect(jsonLines).toContain('"keyName"');
    expect(jsonLines).toContain('another-key');

    const jsonStart = jsonLines.indexOf('{');
    const jsonEnd = jsonLines.lastIndexOf('}');
    const parsed = JSON.parse(jsonLines.slice(jsonStart, jsonEnd + 1));
    expect(parsed.keyName).toBe('another-key');
    expect(parsed.scopes).toContain('admin');
  });

  it('errors with missing arguments and prints usage', async () => {
    await expect(create([], deps)).rejects.toThrow('process.exit(1)');

    expect(errorOutput.some((l) => l.includes('Missing required arguments'))).toBe(true);
    expect(logOutput.some((l) => l.includes('Usage:'))).toBe(true);
  });

  it('errors when only user-id is provided', async () => {
    await expect(create(['user-1'], deps)).rejects.toThrow('process.exit(1)');

    expect(errorOutput.some((l) => l.includes('Missing required arguments'))).toBe(true);
  });

  it('defaults to read scope when no scopes given', async () => {
    await create(['user-3', 'default-scope-key'], deps);

    const jsonLines = logOutput.join('\n');
    const jsonStart = jsonLines.indexOf('{');
    const jsonEnd = jsonLines.lastIndexOf('}');
    const parsed = JSON.parse(jsonLines.slice(jsonStart, jsonEnd + 1));
    expect(parsed.scopes).toEqual(['read']);
  });
});

// ---------------------------------------------------------------------------
// validate command
// ---------------------------------------------------------------------------
describe('validate command', () => {
  let validPlaintext: string;

  beforeAll(async () => {
    // Create a key to validate against
    const result = await deps.keyService.createKey(
      { userId: 'val-user', keyName: 'val-key', scopes: ['read'] },
      'test'
    );
    validPlaintext = result.plaintext;
  });

  it('prints key details for a valid key', async () => {
    await validate([validPlaintext], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain('Key is VALID');
    expect(joined).toContain('Key ID:');
    expect(joined).toContain('User ID:');
    expect(joined).toContain('val-user');
    expect(joined).toContain('val-key');
    expect(joined).toContain('Scopes:');
  });

  it('throws for an invalid key with no matching prefix', async () => {
    await expect(validate(['hg_invalid_key_12345678'], deps)).rejects.toThrow(
      'process.exit(1)'
    );
  });

  it('errors with missing key argument', async () => {
    await expect(validate([], deps)).rejects.toThrow('process.exit(1)');

    expect(errorOutput.some((l) => l.includes('Missing required argument'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rotate command
// ---------------------------------------------------------------------------
describe('rotate command', () => {
  let keyIdToRotate: string;

  beforeEach(async () => {
    // Fresh key for each rotation test
    const result = await deps.keyService.createKey(
      { userId: 'rot-user', keyName: 'rot-key', scopes: ['read', 'write'] },
      'test'
    );
    keyIdToRotate = result.key.keyId;
    // Clear captured output from creation
    logOutput = [];
    errorOutput = [];
  });

  it('rotates a key and prints old/new keys and new plaintext', async () => {
    await rotate([keyIdToRotate, 'scheduled-rotation'], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain('Key rotated successfully');
    expect(joined).toContain('New Plaintext Key:');
    expect(joined).toContain('Old key:');
    expect(joined).toContain('New key:');

    const plaintextLine = logOutput.find((l) => l.includes('New Plaintext Key:'));
    const newPlaintext = plaintextLine!.split('New Plaintext Key:')[1].trim();
    expect(newPlaintext).toMatch(/^hg_/);
  });

  it('errors with missing key-id', async () => {
    await expect(rotate([], deps)).rejects.toThrow('process.exit(1)');

    expect(errorOutput.some((l) => l.includes('Missing required arguments'))).toBe(true);
  });

  it('errors with missing reason', async () => {
    await expect(rotate([keyIdToRotate], deps)).rejects.toThrow('process.exit(1)');

    expect(errorOutput.some((l) => l.includes('Missing required arguments'))).toBe(true);
  });

  it('errors with invalid grace period (non-numeric)', async () => {
    await expect(
      rotate([keyIdToRotate, 'reason', 'not-a-number'], deps)
    ).rejects.toThrow('process.exit(1)');

    expect(errorOutput.some((l) => l.includes('Invalid grace period'))).toBe(true);
  });

  it('errors with negative grace period', async () => {
    await expect(
      rotate([keyIdToRotate, 'reason', '-1000'], deps)
    ).rejects.toThrow('process.exit(1)');

    expect(errorOutput.some((l) => l.includes('Invalid grace period'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// revoke command
// ---------------------------------------------------------------------------
describe('revoke command', () => {
  let keyIdToRevoke: string;

  beforeEach(async () => {
    const result = await deps.keyService.createKey(
      { userId: 'rev-user', keyName: 'rev-key', scopes: ['read'] },
      'test'
    );
    keyIdToRevoke = result.key.keyId;
    logOutput = [];
    errorOutput = [];
  });

  it('revokes a key and prints confirmation', async () => {
    await revoke([keyIdToRevoke, 'compromised'], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain('Key revoked successfully');

    // Should print the JSON of the revoked key
    const jsonStart = joined.indexOf('{');
    const jsonEnd = joined.lastIndexOf('}');
    const parsed = JSON.parse(joined.slice(jsonStart, jsonEnd + 1));
    expect(parsed.status).toBe('revoked');
  });

  it('errors with missing key-id', async () => {
    await expect(revoke([], deps)).rejects.toThrow('process.exit(1)');

    expect(errorOutput.some((l) => l.includes('Missing required arguments'))).toBe(true);
  });

  it('errors with missing reason', async () => {
    await expect(revoke([keyIdToRevoke], deps)).rejects.toThrow('process.exit(1)');

    expect(errorOutput.some((l) => l.includes('Missing required arguments'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// list command
// ---------------------------------------------------------------------------
describe('list command', () => {
  const listUserId = 'list-user-unique';

  beforeAll(async () => {
    // Create a couple of keys for listing
    await deps.keyService.createKey(
      { userId: listUserId, keyName: 'list-key-1', scopes: ['read'] },
      'test'
    );
    await deps.keyService.createKey(
      { userId: listUserId, keyName: 'list-key-2', scopes: ['write'] },
      'test'
    );
  });

  it('lists keys for a user', async () => {
    await list([listUserId], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain('list-key-1');
    expect(joined).toContain('list-key-2');
    expect(joined).toContain('Total: 2 key(s)');
  });

  it('shows "No keys found" for empty results', async () => {
    await list(['nonexistent-user'], deps);

    expect(logOutput.some((l) => l.includes('No keys found'))).toBe(true);
  });

  it('supports --status flag', async () => {
    await list([listUserId, '--status=active'], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain('list-key-1');
    expect(joined).toContain('Total:');
  });

  it('supports --limit flag', async () => {
    await list([listUserId, '--limit=1'], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain('Total: 1 key(s)');
  });

  it('errors with missing user-id', async () => {
    await expect(list([], deps)).rejects.toThrow('process.exit(1)');

    expect(errorOutput.some((l) => l.includes('Missing required argument'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// history command
// ---------------------------------------------------------------------------
describe('history command', () => {
  it('shows rotation history after a rotate', async () => {
    // Create and rotate a key
    const result = await deps.keyService.createKey(
      { userId: 'hist-user', keyName: 'hist-key', scopes: ['read'] },
      'test'
    );
    const keyId = result.key.keyId;
    await deps.keyService.rotateKey(keyId, 'testing-history', 'test');

    logOutput = [];
    errorOutput = [];

    await history([keyId], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain('OLD KEY ID');
    expect(joined).toContain('NEW KEY ID');
    expect(joined).toContain('testing-history');
    expect(joined).toContain('Total: 1 record(s)');
  });

  it('shows "No rotation history" when none exists', async () => {
    const result = await deps.keyService.createKey(
      { userId: 'hist-user-2', keyName: 'no-hist-key', scopes: ['read'] },
      'test'
    );

    logOutput = [];
    errorOutput = [];

    await history([result.key.keyId], deps);

    expect(logOutput.some((l) => l.includes('No rotation history found'))).toBe(true);
  });

  it('errors with missing key-id', async () => {
    await expect(history([], deps)).rejects.toThrow('process.exit(1)');

    expect(errorOutput.some((l) => l.includes('Missing required argument'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// audit command
// ---------------------------------------------------------------------------
describe('audit command', () => {
  it('shows audit entries', async () => {
    // Previous operations already created audit entries
    await audit([], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain('KEY ID');
    expect(joined).toContain('ACTION');
    expect(joined).toContain('key.created');
    expect(joined).toContain('Total:');
  });

  it('supports --key-id filter', async () => {
    const result = await deps.keyService.createKey(
      { userId: 'audit-filter-user', keyName: 'audit-filter-key', scopes: ['read'] },
      'test'
    );
    const keyId = result.key.keyId;

    logOutput = [];
    errorOutput = [];

    await audit([`--key-id=${keyId}`], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain(keyId.slice(0, 38)); // table truncates at width 38
    expect(joined).toContain('key.created');
  });

  it('supports --limit flag', async () => {
    logOutput = [];
    errorOutput = [];

    await audit(['--limit=2'], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain('Total: 2 entry(ies)');
  });

  it('shows "No audit log entries found" for empty filter', async () => {
    await audit(['--key-id=nonexistent-key-id'], deps);

    expect(logOutput.some((l) => l.includes('No audit log entries found'))).toBe(true);
  });

  it('supports --action filter', async () => {
    await audit(['--action=key.created'], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain('key.created');
    expect(joined).toContain('Total:');
  });

  it('supports --actor-id filter', async () => {
    // Create a key with a specific actor via the service
    await deps.keyService.createKey(
      { userId: 'actor-test-user', keyName: 'actor-test-key', scopes: ['read'] },
      'specific-actor'
    );

    logOutput = [];
    errorOutput = [];

    await audit(['--actor-id=specific-actor'], deps);

    const joined = logOutput.join('\n');
    expect(joined).toContain('specific-actor');
    expect(joined).toContain('Total:');
  });
});
