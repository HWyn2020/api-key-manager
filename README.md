# API Key Manager

Secure API key lifecycle management system with AES-256-GCM encryption at rest, bcrypt validation, key rotation with grace periods, per-key rate limiting, and immutable audit logging.

Built on TypeScript, Express, and SQLite. No external dependencies beyond Node.js.

## Features

- **Key Generation** -- `hg_` prefixed keys with 384-bit cryptographic entropy
- **Encryption at Rest** -- AES-256-GCM with per-key IV; plaintext keys are never stored
- **Key Rotation** -- Zero-downtime rotation with configurable grace periods
- **Expiration & Revocation** -- Automatic expiry, manual revocation with reason tracking
- **Per-Key Rate Limiting** -- Sliding window algorithm, in-memory
- **Immutable Audit Trail** -- Every lifecycle event logged with actor, timestamp, IP, and metadata
- **REST API** -- 9 endpoints with authentication, authorization, input validation, and security headers
- **CLI** -- 7 commands for terminal-based key management
- **SQLite Storage** -- WAL mode, single file, no external database required

## Quick Start

```bash
# Install
npm install

# Configure
cp .env.example .env
openssl rand -hex 32  # Paste output as ENCRYPTION_KEY in .env

# Migrate & run
npm run db:migrate
npm run dev

# Verify
curl http://localhost:3000/api/health
```

## Web Dashboard

A built-in admin dashboard is served at `http://localhost:3000` when the server is running.

**First-time setup** — create an admin key via CLI, then use it to log in:

```bash
npx tsx src/cli/index.ts create admin "Admin Key" read write admin
# Copy the plaintext key (hg_...) and use it to log in at http://localhost:3000
```

**Dashboard features:**
- **Overview** — Stats cards showing total, active, revoked keys and audit event count
- **API Keys** — Create, rotate, and revoke keys with modals; view key details and audit history
- **Audit Logs** — Filterable table with action, date range, and key ID filters; expandable metadata
- **Auth** — Secure login with API key (stored in sessionStorage, clears on tab close)

> **WSL2 note:** If `localhost:3000` doesn't load in your browser, run the server from an interactive WSL terminal, or add `networkingMode=mirrored` to `C:\Users\<you>\.wslconfig` and restart WSL.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/keys` | Create a new API key |
| GET | `/api/keys` | List keys (authenticated user) |
| GET | `/api/keys/:id` | Get key by ID |
| PUT | `/api/keys/:id/rotate` | Rotate a key |
| PUT | `/api/keys/:id/revoke` | Revoke a key |
| POST | `/api/keys/:id/validate` | Validate a plaintext key |
| GET | `/api/keys/:id/audit` | Audit history for a key |
| GET | `/api/audit` | Query audit logs |

All endpoints (except health) require `Authorization: Bearer <key>` header.

## CLI Commands

```bash
npx tsx src/cli/index.ts <command>
```

| Command | Description |
|---------|-------------|
| `create <user-id> <name> [scopes...]` | Create a new API key |
| `validate <key>` | Validate a plaintext key |
| `rotate <key-id> <reason> [grace-ms]` | Rotate a key |
| `revoke <key-id> <reason>` | Revoke a key |
| `list <user-id>` | List keys for a user |
| `history <key-id>` | Show rotation history |
| `audit [options]` | Query audit logs |

## Testing

```bash
npm test              # Run all 325 tests
npm run test:coverage # With coverage report
npm run test:watch    # Watch mode
```

20 test suites covering services, routes, middleware, CLI, integration, and end-to-end workflows.

## Security

Hardened through 3 rounds of Red Team testing with 4 specialized teams:

- **RT1 -- The Breaker**: Edge cases, overflow, unexpected input
- **RT2 -- The Infiltrator**: Auth bypass, injection, privilege escalation
- **RT3 -- The Dismantler**: Race conditions, memory leaks, logic flaws
- **RT4 -- The Ghost**: Timing attacks, silent failures, subtle cracks

**Result: Zero exploitable vulnerabilities** after final round. Full reports in `tests/security/`.

### Security Features

- Bearer token authentication on all protected endpoints
- User-scoped authorization (IDOR protection)
- Input validation with field length limits and null byte stripping
- Timing oracle mitigation (constant-time responses)
- CORS denial, security headers, body size limits
- Transaction safety on all multi-step operations
- UUID redaction in production error messages
- Grace period enforcement with automatic ROTATING key expiry

## Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | TypeScript (strict) | Type safety, IDE support |
| Runtime | Node.js 22+ | ES2022 features, built-in fetch |
| HTTP | Express 4 | Mature, middleware ecosystem |
| Database | SQLite (better-sqlite3) | Zero config, WAL mode, single file |
| Encryption | Node crypto (AES-256-GCM) | Authenticated encryption, built-in |
| Hashing | bcrypt (12 rounds) | Timing-safe key validation |
| Testing | Jest + ts-jest | TypeScript-native test runner |

## Project Structure

```
src/
  config/         # Environment config and validation
  database/       # SQLite connection, migrations, repositories
  models/         # TypeScript interfaces and enums
  services/       # Core business logic (key, encryption, audit, rate limiter)
  middleware/     # Express middleware (auth, rate limit, error handler, logger)
  routes/         # REST API endpoint handlers
  cli/            # CLI entry point and command implementations
  utils/          # Response helpers and input validators
  server.ts       # Express app bootstrap
tests/            # 325 tests across 20 suites
docs/             # Architecture, API, CLI, testing, and security documentation
```

## Documentation

- [API Reference](docs/API.md)
- [CLI Reference](docs/CLI.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Testing Guide](docs/TESTING.md)
- [Security & Vulnerabilities](docs/VULNERABILITIES.md)
- [Developer Handoff](docs/HANDOFF.md)
- [Changelog](docs/CHANGELOG.md)

## Prerequisites

- Node.js 22+
- npm

No external databases, Redis, or managed services required.

## License

[MIT](LICENSE)
