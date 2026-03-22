# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.0] - 2026-03-22

Phase 5: Documentation (by Claude Code, VJ's team)

### Added

- `docs/MISSION.md` -- Project vision, problem statement, and roadmap
- `docs/ARCHITECTURE.md` -- System design, component details, data flows, and technology stack
- `docs/API.md` -- Complete REST API reference with all 9 endpoints, request/response formats, error codes, and examples
- `docs/CLI.md` -- CLI command reference with all 7 commands, arguments, options, and examples
- `docs/TESTING.md` -- Test suite documentation, structure, how to run tests, and how to add new tests
- `docs/VULNERABILITIES.md` -- Consolidated vulnerability report referencing `tests/security/VULNERABILITY_REPORT.md`
- `docs/CHANGELOG.md` -- Complete change history across all phases
- `docs/HANDOFF.md` -- Developer onboarding guide with setup instructions, project structure, and known issues

### Changed

- `docs/MISSION.md` -- Rewrote with accurate project details, technology choices, and phase status (previously a stub)
- `docs/ARCHITECTURE.md` -- Rewrote completely with actual project structure, data flows, schema diagrams, and component details (previously referenced Redis/controllers that don't exist)

## [0.4.0] - 2026-03-22

Phase 4: Tests & Security Audit (by Claude Code, VJ's team -- 5 parallel agents)

### Added

- `jest.config.ts` -- Jest configuration with ts-jest preset
- `tests/services/encryptionService.test.ts` -- 12 tests for encrypt/decrypt, hashing, key generation
- `tests/services/keyService.test.ts` -- 22 tests for full key lifecycle
- `tests/services/rateLimiter.test.ts` -- 9 tests for sliding window rate limiter
- `tests/services/auditService.test.ts` -- 6 tests for audit logging
- `tests/routes/setup.ts` -- Test helper factory for in-memory Express app
- `tests/routes/health.test.ts` -- 3 tests for health endpoint
- `tests/routes/keys.test.ts` -- 22 tests for key CRUD, rotation, revocation, validation
- `tests/routes/audit.test.ts` -- 7 tests for audit log queries
- `tests/middleware/errorHandler.test.ts` -- 8 tests for error mapping
- `tests/middleware/requestLogger.test.ts` -- 5 tests for request logging
- `tests/middleware/rateLimitMiddleware.test.ts` -- 7 tests for rate limit middleware
- `tests/cli/commands.test.ts` -- 26 tests for all 7 CLI commands
- `tests/security/VULNERABILITY_REPORT.md` -- Red Team audit report with 16 findings (3 Critical, 4 High, 5 Medium, 4 Low)

Total: 127 tests across 11+ suites (49 service, 32 route, 20 middleware, 26 CLI), all passing.

## [0.3.0] - 2026-03-22

Phase 3: CLI & Routes (by Claude Code, VJ's team -- 4 parallel agents)

### Added

- `src/utils/response.ts` -- `ApiResponse<T>` type, `success()`/`error()` factories, named error constructors (`badRequest`, `notFound`, `unauthorized`, `forbidden`, `tooManyRequests`, `internalError`)
- `src/utils/validator.ts` -- Input validation for key creation, revocation, rotation, and query parameters
- `src/middleware/errorHandler.ts` -- Global error handler mapping errors to HTTP status codes (404, 409, 500), production error suppression
- `src/middleware/requestLogger.ts` -- Request/response logging with method, URL, status, duration, and IP
- `src/middleware/rateLimitMiddleware.ts` -- Per-key rate limit enforcement with `X-RateLimit-*` headers
- `src/middleware/index.ts` -- Barrel exports
- `src/routes/health.ts` -- `GET /api/health` endpoint
- `src/routes/keys.ts` -- 7 key management endpoints (create, list, get, rotate, revoke, validate, audit-per-key)
- `src/routes/audit.ts` -- `GET /api/audit` with full filter support (keyId, action, actor, date range, pagination)
- `src/routes/index.ts` -- Route aggregator mounting `/health`, `/keys`, `/audit`
- `src/server.ts` -- Express app factory with database initialization, service wiring, middleware chain, and start/stop methods
- `src/cli/index.ts` -- CLI entry point with arg parser, command dispatcher, and database lifecycle management
- `src/cli/types.ts` -- `CliDeps` interface
- `src/cli/commands/create.ts` -- `create <user-id> <name> [scopes...]`
- `src/cli/commands/validate.ts` -- `validate <key>`
- `src/cli/commands/rotate.ts` -- `rotate <key-id> <reason> [grace-period-ms]`
- `src/cli/commands/revoke.ts` -- `revoke <key-id> <reason>`
- `src/cli/commands/list.ts` -- `list <user-id> [--status] [--limit]`
- `src/cli/commands/history.ts` -- `history <key-id>`
- `src/cli/commands/audit.ts` -- `audit [--key-id] [--action] [--actor-id] [--limit]`
- `src/cli/commands/index.ts` -- Barrel exports

## [0.2.0] - 2026-03-22

Phase 2: Core Service Layer (by Claude Code, instance 2 -- VJ's team)

### Added

- `src/services/encryptionService.ts` -- AES-256-GCM encrypt/decrypt, bcrypt hash/compare, `hg_`-prefixed key generation, 8-char prefix extraction
- `src/services/keyService.ts` -- Full key lifecycle: `createKey`, `validateKey`, `rotateKey`, `revokeKey`, `listKeys`, `getKey`, `expireKeys`
- `src/services/rateLimiter.ts` -- In-memory sliding window rate limiter with `check`, `increment`, `reset`, `cleanup`
- `src/services/auditService.ts` -- Thin wrapper over AuditRepository: `log`, `getKeyHistory`, `query`, `cleanup`
- `src/services/index.ts` -- Barrel exports for all services

### Fixed

- `tsconfig.json` -- Removed deprecated `baseUrl`/`paths` options, updated `module` to `Node16`, `moduleResolution` to `node16`

## [0.1.0] - 2026-03-22

Phase 1: Models & Database (by Claude Code, instance 1)

### Added

- `package.json` -- Project metadata, dependencies (bcrypt, better-sqlite3, express, ioredis, jose, uuid), dev dependencies (jest, ts-jest, typescript, tsx), npm scripts
- `tsconfig.json` -- TypeScript configuration (strict mode, ES2020 target)
- `.env.example` -- Environment variable template
- `.gitignore` -- Git ignore rules
- `src/config/index.ts` -- Environment config loader with `loadConfig()` and `loadTestConfig()`
- `src/models/Key.ts` -- `ApiKeyEntity`, `KeyStatus` enum, `KeyCreateRequest`, `KeyResponse` interfaces
- `src/models/AuditLog.ts` -- `AuditLogEntry`, `AuditAction` enum, `AuditLogQuery` interface
- `src/models/RotationHistory.ts` -- `RotationRecord`, `RotationCreate` interface
- `src/models/index.ts` -- Barrel exports
- `src/database/connection.ts` -- SQLite connection with WAL mode and performance pragmas
- `src/database/index.ts` -- Database initialization (connection + migration runner)
- `src/database/migrate.ts` -- Version-tracked migration runner
- `src/database/migrations/001_initial_schema.ts` -- Initial schema: 4 tables (`api_keys`, `rotation_history`, `audit_logs`, `schema_migrations`) with 12 indexes
- `src/database/repositories/KeyRepository.ts` -- Key CRUD, prefix lookup, expiration queries, transaction support
- `src/database/repositories/AuditRepository.ts` -- Audit log CRUD, filtered queries, retention cleanup
- `src/database/repositories/RotationRepository.ts` -- Rotation history tracking
- `STATUS.md` -- Phase tracking document
- `INBOX.md` -- Task assignment file
- `OUTBOX.md` -- Progress reporting file

[0.5.0]: https://github.com/HWyn2020/api-key-manager/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/HWyn2020/api-key-manager/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/HWyn2020/api-key-manager/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/HWyn2020/api-key-manager/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/HWyn2020/api-key-manager/releases/tag/v0.1.0
