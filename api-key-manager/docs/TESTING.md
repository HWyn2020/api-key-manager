# API Key Manager -- Testing Guide

> Version 1.1.0 | Last Updated: 2026-03-22

## Overview

The test suite contains **127 tests across 11 suites**, all passing. Tests run with Jest and ts-jest against Node.js, using in-memory SQLite databases for full isolation with zero filesystem setup.

- **Framework:** Jest 29 with ts-jest
- **Test timeout:** 10,000 ms (configured in `jest.config.ts`)
- **Runtime:** ~6 seconds on typical hardware

## Running Tests

```bash
# Run all tests
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# With coverage report (text + lcov)
npm run test:coverage

# Run a specific suite directory
npx jest tests/services/
npx jest tests/routes/
npx jest tests/middleware/
npx jest tests/cli/

# Run a single file
npx jest tests/services/keyService.test.ts

# Run tests matching a name pattern
npx jest -t "rotateKey"

# Verbose output
npx jest --verbose
```

## Test Structure

```
tests/
├── services/                        # Service unit tests (49 tests)
│   ├── encryptionService.test.ts    #   12 tests — AES-256-GCM, bcrypt, key generation
│   ├── keyService.test.ts           #   22 tests — CRUD, validation, rotation, expiry
│   ├── rateLimiter.test.ts          #    9 tests — sliding window, cleanup, isolation
│   └── auditService.test.ts         #    6 tests — logging, querying, retention cleanup
├── routes/                          # Route integration tests (32 tests)
│   ├── setup.ts                     #   Shared test app factory (not a test file)
│   ├── health.test.ts               #    3 tests — health endpoint
│   ├── keys.test.ts                 #   22 tests — full key lifecycle via HTTP
│   └── audit.test.ts                #    7 tests — audit query endpoints
├── middleware/                      # Middleware unit tests (20 tests)
│   ├── errorHandler.test.ts         #    8 tests — error mapping, prod/dev behavior
│   ├── requestLogger.test.ts        #    5 tests — log output verification
│   └── rateLimitMiddleware.test.ts  #    7 tests — header setting, 429 responses
├── cli/                             # CLI command tests (26 tests)
│   └── commands.test.ts             #   26 tests — all 7 CLI commands
└── security/
    └── VULNERABILITY_REPORT.md      #   Red team audit findings (not executable)
```

## Test Categories

### Service Unit Tests (49 tests)

These test the core business logic layer directly, without HTTP or middleware. Each test suite creates a fresh in-memory SQLite database in `beforeEach` (or `beforeAll`) and closes it in `afterEach` (or `afterAll`).

**`encryptionService.test.ts` (12 tests)** covers:
- AES-256-GCM encrypt/decrypt round-trip
- Decryption failure with wrong key, tampered ciphertext, tampered auth tag
- bcrypt hashing and comparison (`hashKey` / `compareKey`)
- API key generation: `hg_` prefix, correct length (67 chars), uniqueness
- Prefix extraction from key string

**`keyService.test.ts` (22 tests)** covers:
- Key creation with metadata, scopes, custom rate limits, expiration
- Audit log entry creation on key create
- Key validation: valid key returns entity, invalid returns null
- Expired and revoked keys return null on validation
- `lastUsedAt` timestamp updated on successful validation
- Key rotation with and without grace period
- Rotation and revocation error cases (non-existent, already revoked)
- Listing keys by user with optional status filter
- Get key by ID
- Bulk key expiration

**`rateLimiter.test.ts` (9 tests)** covers:
- Allow/block decisions based on request count vs limit
- Increment tracking and remaining count accuracy
- Reset clearing all entries for a key
- Cleanup removing timestamps older than 1 hour
- Sliding window: old requests fall off after window expires
- `resetAt` timestamp correctness
- Independent tracking per key

**`auditService.test.ts` (6 tests)** covers:
- Creating audit entries with all fields (keyId, action, actorId, metadata, ipAddress)
- Retrieving key history
- Querying with action and actorId filters
- Date range filtering
- Cleanup with configurable retention period

### Route Integration Tests (32 tests)

These are true integration tests. The shared helper `tests/routes/setup.ts` creates a complete Express application with:
- In-memory SQLite database with migrations applied
- All repositories (KeyRepository, RotationRepository, AuditRepository)
- Real service instances (keyService, auditService, rateLimiter)
- Full middleware stack (requestLogger, rateLimitMiddleware, errorHandler)
- Router mounted at `/api`

Tests start an HTTP server on a random port (`listen(0)`) and make real HTTP requests using Node's built-in `fetch`. This validates the entire request pipeline from HTTP input to database output.

**`health.test.ts` (3 tests):** 200 status, `status: "ok"`, timestamp in ISO format, uptime as positive number.

**`keys.test.ts` (22 tests):** Full lifecycle testing:
- `POST /api/keys` -- creation with valid body (201), plaintext starts with `hg_`, validation errors (400) for missing userId/keyName/scopes/empty scopes
- `GET /api/keys` -- list by userId, 400 without userId, empty array for unknown user
- `GET /api/keys/:id` -- returns key data (200), 404 for non-existent ID
- `PUT /api/keys/:id/rotate` -- returns old/new keys and plaintext, 400 without reason, 404 for non-existent key
- `PUT /api/keys/:id/revoke` -- revokes key (200), 400 without reason, 409 for double revoke
- `POST /api/keys/:id/validate` -- valid key returns `valid: true` with keyId, invalid returns `valid: false` with null keyId, 400 without key field
- `GET /api/keys/:id/audit` -- returns audit entries, empty array for unknown key

**`audit.test.ts` (7 tests):** Query endpoint testing:
- Returns all audit logs (200)
- Filters by action, keyId, combined filters
- Pagination with limit and offset
- Empty array for non-matching filters

### Middleware Tests (20 tests)

Middleware tests use mock `req`/`res`/`next` objects without starting a server.

**`errorHandler.test.ts` (8 tests):**
- Error message pattern matching: "not found" -> 404/NOT_FOUND, "already revoked" -> 409/ALREADY_REVOKED, "must be active" -> 409/INVALID_STATUS
- Unknown errors -> 500
- Production mode returns generic "An unexpected error occurred"
- Development mode returns actual error message
- `console.error` called with method, URL, and stack trace
- Response shape is `{ success: false, error: { code, message } }`

**`requestLogger.test.ts` (5 tests):**
- Calls `next()` immediately (non-blocking)
- Logs only on response `finish` event (uses EventEmitter mock for `res`)
- Log output includes method, URL, status code, and duration in ms

**`rateLimitMiddleware.test.ts` (7 tests):**
- Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers
- Allows requests under limit, blocks with 429 when exceeded
- Remaining count decreases correctly across requests
- Skips rate limiting entirely when `req.apiKeyEntity` is undefined
- Independent limits per key ID

### CLI Tests (26 tests)

CLI tests call command handler functions directly (not via subprocess), passing arguments as string arrays. They capture output by spying on `console.log` and `console.error`, and mock `process.exit` to throw an error (allowing assertion on exit codes).

**Commands tested:**

| Command | Tests | What's Verified |
|---------|-------|-----------------|
| `create` | 5 | Plaintext key output, JSON response with keyName/scopes, default scope fallback, missing argument errors |
| `validate` | 3 | Valid key details printed, invalid key exits with code 1, missing argument error |
| `rotate` | 5 | Old/new key output with new plaintext, missing key-id/reason errors, invalid/negative grace period errors |
| `revoke` | 3 | Revocation confirmation with JSON output, missing key-id/reason errors |
| `list` | 5 | Lists keys for user, empty results message, `--status` flag, `--limit` flag, missing user-id error |
| `history` | 3 | Rotation history table display, empty history message, missing key-id error |
| `audit` | 6 | Default query, `--key-id`/`--action`/`--actor-id` filters, `--limit` flag, empty results message |

## Test Patterns Used

### In-Memory SQLite for Integration Tests

All database-dependent tests use `new Database(':memory:')` from better-sqlite3. The migration is applied with `up(db)` (for service tests) or `runMigrations(db)` (for route tests). Each suite gets a completely isolated database instance. No test data leaks between suites.

```typescript
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up(db);
  // ... create repos and services
});

afterEach(() => {
  db.close();
});
```

### Mock req/res/next for Middleware

Middleware tests construct minimal mock objects matching the Express `Request`, `Response`, and `NextFunction` interfaces. The `res` mock uses `jest.fn().mockReturnThis()` for chainable methods like `status()` and `json()`. For the request logger, `res` extends `EventEmitter` to support the `finish` event.

```typescript
const mockRes = {
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
} as unknown as Response;
```

### Console Capture for CLI Tests

CLI output is captured by spying on `console.log` and `console.error` in `beforeEach`, then collecting all calls into arrays:

```typescript
let logOutput: string[];
beforeEach(() => {
  logOutput = [];
  jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logOutput.push(args.join(' '));
  });
});
```

Tests then search `logOutput` for expected strings (e.g., `logOutput.find(l => l.includes('Plaintext Key:'))`).

### process.exit Mocking

CLI commands call `process.exit(1)` on error. Tests mock this to throw an error instead, which can be caught with `rejects.toThrow`:

```typescript
jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
  throw new Error(`process.exit(${code})`);
}) as never);

// In test:
await expect(create([], deps)).rejects.toThrow('process.exit(1)');
```

### Date.now Mocking for Time-Dependent Tests

The rate limiter tests mock `Date.now` to simulate requests at different times, verifying sliding window behavior:

```typescript
const realNow = Date.now;
Date.now = () => pastTime;
limiter.increment('old-key');
Date.now = realNow;
```

## How to Add New Tests

### Step 1: Create the test file

Place it in the matching directory under `tests/`. Follow the existing naming convention: `<module>.test.ts`.

### Step 2: For service tests with database access

```typescript
// tests/services/myService.test.ts
import Database from 'better-sqlite3';
import { up } from '../../src/database/migrations/001_initial_schema';

describe('myService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    up(db);
    // Create repos and service instance
  });

  afterEach(() => {
    db.close();
  });

  it('does something', () => {
    // test body
  });
});
```

### Step 3: For route integration tests

Use the shared setup helper in `tests/routes/setup.ts`:

```typescript
// tests/routes/myRoute.test.ts
import http from 'http';
import { Express } from 'express';
import Database from 'better-sqlite3';
import { createTestApp, startTestServer, stopTestServer, request } from './setup';

describe('GET /api/my-route', () => {
  let app: Express;
  let db: Database.Database;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const ctx = createTestApp();
    app = ctx.app;
    db = ctx.db;
    const srv = await startTestServer(app);
    server = srv.server;
    baseUrl = srv.baseUrl;
  });

  afterAll(async () => {
    await stopTestServer(server);
    db.close();
  });

  it('returns 200', async () => {
    const res = await request(baseUrl, 'GET', '/api/my-route');
    expect(res.status).toBe(200);
  });
});
```

The `request()` helper uses Node's built-in `fetch`, sets `Content-Type: application/json`, and returns `{ status, body }`.

### Step 4: For middleware tests

Create mock req/res/next objects. See `tests/middleware/errorHandler.test.ts` for the pattern.

### Step 5: Run your test

```bash
npx jest tests/services/myService.test.ts --verbose
```

## Test Coverage

Coverage is collected from `src/**/*.ts`, excluding `src/**/index.ts` and `src/database/migrations/**`. Reports are generated in `text` (terminal) and `lcov` (HTML) formats under the `coverage/` directory.

Run `npm run test:coverage` to generate a report.

**What is covered:**
- All encryption/decryption paths including error cases
- Full key lifecycle: create, validate, rotate, revoke, expire, list, get
- Rate limiter logic: sliding window, cleanup, per-key isolation
- Audit logging: create, query, filter, cleanup
- All API routes: success paths, validation errors, 404s, 409 conflicts
- All middleware: error mapping, request logging, rate limit enforcement
- All 7 CLI commands with success and error paths

**What is not covered:**
- `src/index.ts` / `src/server.ts` -- server startup and configuration loading (excluded from coverage)
- Database migration files (excluded from coverage)
- The `VULNERABILITY_REPORT.md` findings (no automated exploit tests)
- Edge cases around concurrent database access (SQLite serializes writes)
- Redis-based rate limiting (the project uses in-memory rate limiting only)

## Security Testing

A red team audit was conducted and documented in `tests/security/VULNERABILITY_REPORT.md`. It identified:

- **3 Critical** findings (no authentication, no authorization/IDOR, encryption key validation)
- **4 High** findings (decryption error leakage, prefix collisions, rate limiter DoS, validation oracle)
- **5 Medium** findings (error message leakage, no CORS, no security headers, race conditions, insufficient audit logging)
- **4 Low** findings (plaintext in CLI output, X-Forwarded-For trust, no body size limit, uptime leakage)

The report also notes positive findings: parameterized queries (no SQL injection), timing-safe bcrypt comparison, random IV generation, proper GCM auth tag usage, strong key entropy (384 bits), and appropriate bcrypt cost factor (12 rounds).

See `tests/security/VULNERABILITY_REPORT.md` for full details, reproduction steps, and remediation recommendations.

## Known Test Considerations

1. **Async/await in key service tests.** The `keyService` methods are async (due to bcrypt hashing), so all key service tests use `async` test functions with `await`. Forgetting `await` on service calls will cause tests to pass incorrectly or produce confusing failures. When a test asserts on a rejection, use `await expect(...).rejects.toThrow()`.

2. **bcrypt timing.** bcrypt with 12 salt rounds takes ~250ms per hash. Tests that create multiple keys (like `listKeys` tests creating 3 keys) will be slower. The 10-second timeout in `jest.config.ts` accommodates this. If test speed becomes an issue, consider reducing salt rounds in a test-only configuration.

3. **In-memory database isolation.** Each suite gets a fresh database. Tests within a suite share the same database (via `beforeAll`), so test order can matter for route and CLI tests that seed data. The route tests use `beforeAll` (not `beforeEach`) for performance, meaning created keys persist across tests within a describe block.

4. **Date.now mocking.** The rate limiter tests temporarily replace `Date.now`. They always restore the original function. If a test fails mid-execution, the mock may leak. The `afterEach` with `jest.restoreAllMocks()` in the CLI tests handles this, but rate limiter tests do manual restoration.

5. **process.exit mocking.** CLI tests mock `process.exit` to throw, which means error-path tests must use `rejects.toThrow`. This pattern works but means the function under test does not fully complete its error path after the exit call.

## Related Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) -- System design and code structure
- [API.md](API.md) -- API endpoint specifications that route tests verify
- [CLI.md](CLI.md) -- CLI command behavior that command tests verify
- [VULNERABILITY_REPORT.md](../tests/security/VULNERABILITY_REPORT.md) -- Security audit findings
