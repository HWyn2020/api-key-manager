# API Key Manager -- Developer Handoff Guide

> Version 1.0.0 | Last Updated: 2026-03-22

Everything a new developer needs to go from zero to running in 5 minutes.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Environment Variables](#environment-variables)
4. [Project Structure](#project-structure)
5. [Running the Server](#running-the-server)
6. [Running the CLI](#running-the-cli)
7. [Running Tests](#running-tests)
8. [Database](#database)
9. [Key Concepts](#key-concepts)
10. [Known Issues & Limitations](#known-issues--limitations)
11. [Contributing](#contributing)
12. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 22+** -- Required. The project targets ES2022 and uses Node16 module resolution.
- **npm** -- Comes with Node.js. Used for dependency management and scripts.
- **No external databases required** -- SQLite is embedded via `better-sqlite3`. No Postgres, MySQL, or Redis needed to run.

Verify your setup:

```bash
node --version   # Must be v22.x or higher
npm --version    # Any recent version works
```

---

## Quick Start

```bash
# 1. Clone the repo
git clone <repo-url>
cd api-key-manager

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env

# 4. Generate a valid encryption key and paste it into .env
openssl rand -hex 32
# Edit .env: set ENCRYPTION_KEY=<output from above>

# 5. Run database migrations
npm run db:migrate

# 6. Start the dev server (watch mode, auto-reloads)
npm run dev

# 7. Verify it works
curl http://localhost:3000/api/health
# Expected: {"status":"ok"}
```

For production, build first then start:

```bash
npm run build
npm start
```

---

## Environment Variables

Create a `.env` file from the template:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENCRYPTION_KEY` | **Yes** | -- | 64-character hex string (32 bytes) used for AES-256-GCM encryption of API keys at rest. Generate with `openssl rand -hex 32`. Must be exactly 64 hex characters. |
| `DATABASE_PATH` | No | `./data/api-key-manager.db` | Filesystem path to the SQLite database file. The directory must exist. |
| `PORT` | No | `3000` | TCP port the HTTP server listens on. |
| `NODE_ENV` | No | `development` | Runtime environment. Set to `production` for production deployments. |
| `REDIS_URL` | No | `redis://localhost:6379` | Reserved for future distributed rate limiting (Phase 2+). Currently unused -- rate limiting is in-memory only. |
| `LOG_LEVEL` | No | `info` | Logging verbosity. Options: `error`, `info`, `debug`. |

**Critical:** If `ENCRYPTION_KEY` is missing, the server will crash on startup with `Missing required environment variable: ENCRYPTION_KEY`. See [VULNERABILITIES.md](VULNERABILITIES.md#critical-003) for related security notes.

---

## Project Structure

```
api-key-manager/
├── src/                              # TypeScript source code
│   ├── server.ts                     # Express app factory & server bootstrap
│   ├── config/
│   │   └── index.ts                  # Environment config loader (loadConfig, loadTestConfig)
│   ├── models/
│   │   ├── Key.ts                    # Key interface & KeyStatus enum (ACTIVE, ROTATING, REVOKED, EXPIRED)
│   │   ├── RotationHistory.ts        # Rotation history interface
│   │   ├── AuditLog.ts              # Audit log interface
│   │   └── index.ts                  # Re-exports all models
│   ├── database/
│   │   ├── connection.ts             # SQLite connection factory (WAL mode, busy timeout)
│   │   ├── migrate.ts               # Migration runner
│   │   ├── migrations/
│   │   │   └── 001_initial_schema.ts # Tables: api_keys, rotation_history, audit_logs
│   │   ├── repositories/
│   │   │   ├── KeyRepository.ts      # CRUD for api_keys table
│   │   │   ├── RotationRepository.ts # CRUD for rotation_history table
│   │   │   └── AuditRepository.ts    # CRUD for audit_logs table
│   │   └── index.ts                  # Database initialization (creates DB, runs migrations, returns repos)
│   ├── services/
│   │   ├── keyService.ts             # Key lifecycle: create, validate, rotate, revoke, expire
│   │   ├── encryptionService.ts      # AES-256-GCM encrypt/decrypt using ENCRYPTION_KEY
│   │   ├── auditService.ts           # Audit log queries
│   │   ├── rateLimiter.ts            # In-memory token-bucket rate limiter
│   │   └── index.ts                  # Re-exports
│   ├── routes/
│   │   ├── keys.ts                   # /api/keys/* route handlers
│   │   ├── audit.ts                  # /api/audit route handler
│   │   ├── health.ts                 # /api/health endpoint
│   │   └── index.ts                  # Router factory, mounts all route groups
│   ├── middleware/
│   │   ├── requestLogger.ts          # Logs incoming requests
│   │   ├── rateLimitMiddleware.ts     # Rate limit enforcement middleware
│   │   ├── errorHandler.ts           # Global Express error handler
│   │   └── index.ts                  # Re-exports
│   ├── cli/
│   │   ├── index.ts                  # CLI entrypoint, command dispatcher
│   │   ├── types.ts                  # CliDeps interface
│   │   └── commands/
│   │       ├── create.ts             # `create` command
│   │       ├── validate.ts           # `validate` command
│   │       ├── rotate.ts             # `rotate` command
│   │       ├── revoke.ts             # `revoke` command
│   │       ├── list.ts               # `list` command
│   │       ├── history.ts            # `history` command
│   │       ├── audit.ts              # `audit` command
│   │       └── index.ts              # Re-exports
│   └── utils/
│       ├── response.ts               # Standardized JSON response helpers
│       └── validator.ts              # Input validation utilities
├── tests/                            # Jest test suites
│   ├── repositories/                 # Repository unit tests
│   ├── services/                     # Service unit tests
│   ├── middleware/                    # Middleware unit tests
│   ├── routes/                       # Route integration tests
│   │   └── setup.ts                  # Shared test server setup
│   ├── cli/                          # CLI command tests
│   ├── integration/                  # End-to-end lifecycle tests
│   ├── e2e/                          # Full workflow tests
│   ├── utils/                        # Utility function tests
│   └── security/
│       └── VULNERABILITY_REPORT.md   # Red team findings
├── docs/                             # Documentation
│   ├── HANDOFF.md                    # This file
│   ├── ARCHITECTURE.md               # System design & data flow
│   ├── API.md                        # REST API reference
│   ├── CLI.md                        # CLI command reference
│   ├── TESTING.md                    # Test suite guide
│   ├── VULNERABILITIES.md            # Security audit (16 findings)
│   ├── CHANGELOG.md                  # Change history
│   └── MISSION.md                    # Project vision & roadmap
├── dist/                             # Compiled JavaScript (gitignored, auto-generated by `npm run build`)
├── data/                             # SQLite database files (created at runtime)
├── .env.example                      # Environment variable template
├── package.json                      # Dependencies & npm scripts
├── tsconfig.json                     # TypeScript config (ES2022, strict, Node16 modules)
└── jest.config.ts                    # Jest config (ts-jest, 10s timeout, tests in tests/)
```

For detailed architecture diagrams and data flow: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Running the Server

### Development (watch mode)

```bash
npm run dev
```

Uses `tsx watch` to run `src/index.ts` directly from TypeScript. Auto-restarts on file changes. Ideal for local development.

### Production

```bash
npm run build    # Compile TypeScript to dist/
npm start        # Run compiled JavaScript from dist/index.js
```

`npm run build` invokes `tsc` and outputs to `dist/`. `npm start` runs `node dist/index.js`.

### What happens on startup

1. `loadConfig()` reads environment variables (crashes if `ENCRYPTION_KEY` is missing)
2. `initializeDatabase()` opens the SQLite file at `DATABASE_PATH`, enables WAL mode, runs any pending migrations
3. Services are created (keyService, auditService, rateLimiter)
4. Express middleware is mounted (JSON parser, request logger, rate limiter)
5. Routes are mounted under `/api`
6. Server listens on `PORT` (default 3000)

### Verifying the server

```bash
curl http://localhost:3000/api/health
# {"status":"ok"}
```

---

## Running the CLI

The CLI operates directly against the SQLite database (no running server needed). It shares the same config and services as the server.

**Syntax:**

```bash
npx tsx src/cli/index.ts <command> [args...]
```

### Commands with examples

```bash
# Create a new API key for user "user-123" named "prod-key" with read and write scopes
npx tsx src/cli/index.ts create user-123 prod-key read write

# Validate an API key (pass the full hg_... string)
npx tsx src/cli/index.ts validate hg_aBcDeFgH...

# Rotate a key (key-id, reason, optional grace period in ms)
npx tsx src/cli/index.ts rotate 550e8400-e29b-41d4-a716-446655440000 "quarterly rotation" 3600000

# Revoke a key permanently
npx tsx src/cli/index.ts revoke 550e8400-e29b-41d4-a716-446655440000 "compromised"

# List keys for a user (with optional status filter and limit)
npx tsx src/cli/index.ts list user-123 --status=active --limit=10

# Show rotation history for a key
npx tsx src/cli/index.ts history 550e8400-e29b-41d4-a716-446655440000

# Query audit logs (all filters optional)
npx tsx src/cli/index.ts audit --key-id=550e8400... --action=CREATE --limit=20
```

**Help:**

```bash
npx tsx src/cli/index.ts --help
```

Full CLI reference: [CLI.md](CLI.md)

---

## Running Tests

All tests use in-memory SQLite -- no database setup, no cleanup, no external dependencies.

```bash
npm test                # Run all tests once (~6 seconds)
npm run test:watch      # Watch mode (re-runs on file changes)
npm run test:coverage   # Run with coverage report (output in coverage/)
```

### Test layout

| Directory | What it tests |
|-----------|---------------|
| `tests/repositories/` | KeyRepository, RotationRepository, AuditRepository |
| `tests/services/` | keyService, encryptionService, auditService, rateLimiter |
| `tests/middleware/` | errorHandler, requestLogger, rateLimitMiddleware |
| `tests/routes/` | HTTP route handlers (uses shared `setup.ts` test server) |
| `tests/cli/` | CLI command functions |
| `tests/utils/` | Response helpers, validators |
| `tests/integration/` | Full key lifecycle flows |
| `tests/e2e/` | End-to-end workflow tests |

### Test configuration

- **Framework:** Jest with `ts-jest` preset
- **Environment:** Node
- **Test files:** `tests/**/*.test.ts`
- **Timeout:** 10 seconds per test
- **Coverage:** Collected from `src/**/*.ts`, excluding `index.ts` barrel files and migration files
- **Coverage reporters:** `text` (terminal) and `lcov` (HTML in `coverage/`)

For test conventions and how to add new tests: [TESTING.md](TESTING.md)

---

## Database

### Engine

SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3). No external database server needed. The library is synchronous (database calls block the event loop briefly), which is acceptable for SQLite's sub-millisecond performance.

### File location

Default: `./data/api-key-manager.db` (configurable via `DATABASE_PATH` env var).

The `data/` directory must exist before the server starts. If it doesn't, create it:

```bash
mkdir -p data
```

### WAL mode

WAL (Write-Ahead Logging) is enabled by default (`walMode: true` in config). This allows concurrent readers while a write is in progress, improving performance for read-heavy workloads. The busy timeout is set to 5000ms.

### Migrations

```bash
npm run db:migrate
```

This runs `tsx src/database/migrate.ts`, which applies all pending migration files from `src/database/migrations/`. Currently there is one migration:

- `001_initial_schema.ts` -- Creates `api_keys`, `rotation_history`, and `audit_logs` tables.

Migrations are also run automatically on server/CLI startup via `initializeDatabase()`.

### Resetting the database

Delete the database file and re-run migrations:

```bash
rm -f data/api-key-manager.db
npm run db:migrate
```

### Tables

| Table | Purpose |
|-------|---------|
| `api_keys` | Stores key metadata, bcrypt hash, encrypted key blob, status, scopes, expiration |
| `rotation_history` | Tracks every rotation event with old/new key IDs, reason, grace period |
| `audit_logs` | Immutable log of all key operations (create, validate, rotate, revoke) |

---

## Key Concepts

### Key lifecycle

API keys move through these states:

```
  CREATE
    |
    v
  ACTIVE  ------>  ROTATING  ------>  REVOKED
    |                  |
    |                  v
    |               ACTIVE (new key)
    v
  EXPIRED
```

- **ACTIVE** -- Key is valid and can be used for authentication.
- **ROTATING** -- Key is being replaced. During the optional grace period, both the old and new keys are valid. After the grace period, the old key becomes REVOKED.
- **REVOKED** -- Key has been permanently disabled (manual revocation or post-rotation).
- **EXPIRED** -- Key has passed its `expiresAt` timestamp. Checked during validation.

### Encryption at rest

Every API key is protected two ways:

1. **Hashed with bcrypt** (12 salt rounds, ~200ms) -- Used for validation. The plaintext key is never stored. Validation extracts the 8-character prefix (chars 3-10 of the `hg_...` key) for O(1) database lookup, then does a timing-safe bcrypt compare.
2. **Encrypted with AES-256-GCM** -- The key is also encrypted using the `ENCRYPTION_KEY` for recovery/audit purposes. Each encrypted blob has its own IV and auth tag.

The plaintext key is returned exactly once, at creation time. It cannot be retrieved again.

### Rate limiting

The rate limiter uses an in-memory token-bucket algorithm. Each API key gets its own bucket. Configurable per-key limits.

**Current limitation:** The rate limiter state lives only in process memory. If the server restarts, all rate limit counters reset. Redis-backed rate limiting is planned but not yet wired up (the `ioredis` dependency and `REDIS_URL` config exist but are unused).

---

## Known Issues & Limitations

### Security -- Must Fix Before Production

1. **No authentication middleware** -- All API endpoints are open. Anyone can call any endpoint without proving identity. See [VULNERABILITIES.md](VULNERABILITIES.md) for details.
2. **No authorization / IDOR protection** -- There are no ownership checks. User A can read, rotate, or revoke User B's keys by guessing key IDs. The `x-actor-id` header is trusted without verification.
3. **Encryption key not validated at startup** -- The length of `ENCRYPTION_KEY` is not checked. A short or malformed key could result in weaker encryption without any warning.

### Infrastructure Limitations

4. **Rate limiter is in-memory only** -- No Redis backing. Rate limit state is lost on restart and cannot be shared across multiple server instances.
5. **Single-node SQLite** -- SQLite is not designed for distributed deployments. This system runs on a single server only. If you need horizontal scaling, you would need to migrate to PostgreSQL or similar.
6. **No HTTPS** -- The server runs plain HTTP. In production, put it behind a reverse proxy (nginx, Caddy) that terminates TLS.

### Minor Issues

7. **Rate limiter memory growth** -- The in-memory rate limiter's `cleanup()` function is never called automatically, causing unbounded memory growth under sustained traffic. A `setInterval` call needs to be added.
8. **Key prefix collisions** -- The 8-character prefix used for O(1) lookup has ~2.8 trillion combinations. Collisions are theoretically possible but there is no collision detection or UNIQUE constraint.
9. **bcrypt is slow by design** -- Key creation and validation each take ~200ms due to bcrypt's 12 salt rounds. This is intentional security hardening, not a bug.

---

## Contributing

### Adding a new feature

1. **Models first** -- Define or update interfaces in `src/models/`.
2. **Database layer** -- Add migrations in `src/database/migrations/` and repository methods in `src/database/repositories/`.
3. **Service layer** -- Add business logic in `src/services/`. Services depend on repositories, never on routes.
4. **Routes or CLI** -- Expose the feature via `src/routes/` (HTTP) and/or `src/cli/commands/` (CLI).
5. **Tests** -- Write tests for every layer. See the existing test structure for patterns.

### Test conventions

- Every source file in `src/` should have a corresponding test file in `tests/`.
- Tests use in-memory SQLite via `loadTestConfig()` -- no file I/O, no cleanup needed.
- Route tests use the shared setup in `tests/routes/setup.ts` which creates a fully wired test server.
- Name test files `<module>.test.ts` matching the source file.
- Use descriptive `describe` / `it` blocks. Test the happy path, error cases, and edge cases.

### Code style

- **TypeScript strict mode** -- All types must be explicit. No `any` unless absolutely unavoidable.
- **No ORM** -- Database access uses raw SQL via better-sqlite3 prepared statements. This is intentional.
- **Barrel exports** -- Each directory has an `index.ts` that re-exports its public API.
- **Functional factories** -- Services and routers use factory functions (`createKeyService()`, `createRouter()`) for dependency injection, not classes.
- **No frameworks beyond Express** -- No Nest, no Fastify, no decorators.

### Commit and PR workflow

1. Create a feature branch off `main`.
2. Make your changes with tests.
3. Run `npm test` and ensure all tests pass.
4. Run `npm run build` to verify TypeScript compiles cleanly.
5. Open a pull request against `main`.

---

## Troubleshooting

### `Missing required environment variable: ENCRYPTION_KEY`

You haven't set `ENCRYPTION_KEY` in your `.env` file. Generate one:

```bash
openssl rand -hex 32
```

Paste the 64-character hex string into `.env`:

```
ENCRYPTION_KEY=a1b2c3d4...  (64 hex chars)
```

### `npm run dev` fails with "tsx not found"

Run `npm install` first. `tsx` is a devDependency and must be installed locally.

### `Cannot find module 'better-sqlite3'`

Run `npm install`. If it still fails, `better-sqlite3` has a native C++ addon that requires a working build toolchain:

```bash
# Ubuntu/Debian
sudo apt-get install build-essential python3

# macOS
xcode-select --install
```

Then `npm install` again.

### Database file doesn't exist / `SQLITE_CANTOPEN`

The `data/` directory must exist:

```bash
mkdir -p data
npm run db:migrate
```

### Tests fail with "Cannot find module" errors

Make sure you've run `npm install`. Tests run from TypeScript directly via `ts-jest`, so no build step is needed.

### Port 3000 is already in use

Either stop the other process or change the port:

```bash
PORT=3001 npm run dev
```

### `npm run build` produces TypeScript errors

The project uses strict TypeScript. All types must be explicit. Check:
- No implicit `any` types
- All function parameters and return types are annotated
- No unused variables or imports

### Database is locked / `SQLITE_BUSY`

SQLite allows only one writer at a time. WAL mode helps, but if you're running multiple server instances against the same database file, you'll hit lock contention. Solution: run only one server instance per database file. The busy timeout is 5 seconds, so brief contention is handled automatically.

### How to completely reset everything

```bash
rm -rf dist/ data/ node_modules/ coverage/
npm install
mkdir -p data
npm run db:migrate
npm run dev
```

---

## Documentation Index

| Document | Contents |
|----------|----------|
| [HANDOFF.md](HANDOFF.md) | This file -- onboarding guide |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, components, data flow |
| [API.md](API.md) | REST API reference with all endpoints |
| [CLI.md](CLI.md) | CLI command reference |
| [TESTING.md](TESTING.md) | Test suite structure, how to add tests |
| [VULNERABILITIES.md](VULNERABILITIES.md) | Security audit findings (16 vulnerabilities) |
| [CHANGELOG.md](CHANGELOG.md) | Change history across all phases |
| [MISSION.md](MISSION.md) | Project vision, problem statement, roadmap |
