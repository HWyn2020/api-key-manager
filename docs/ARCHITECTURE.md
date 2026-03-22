# API Key Manager -- Architecture

> Version 2.0.0 | Last Updated: 2026-03-22

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Component Breakdown](#2-component-breakdown)
3. [Component Communication](#3-component-communication--dependency-injection)
4. [Technology Stack and Rationale](#4-technology-stack-and-rationale)
5. [Database Design](#5-database-design)
6. [Security Architecture](#6-security-architecture)
7. [Key Lifecycle States](#7-key-lifecycle-states)
8. [Data Flow Diagrams](#8-data-flow-diagrams)

---

## 1. System Overview

The API Key Manager is a layered TypeScript application for creating, validating,
rotating, and revoking API keys. It provides encryption at rest, per-key rate
limiting, and a complete audit trail. Two entry points -- an HTTP REST API
(Express) and a CLI -- share identical service and data layers.

### Layered Architecture Diagram

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                        Entry Points                             │
 │                                                                 │
 │   ┌───────────────────────┐        ┌──────────────────────┐     │
 │   │   HTTP Server          │        │       CLI            │     │
 │   │   (Express + Routes)   │        │   (process.argv)     │     │
 │   └───────────┬────────────┘        └──────────┬───────────┘     │
 │               │                                │                 │
 ├───────────────┼────────────────────────────────┼─────────────────┤
 │               │         Middleware              │                 │
 │   ┌───────────┴──────────────────┐             │                 │
 │   │  requestLogger               │             │                 │
 │   │  rateLimitMiddleware         │             │                 │
 │   │  errorHandler                │             │                 │
 │   └───────────┬──────────────────┘             │                 │
 │               │                                │                 │
 ├───────────────┼────────────────────────────────┼─────────────────┤
 │               │          Routes                │                 │
 │   ┌───────────┴──────────────────┐             │                 │
 │   │  /api/health                 │             │                 │
 │   │  /api/keys                   │             │                 │
 │   │  /api/audit                  │             │                 │
 │   └───────────┬──────────────────┘             │                 │
 │               │                                │                 │
 ├───────────────┴────────────────┬───────────────┘                 │
 │                                │                                 │
 │                         Service Layer                            │
 │   ┌────────────────┬───────────────┬───────────────────┐         │
 │   │  keyService    │ auditService  │  rateLimiter      │         │
 │   └────────┬───────┴───────┬───────┴───────────────────┘         │
 │            │               │                                     │
 │   ┌────────┴───────────────┴───────────┐                         │
 │   │       encryptionService            │                         │
 │   │  (AES-256-GCM + bcrypt hashing)    │                         │
 │   └────────┬───────────────────────────┘                         │
 │            │                                                     │
 ├────────────┼─────────────────────────────────────────────────────┤
 │            │       Repository Layer                              │
 │   ┌────────┴───────┬─────────────────┬───────────────────┐       │
 │   │ KeyRepository  │ RotationRepo    │  AuditRepository  │       │
 │   └────────┬───────┴─────────┬───────┴───────────────────┘       │
 │            │                 │                                    │
 ├────────────┴─────────────────┴───────────────────────────────────┤
 │                       Database Layer                             │
 │   ┌──────────────────────────────────────────────────────┐       │
 │   │  SQLite  (better-sqlite3, WAL mode)                  │       │
 │   │  connection.ts  |  migrations  |  transactions       │       │
 │   └──────────────────────────────────────────────────────┘       │
 └─────────────────────────────────────────────────────────────────┘
```

### Project Structure

```
src/
├── server.ts                    # Express app factory, DB init, service wiring
├── config/
│   └── index.ts                 # Environment config loader & validation
├── models/
│   ├── Key.ts                   # ApiKeyEntity, KeyStatus enum, row/entity converters
│   ├── AuditLog.ts              # AuditLogEntry, AuditAction enum, AuditLogQuery
│   └── RotationHistory.ts       # RotationRecord, RotationCreate
├── database/
│   ├── connection.ts            # SQLite connection with WAL mode & pragmas
│   ├── index.ts                 # initializeDatabase() factory
│   ├── migrate.ts               # Migration runner
│   ├── migrations/
│   │   └── 001_initial_schema.ts
│   └── repositories/
│       ├── KeyRepository.ts     # API key CRUD, prefix lookup, expiration
│       ├── AuditRepository.ts   # Audit log CRUD, filtered queries
│       └── RotationRepository.ts
├── services/
│   ├── encryptionService.ts     # AES-256-GCM, bcrypt, key generation
│   ├── keyService.ts            # Key lifecycle orchestrator
│   ├── rateLimiter.ts           # In-memory sliding window rate limiter
│   └── auditService.ts          # Audit logging wrapper
├── routes/
│   ├── index.ts                 # Route aggregator
│   ├── health.ts                # GET /api/health
│   ├── keys.ts                  # Key CRUD + rotate/revoke/validate
│   └── audit.ts                 # Audit log query endpoint
├── middleware/
│   ├── errorHandler.ts          # Global error-to-HTTP-status mapping
│   ├── requestLogger.ts         # Request/response logging
│   └── rateLimitMiddleware.ts   # Per-key rate limit enforcement
└── cli/
    ├── index.ts                 # CLI dispatcher and DB lifecycle
    ├── types.ts                 # CliDeps interface
    └── commands/
        ├── create.ts            # create <user-id> <name> [scopes...]
        ├── validate.ts          # validate <key>
        ├── rotate.ts            # rotate <key-id> <reason> [grace-ms]
        ├── revoke.ts            # revoke <key-id> <reason>
        ├── list.ts              # list <user-id> [--status] [--limit]
        ├── history.ts           # history <key-id>
        └── audit.ts             # audit [--key-id] [--action] [--limit]
```

---

## 2. Component Breakdown

### Database Layer (`src/database/`)

Manages the SQLite connection, schema migrations, and transaction support.

| File               | Responsibility                                                       |
|--------------------|----------------------------------------------------------------------|
| `connection.ts`    | Singleton database creation, WAL/pragma tuning, `withTransaction()` helper |
| `migrate.ts`       | Runs versioned migrations; tracks applied versions in `schema_migrations` |
| `migrations/`      | Numbered migration files with `up()` and `down()` methods            |
| `index.ts`         | `initializeDatabase()` -- creates DB, runs migrations, returns repositories |

Design decisions:
- **WAL journal mode** for concurrent read performance.
- **`busy_timeout = 5000`** to handle write contention without immediate failures.
- **Foreign keys enforced** via `PRAGMA foreign_keys = ON`.
- **64 MB page cache** (`cache_size = -64000`) for read-heavy workloads.
- **In-memory database** (`:memory:`) with WAL disabled for tests.

### Repository Layer (`src/database/repositories/`)

Thin data-access classes. Each repository receives a `Database.Database` instance
via its constructor and exposes typed CRUD methods. Repositories contain no
business logic. All SQL uses prepared statements with named parameters.

| Repository           | Table              | Key Operations                                   |
|----------------------|--------------------|--------------------------------------------------|
| `KeyRepository`      | `api_keys`         | `create`, `findById`, `findByHash`, `findByPrefix`, `list`, `count`, `updateStatus`, `updateLastUsed`, `expireKeys`, `delete` |
| `RotationRepository` | `rotation_history` | `create`, `findByKeyId`, `list`                  |
| `AuditRepository`    | `audit_logs`       | `create`, `findByKeyId`, `list`, `deleteOlderThan` |

The `KeyRepository` also provides `createWithTransaction()` which wraps
insertion in a SQLite transaction via the `withTransaction()` helper.

### Service Layer (`src/services/`)

Contains all business logic. Services are created via factory functions that
accept their dependencies explicitly (see Section 3).

| Service              | Factory Function        | Responsibility                                          |
|----------------------|-------------------------|---------------------------------------------------------|
| `keyService`         | `createKeyService()`    | Full key lifecycle: create, validate, rotate, revoke, expire, list, get |
| `auditService`       | `createAuditService()`  | Audit log writes, queries, and retention cleanup        |
| `encryptionService`  | (stateless exports)     | AES-256-GCM encrypt/decrypt, bcrypt hash/compare, key generation |
| `rateLimiter`        | `createRateLimiter()`   | In-memory sliding-window rate limiter per API key       |

**encryptionService** is the only service that uses direct function exports
rather than a factory, because it has no mutable state or dependencies beyond
the encryption key passed at call sites.

### Route Layer (`src/routes/`)

Express routers that parse HTTP requests, perform input validation, delegate to
services, and format JSON responses.

| Router         | Mount Point     | Endpoints                                                      |
|----------------|-----------------|----------------------------------------------------------------|
| `keys.ts`      | `/api/keys`     | `POST /` `GET /` `GET /:id` `PUT /:id/rotate` `PUT /:id/revoke` `POST /:id/validate` `GET /:id/audit` |
| `audit.ts`     | `/api/audit`    | Query-based audit log access                                   |
| `health.ts`    | `/api/health`   | Liveness check                                                 |

Actor identity is extracted from the `X-Actor-Id` request header, defaulting
to `"anonymous"` when absent.

### Middleware (`src/middleware/`)

Applied in order by `server.ts`:

1. **`express.json()`** -- Parse JSON request bodies.
2. **`requestLogger`** -- Logs method, URL, status code, duration, and client IP.
3. **`rateLimitMiddleware`** -- Reads per-key rate limit config from `req.apiKeyEntity`, checks the sliding window, sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers. Returns `429` when exceeded.
4. **`errorHandler`** -- Last in the chain. Catches thrown errors and maps them to structured JSON responses.

Error mapping rules:

| Error Message Pattern | HTTP Status | Code             |
|-----------------------|-------------|------------------|
| Contains "not found"  | 404         | `NOT_FOUND`      |
| Contains "already revoked" | 409    | `ALREADY_REVOKED`|
| Contains "must be active"  | 409    | `INVALID_STATUS` |
| All other errors      | 500         | `INTERNAL_ERROR` |

In production (`NODE_ENV=production`), the 500 response suppresses the real
error message to prevent information leakage.

### CLI Layer (`src/cli/`)

A standalone entry point that parses `process.argv`, initializes its own
database connection and service instances (identical wiring to the HTTP server),
dispatches to command handlers, and closes the database on exit.

Commands: `create`, `validate`, `rotate`, `revoke`, `list`, `history`, `audit`.

---

## 3. Component Communication -- Dependency Injection

The project uses a **factory function** pattern. Each service exposes a `create*`
function that accepts a typed dependencies object and returns a plain object of
methods (closure-based). No DI container or decorator system is used.

### Wiring Graph

```
createServer(config)
  |
  +-- initializeDatabase(config.database)
  |     +-- createDatabase(config)             --> db: Database
  |     +-- runMigrations(db)
  |     +-- return { db, repos: {
  |           keys:      new KeyRepository(db),
  |           rotations: new RotationRepository(db),
  |           audit:     new AuditRepository(db)
  |         }}
  |
  +-- createRateLimiter()                      --> rateLimiter
  +-- createAuditService(repos.audit)          --> auditService
  +-- createKeyService({
  |     keyRepo:       repos.keys,
  |     rotationRepo:  repos.rotations,
  |     auditRepo:     repos.audit,
  |     encryptionKey: config.encryptionKey,
  |     db:            db
  |   })                                       --> keyService
  |
  +-- createRateLimitMiddleware(rateLimiter)    --> middleware fn
  +-- createRouter({ keyService, auditService })
        +-- createKeysRouter(keyService, auditService)
        +-- createAuditRouter(auditService)
        +-- createHealthRouter()
```

### CLI Wiring (identical service graph)

```
main()
  +-- loadConfig()
  +-- initializeDatabase(config.database)      --> { db, repos }
  +-- createKeyService({ keyRepo, rotationRepo, auditRepo, encryptionKey, db })
  +-- createAuditService(repos.audit)
  +-- dispatch command with { keyService, auditService, rotationRepo }
  +-- db.close()
```

This approach makes every component independently testable -- tests inject mock
or in-memory dependencies at construction time.

---

## 4. Technology Stack and Rationale

| Technology              | Role                    | Rationale                                                             |
|-------------------------|-------------------------|-----------------------------------------------------------------------|
| **TypeScript 5**        | Language                | Static typing across all layers catches interface mismatches at compile time. Models, repository inputs, and service contracts are all typed. |
| **SQLite** via `better-sqlite3 11` | Database     | Zero-config embedded database. Synchronous API avoids callback/promise complexity in data access. WAL mode provides good read concurrency for a single-server deployment. No external process to manage. |
| **Express 4**           | HTTP framework          | Mature, minimal, well-understood middleware model. Low overhead for a focused API service. |
| **bcrypt 5**            | Key hashing             | Industry-standard adaptive hash function. 12 salt rounds provide strong brute-force resistance (~250ms per hash on modern hardware). `bcrypt.compare()` is timing-safe. |
| **Node.js `crypto`** (AES-256-GCM) | Encryption at rest | Authenticated encryption prevents both tampering and disclosure. GCM mode produces an authentication tag alongside ciphertext, ensuring integrity. 256-bit key provides a large security margin. |
| **uuid v4**             | Primary key generation  | Cryptographically random, collision-resistant 128-bit identifiers. No sequential guessing possible. |
| **Jest + ts-jest**      | Testing                 | First-class TypeScript support. In-memory SQLite databases make integration tests fast and isolated. |
| **tsx**                 | Dev runner              | Fast TypeScript execution with watch mode; no separate compile step during development. |
| **ioredis** (prepared)  | Distributed rate limiting | Dependency declared but not yet wired. Reserved for future migration from in-memory to Redis-backed rate limiting. |
| **jose** (prepared)     | JWT authentication      | Dependency declared but not yet wired. Reserved for future auth middleware. |

---

## 5. Database Design

### Entity-Relationship Diagram

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                           api_keys                               │
 ├──────────────────────────────────────────────────────────────────┤
 │ PK  id                   TEXT NOT NULL          (UUID v4)        │
 │     user_id               TEXT NOT NULL                          │
 │     key_name              TEXT NOT NULL                          │
 │     key_hash              TEXT NOT NULL          (bcrypt, 12 rds)│
 │     key_prefix            TEXT NOT NULL          (8 chars)       │
 │     encrypted_key         TEXT NOT NULL          (AES ciphertext)│
 │     iv                    TEXT NOT NULL          (hex, 16 bytes) │
 │     auth_tag              TEXT NOT NULL          (hex, GCM tag)  │
 │     scopes                TEXT NOT NULL          (JSON array)    │
 │     status                TEXT NOT NULL          (CHECK)         │
 │     rate_limit_window_ms  INTEGER NOT NULL       (default 3600000)│
 │     rate_limit_max_requests INTEGER NOT NULL     (default 100)   │
 │     expires_at            TEXT                   (ISO 8601)      │
 │     created_at            TEXT NOT NULL          (ISO 8601)      │
 │     last_used_at          TEXT                   (ISO 8601)      │
 │     revoked_at            TEXT                   (ISO 8601)      │
 │     revoked_reason        TEXT                                   │
 └───────────┬──────────────────────────────┬───────────────────────┘
             │ 1                            │ 1
             │                              │
             │ *                            │ *
 ┌───────────┴───────────────────┐   ┌──────┴──────────────────────────┐
 │      rotation_history         │   │           audit_logs             │
 ├───────────────────────────────┤   ├─────────────────────────────────┤
 │ PK  id         INTEGER AI     │   │ PK  id           INTEGER AI     │
 │ FK  old_key_id  TEXT NOT NULL  │   │ FK  key_id        TEXT NOT NULL  │
 │ FK  new_key_id  TEXT NOT NULL  │   │     action        TEXT NOT NULL  │
 │     reason      TEXT NOT NULL  │   │     actor_id      TEXT NOT NULL  │
 │     rotated_by  TEXT NOT NULL  │   │     metadata      TEXT (JSON)    │
 │     old_key_valid_until TEXT   │   │     ip_address    TEXT           │
 │     rotated_at  TEXT NOT NULL  │   │     created_at    TEXT NOT NULL  │
 └───────────────────────────────┘   └─────────────────────────────────┘

 ┌───────────────────────────────┐
 │      schema_migrations        │
 ├───────────────────────────────┤
 │ PK  version     INTEGER       │
 │     description TEXT NOT NULL  │
 │     applied_at  TEXT NOT NULL  │
 └───────────────────────────────┘
```

### Relationships

- `rotation_history.old_key_id` --> `api_keys.id` (FK)
- `rotation_history.new_key_id` --> `api_keys.id` (FK)
- `audit_logs.key_id` --> `api_keys.id` (FK)

### Indexes

| Table              | Index Name                     | Column(s)    | Notes                                      |
|--------------------|--------------------------------|--------------|--------------------------------------------|
| `api_keys`         | `idx_api_keys_user_id`         | `user_id`    | Filter keys by owner                       |
| `api_keys`         | `idx_api_keys_status`          | `status`     | Filter by lifecycle state                  |
| `api_keys`         | `idx_api_keys_key_hash`        | `key_hash`   | Hash-based key lookup                      |
| `api_keys`         | `idx_api_keys_key_prefix`      | `key_prefix` | Fast prefix lookup during validation       |
| `api_keys`         | `idx_api_keys_expires_at`      | `expires_at` | Partial index (`WHERE expires_at IS NOT NULL`) for expiration scans |
| `rotation_history` | `idx_rotation_old_key`         | `old_key_id` | Find rotations originating from a key      |
| `rotation_history` | `idx_rotation_new_key`         | `new_key_id` | Find rotations resulting in a key          |
| `audit_logs`       | `idx_audit_key_id`             | `key_id`     | Per-key audit trail                        |
| `audit_logs`       | `idx_audit_action`             | `action`     | Filter by event type                       |
| `audit_logs`       | `idx_audit_actor_id`           | `actor_id`   | Filter by who performed the action         |
| `audit_logs`       | `idx_audit_created_at`         | `created_at` | Time-range queries                         |

### Constraints

- `status` uses a CHECK constraint: values must be one of `'active'`, `'expired'`, `'revoked'`, `'rotating'`.
- Foreign keys from `rotation_history` and `audit_logs` reference `api_keys(id)`.
- Foreign keys enforced at the connection level via `PRAGMA foreign_keys = ON`.
- `schema_migrations.version` is the primary key, preventing duplicate migration application.

### Configuration

| Variable         | Default                            | Purpose                          |
|------------------|------------------------------------|----------------------------------|
| `ENCRYPTION_KEY` | *(required)*                       | 64-char hex string (256-bit AES key) |
| `DATABASE_PATH`  | `./data/api-key-manager.db`        | SQLite file path                 |
| `PORT`           | `3000`                             | HTTP server port                 |
| `NODE_ENV`       | `development`                      | Environment mode                 |
| `REDIS_URL`      | `redis://localhost:6379`           | Reserved for future use          |
| `LOG_LEVEL`      | `info`                             | Logging verbosity                |

---

## 6. Security Architecture

### Cryptographic Design

Every API key is stored with three layers of protection:

```
  Plaintext API Key:  hg_<48 random bytes, base64url encoded>
       |
       +-----> key_prefix = characters [3..11]     (8 chars, for indexed lookup)
       |
       +-----> bcrypt(plaintext, 12 rounds)   ---> key_hash        (validation)
       |
       +-----> AES-256-GCM(plaintext, KEY)    ---> encrypted_key   (recovery)
                        |                               + iv
                        |                               + auth_tag
                        +---> ENCRYPTION_KEY (64-char hex = 256 bits, from env)
```

**Layer 1 -- Key Prefix (`key_prefix`):**
The first 8 characters after the `hg_` prefix are stored as a fast lookup index.
During validation, the system uses the prefix to locate a candidate row via an
indexed query, avoiding a full table scan. The prefix alone is not
security-sensitive.

**Layer 2 -- bcrypt Hash (`key_hash`):**
The full plaintext key is hashed with bcrypt at 12 salt rounds. This is the
primary validation path. `bcrypt.compare()` provides timing-safe comparison,
preventing timing side-channel attacks.

**Layer 3 -- AES-256-GCM Ciphertext (`encrypted_key` + `iv` + `auth_tag`):**
The full plaintext is encrypted with the server's `ENCRYPTION_KEY` using a
unique random 16-byte IV per encryption. The GCM authentication tag prevents
both tampering and oracle attacks. This provides a recoverable copy for
administrative operations (e.g., during key rotation the old key's metadata is
needed).

### Validation Flow Security

1. Extract 8-char prefix from presented key.
2. Index lookup on `key_prefix` column (returns at most one active row).
3. Full `bcrypt.compare()` against stored `key_hash`.
4. Check `status === 'active'` and `expires_at > now`.
5. Only after all checks pass is the key considered valid.

This two-step lookup (cheap index scan, then expensive bcrypt) balances
performance with security.

### Rate Limiting

Per-key sliding window rate limiter, implemented in-memory using a `Map<keyId, number[]>`:

- Each API key carries its own `windowMs` (default: 60,000ms) and `maxRequests` (default: 100).
- On each request, timestamps outside the current window are pruned.
- If the count within the window meets or exceeds `maxRequests`, a `429 Too Many Requests` response is returned.
- Response headers convey rate limit state to clients:
  - `X-RateLimit-Limit` -- maximum requests per window
  - `X-RateLimit-Remaining` -- requests left in current window
  - `X-RateLimit-Reset` -- Unix timestamp (seconds) when the window resets
- A `cleanup()` method removes stale entries older than one hour.

### Audit Trail

Every significant key operation is recorded in the `audit_logs` table:

| Action           | Trigger                                 |
|------------------|-----------------------------------------|
| `key.created`    | New key provisioned                     |
| `key.accessed`   | Key used (successful validation)        |
| `key.validated`  | Key validation attempt                  |
| `key.rotated`    | Key rotation initiated                  |
| `key.revoked`    | Key manually revoked                    |
| `key.expired`    | Key expired by system sweep             |
| `key.deleted`    | Key permanently removed                 |
| `key.updated`    | Key metadata modified                   |

Each entry captures: `key_id`, `action`, `actor_id`, `ip_address`, freeform
`metadata` (JSON), and `created_at` timestamp. The audit service supports
retention cleanup via `deleteOlderThan(retentionDays)`.

### Security Principles

1. **Never store plaintext.** Keys exist in plaintext only in memory during creation and rotation. The plaintext is returned to the caller exactly once.
2. **Timing-safe comparison.** `bcrypt.compare()` prevents timing attacks on validation.
3. **Authenticated encryption.** GCM mode provides confidentiality and integrity in a single operation.
4. **Unique IVs.** `crypto.randomBytes(16)` per encryption; never reused.
5. **Parameterized queries.** All SQL uses prepared statements with named parameters. Zero injection risk.
6. **Transactional consistency.** Key rotation wraps all state changes in a single SQLite transaction.
7. **Audit everything.** Every lifecycle event is logged with actor, IP, and metadata.
8. **Error suppression in production.** Internal error messages are hidden from clients when `NODE_ENV=production`.

---

## 7. Key Lifecycle States

API keys move through four states, enforced by a CHECK constraint on the
`status` column in the `api_keys` table.

### State Diagram

```
                       ┌──────────────────────────────────────┐
                       │                                      │
                       v                                      │
  ┌───────────┐    rotation     ┌───────────┐    grace        │
  │           ├────────────────>│           │    period        │
  │  ACTIVE   │                 │ ROTATING  ├────expires───────┘
  │           │                 │           │
  └─────┬─────┘                 └─────┬─────┘
        │                             │
        │  manual revoke              │  no grace period
        │                             │  (immediate revoke)
        │      ┌───────────┐          │
        ├─────>│           │<─────────┘
        │      │  REVOKED  │
        │      │           │
        │      └───────────┘
        │
        │  expires_at <= now
        │  (system sweep)
        v
  ┌───────────┐
  │           │
  │  EXPIRED  │
  │           │
  └───────────┘
```

### State Transition Table

| From       | To         | Trigger                                                        |
|------------|------------|----------------------------------------------------------------|
| `ACTIVE`   | `ROTATING` | `rotateKey()` called -- old key transitions to ROTATING        |
| `ROTATING` | `REVOKED`  | Grace period expires, or no grace period was specified          |
| `ACTIVE`   | `REVOKED`  | `revokeKey()` called with a reason                             |
| `ACTIVE`   | `EXPIRED`  | System expiration sweep finds `expires_at <= now`              |

### Rules

- Only keys with `status = 'active'` pass validation.
- A key in `ROTATING` status remains in the database but does not pass the `findByPrefix` query (which filters on `status = 'active'`).
- When a grace period is specified during rotation, the old key stays `ROTATING` for the duration. Without a grace period, the old key is immediately set to `REVOKED`.
- `REVOKED` and `EXPIRED` are terminal states. There is no path back to `ACTIVE`.

---

## 8. Data Flow Diagrams

### 8.1 Create Key

```
  Client               Route Handler         keyService           encryptionService        KeyRepo         AuditRepo
    |                       |                     |                       |                    |                |
    |  POST /api/keys       |                     |                       |                    |                |
    |  {userId, keyName,    |                     |                       |                    |                |
    |   scopes, ...}        |                     |                       |                    |                |
    |---------------------->|                     |                       |                    |                |
    |                       |  createKey(req,     |                       |                    |                |
    |                       |    actor, ip)       |                       |                    |                |
    |                       |-------------------->|                       |                    |                |
    |                       |                     |  generateApiKey()     |                    |                |
    |                       |                     |---------------------->|                    |                |
    |                       |                     |<-- hg_<base64url> ----|                    |                |
    |                       |                     |                       |                    |                |
    |                       |                     |  hashKey(plaintext)   |                    |                |
    |                       |                     |---------------------->|                    |                |
    |                       |                     |<-- bcrypt hash -------|                    |                |
    |                       |                     |                       |                    |                |
    |                       |                     |  encrypt(plaintext,   |                    |                |
    |                       |                     |    encryptionKey)     |                    |                |
    |                       |                     |---------------------->|                    |                |
    |                       |                     |<-- {encrypted, iv,   |                    |                |
    |                       |                     |     authTag} --------|                    |                |
    |                       |                     |                       |                    |                |
    |                       |                     |  generateKeyPrefix()  |                    |                |
    |                       |                     |---------------------->|                    |                |
    |                       |                     |<-- 8-char prefix -----|                    |                |
    |                       |                     |                       |                    |                |
    |                       |                     |  uuid.v4()  --> id    |                    |                |
    |                       |                     |                       |                    |                |
    |                       |                     |  keyRepo.create(...)  |                    |                |
    |                       |                     |--------------------------------------------->|                |
    |                       |                     |<-- entity ----------------------------------|                |
    |                       |                     |                       |                    |                |
    |                       |                     |  auditRepo.create(KEY_CREATED)              |                |
    |                       |                     |------------------------------------------------------------->|
    |                       |                     |                       |                    |                |
    |                       |<-- {key, plaintext} |                       |                    |                |
    |<-- 201 {data} --------|                     |                       |                    |                |
    |                       |                     |                       |                    |                |
    |   (plaintext returned |                     |                       |                    |                |
    |    this one time only) |                     |                       |                    |                |
```

### 8.2 Validate Key

```
  Client               Route Handler         keyService           encryptionService        KeyRepo         AuditRepo
    |                       |                     |                       |                    |                |
    |  POST /api/keys/      |                     |                       |                    |                |
    |    :id/validate       |                     |                       |                    |                |
    |  {key: "hg_..."}      |                     |                       |                    |                |
    |---------------------->|                     |                       |                    |                |
    |                       |  validateKey(key,ip)|                       |                    |                |
    |                       |-------------------->|                       |                    |                |
    |                       |                     |  generateKeyPrefix()  |                    |                |
    |                       |                     |---------------------->|                    |                |
    |                       |                     |<-- 8-char prefix -----|                    |                |
    |                       |                     |                       |                    |                |
    |                       |                     |  findByPrefix(prefix) |                    |                |
    |                       |                     |  WHERE status='active'|                    |                |
    |                       |                     |--------------------------------------------->|                |
    |                       |                     |<-- entity (or null) ---|                    |                |
    |                       |                     |                       |                    |                |
    |                       |                     |  [if found]           |                    |                |
    |                       |                     |  compareKey(plaintext,|                    |                |
    |                       |                     |    entity.keyHash)    |                    |                |
    |                       |                     |---------------------->|                    |                |
    |                       |                     |<-- true/false --------|                    |                |
    |                       |                     |                       |                    |                |
    |                       |                     |  [if match]           |                    |                |
    |                       |                     |  check status==ACTIVE |                    |                |
    |                       |                     |  check expires_at>now |                    |                |
    |                       |                     |                       |                    |                |
    |                       |                     |  updateLastUsed(id)   |                    |                |
    |                       |                     |--------------------------------------------->|                |
    |                       |                     |                       |                    |                |
    |                       |                     |  auditRepo.create(KEY_ACCESSED)             |                |
    |                       |                     |------------------------------------------------------------->|
    |                       |                     |                       |                    |                |
    |                       |<-- {valid, keyId} --|                       |                    |                |
    |<-- 200 {data} --------|                     |                       |                    |                |
```

### 8.3 Rotate Key

```
  Client               Route Handler         keyService           KeyRepo        RotationRepo     AuditRepo
    |                       |                     |                    |                |               |
    |  PUT /api/keys/       |                     |                    |                |               |
    |    :id/rotate         |                     |                    |                |               |
    |  {reason, grace?}     |                     |                    |                |               |
    |---------------------->|                     |                    |                |               |
    |                       |  rotateKey(id,      |                    |                |               |
    |                       |    reason,actor,    |                    |                |               |
    |                       |    gracePeriodMs)   |                    |                |               |
    |                       |-------------------->|                    |                |               |
    |                       |                     |                    |                |               |
    |                       |                     |  findById(oldId)   |                |               |
    |                       |                     |------------------>|                |               |
    |                       |                     |<-- existing -------|                |               |
    |                       |                     |                    |                |               |
    |                       |                     |  (verify status == ACTIVE)          |               |
    |                       |                     |                    |                |               |
    |                       |                     |  generateApiKey()  |                |               |
    |                       |                     |  hashKey(new)      |                |               |
    |                       |                     |  encrypt(new)      |                |               |
    |                       |                     |  generatePrefix()  |                |               |
    |                       |                     |  uuid.v4() --> newId                |               |
    |                       |                     |                    |                |               |
    |                       |                     |=== BEGIN TRANSACTION ===============================|
    |                       |                     |                    |                |               |
    |                       |                     |  updateStatus(     |                |               |
    |                       |                     |    oldId, ROTATING)|                |               |
    |                       |                     |------------------>|                |               |
    |                       |                     |                    |                |               |
    |                       |                     |  create(newKey)    |                |               |
    |                       |                     |------------------>|                |               |
    |                       |                     |                    |                |               |
    |                       |                     |  create(rotation   |                |               |
    |                       |                     |    record)         |                |               |
    |                       |                     |---------------------------------------->|               |
    |                       |                     |                    |                |               |
    |                       |                     |  [if no grace period]               |               |
    |                       |                     |  updateStatus(     |                |               |
    |                       |                     |    oldId, REVOKED) |                |               |
    |                       |                     |------------------>|                |               |
    |                       |                     |                    |                |               |
    |                       |                     |=== COMMIT ==========================================|
    |                       |                     |                    |                |               |
    |                       |                     |  auditRepo.create(KEY_ROTATED)      |               |
    |                       |                     |------------------------------------------------------>|
    |                       |                     |                    |                |               |
    |                       |<-- {oldKey, newKey, |                    |                |               |
    |                       |     plaintext} -----|                    |                |               |
    |<-- 200 {data} --------|                     |                    |                |               |
```

**Rotation guarantees:**
- The old key status change, new key creation, and rotation history record are
  all wrapped in a single `withTransaction()` call. If any step fails, the
  entire operation rolls back.
- The new key inherits the old key's `scopes`, `rateLimit`, and `expiresAt`.
- If `gracePeriodMs` is provided, the old key stays in `ROTATING` status until
  that time elapses. Otherwise it is immediately set to `REVOKED`.
- The audit log entry is written *after* the transaction commits, ensuring it
  reflects the final state.

---

## Related Documentation

- [API.md](API.md) -- REST API endpoint reference
- [CLI.md](CLI.md) -- CLI command reference
- [TESTING.md](TESTING.md) -- Test suite documentation
- [VULNERABILITIES.md](VULNERABILITIES.md) -- Security findings
- [CHANGELOG.md](CHANGELOG.md) -- Change history
- [HANDOFF.md](HANDOFF.md) -- Developer onboarding guide
