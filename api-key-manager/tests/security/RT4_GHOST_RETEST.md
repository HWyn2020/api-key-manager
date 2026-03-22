# RT4 -- The Ghost: Retest Report

**Date**: 2026-03-22
**Scope**: Full source review of all services, middleware, routes, repositories, models, config, and database schema
**Methodology**: Line-by-line code audit targeting timing attacks, silent failures, data corruption, crypto weaknesses, information leakage, state inconsistency, and audit integrity

---

## FINDING RT4-001: Audit Logging with FK Violation on `keyId='unknown'`

**Severity**: HIGH
**Location**: `src/services/keyService.ts` lines 86-93
**Category**: Data Corruption / Silent Failure

### Description

When `validateKey()` finds zero prefix-matching candidates, it writes an audit log with `keyId: 'unknown'`. The `audit_logs` table has a foreign key constraint: `FOREIGN KEY (key_id) REFERENCES api_keys(id)`. Since no row with `id = 'unknown'` exists in `api_keys`, this INSERT will fail when `foreign_keys = ON` (which is set in `connection.ts` line 30).

However, since `better-sqlite3` is synchronous and this call is **not wrapped in a try/catch**, the thrown FK constraint error will propagate up through `validateKey()`, causing the entire validation call to throw. The `authMiddleware` catch block (line 51) catches this and returns 401, but:

1. The legitimate audit trail of failed validation attempts is lost entirely -- you never know someone is probing for keys.
2. The error message in the console log from `authMiddleware` is swallowed with a bare `catch {}` (no logging).

### Reproduction

1. Send a request with a Bearer token that has a prefix matching zero keys.
2. The `auditRepo.create({ keyId: 'unknown', ... })` call throws a SQLITE_CONSTRAINT_FOREIGNKEY error.
3. The validation function throws instead of returning `null`.
4. The auth middleware catches the error silently, returns 401.
5. No audit log is written. The probing attempt is invisible.

### Recommended Fix

Either:
- Remove the FK constraint on `audit_logs.key_id` (it is a log table, not a relational table -- referential integrity is counterproductive here), or
- Use a sentinel key row (e.g., insert a row with `id = 'unknown'` into `api_keys` during migration), or
- Wrap the audit call in a try/catch so the validation still returns `null` even if audit fails.

---

## FINDING RT4-002: Timing Oracle in `validateKey()` -- Prefix Existence Leakage

**Severity**: MEDIUM
**Location**: `src/services/keyService.ts` lines 82-144

### Description

The `validateKey()` function has three distinct timing profiles:

1. **No prefix match** (line 85): Returns almost immediately (one DB query, one failed audit INSERT that throws per RT4-001, or if FK is off, one audit INSERT).
2. **Prefix match, wrong hash**: Executes `bcrypt.compare()` which takes ~250ms at cost factor 12. Time is proportional to the number of candidates.
3. **Prefix match, correct hash**: Same bcrypt time, plus `updateLastUsed` + audit write.

An attacker can measure response time to determine whether a given 8-character prefix exists in the system. By sending keys with crafted prefixes (the prefix is `apiKey.slice(3, 11)` -- the first 8 chars after `hg_`), they can enumerate which prefixes have active keys.

This is possible because bcrypt is intentionally slow. The difference between "0ms for no candidates" and "250ms+ for one candidate" is trivially measurable over the network.

### Reproduction

1. Generate a key with prefix `AAAAAAAA` (first 8 chars of the random portion).
2. Send `Authorization: Bearer hg_AAAAAAAAxxxxxxxxx` -- measure response time (~250ms).
3. Send `Authorization: Bearer hg_BBBBBBBBxxxxxxxxx` -- measure response time (~5ms).
4. The timing difference reveals that prefix `AAAAAAAA` exists but `BBBBBBBB` does not.

### Recommended Fix

Add a constant-time floor to validation. If no candidates are found, still execute one dummy `bcrypt.compare()` against a precomputed hash before returning null. This ensures all code paths take approximately the same time.

---

## FINDING RT4-003: `JSON.parse` Crash on Corrupted `scopes` Column

**Severity**: MEDIUM
**Location**: `src/models/Key.ts` line 132

### Description

`rowToEntity()` calls `JSON.parse(row.scopes)` with no error handling. If the `scopes` column contains malformed JSON (due to manual DB editing, a migration bug, or data corruption), this will throw a `SyntaxError`.

Since `rowToEntity` is called from every `KeyRepository` read method (`findById`, `findByPrefix`, `list`, `findExpired`), a single corrupted row can crash any endpoint that reads keys, including the auth middleware's `validateKey` path. This means one corrupted row can take down authentication for the entire system.

### Reproduction

1. Directly modify a row in SQLite: `UPDATE api_keys SET scopes = 'not-json' WHERE id = '...'`
2. Any request that loads this key (by prefix match, by ID, or by listing) will throw an unhandled `SyntaxError`.
3. The error handler will return 500, but the auth middleware will return 401, masking the real issue.

### Recommended Fix

Wrap `JSON.parse(row.scopes)` in a try/catch with a fallback to an empty array and log a warning. Alternatively, validate JSON integrity at the repository layer.

---

## FINDING RT4-004: `JSON.parse` Crash on Corrupted Audit `metadata` Column

**Severity**: LOW
**Location**: `src/database/repositories/AuditRepository.ts` line 25

### Description

`rowToEntry()` calls `JSON.parse(row.metadata)` when metadata is non-null, with no error handling. A corrupted metadata value will crash any audit query endpoint.

### Reproduction

1. Corrupt a metadata field: `UPDATE audit_logs SET metadata = '{bad' WHERE id = 1`
2. Query `GET /api/audit` -- throws `SyntaxError`, returns 500.

### Recommended Fix

Wrap in try/catch, default to `null` or `{ _error: 'corrupted' }` on parse failure.

---

## FINDING RT4-005: Rotation Grace Period Leaves Key in `ROTATING` Status Permanently

**Severity**: HIGH
**Location**: `src/services/keyService.ts` lines 170-208

### Description

When `rotateKey()` is called with a `gracePeriodMs`, the old key is set to `ROTATING` status (line 172), but it is **never transitioned to `REVOKED`**. The code only revokes the old key if there is no grace period (lines 206-208). There is no background job, scheduled task, or expiration check that later revokes keys in `ROTATING` status after the grace period elapses.

Furthermore, `findByPrefix()` in `KeyRepository` (line 77) only returns keys with `status = 'active'`. A key in `ROTATING` status will NOT be found by prefix lookup, meaning validation via `validateKey()` will fail for the old key immediately -- the grace period is useless.

The `old_key_valid_until` timestamp is written to `rotation_history` but never read or enforced by any code path.

### Reproduction

1. Create a key, note its ID.
2. Rotate it with `gracePeriodMs: 300000` (5 minutes).
3. The old key is set to `ROTATING` -- it can no longer be validated (prefix lookup filters to `active` only).
4. The grace period has no effect. The old key is dead immediately.
5. The old key remains in `ROTATING` status forever. It is never cleaned up.

### Recommended Fix

Either:
- Make `findByPrefix()` also include `ROTATING` status keys, and add a check in `validateKey()` against `old_key_valid_until` from the rotation history, or
- Add a scheduled job (like `expireKeys()`) that revokes `ROTATING` keys past their grace period, or
- Revoke the old key immediately and document that grace periods are not supported.

---

## FINDING RT4-006: TOCTOU Race in `revokeKey()` -- No Transaction

**Severity**: MEDIUM
**Location**: `src/services/keyService.ts` lines 232-258

### Description

Unlike `rotateKey()` which correctly uses `withTransaction()`, the `revokeKey()` function performs a read-then-write sequence without a transaction:

1. `findById(keyId)` -- check existence and status (line 238)
2. `updateStatus(keyId, REVOKED, reason)` -- update (line 246)

Between steps 1 and 2, a concurrent request could revoke the same key, rotate it, or change its status. While SQLite's write locking reduces the practical risk, the code still has a logical race: two concurrent revoke requests could both pass the `status !== REVOKED` check and both succeed, with double audit entries.

### Recommended Fix

Wrap the read + status check + update in `withTransaction()`, matching the pattern used in `rotateKey()`.

---

## FINDING RT4-007: Auth Middleware Swallows Errors Silently

**Severity**: MEDIUM
**Location**: `src/middleware/authMiddleware.ts` line 51

### Description

The catch block at line 51 is a bare `catch {}` with no error parameter and no logging. If `keyService.validateKey()` throws for any reason (database error, FK constraint violation per RT4-001, JSON parse error per RT4-003), the error is silently swallowed and the user receives a generic 401.

This means:
- Database failures are invisible to operators.
- A corrupted row (RT4-003) will appear as "invalid API key" to the user, not as a server error.
- Debugging authentication failures becomes nearly impossible in production.

### Recommended Fix

Log the error before returning 401:
```typescript
catch (error) {
  console.error('Auth validation error:', error instanceof Error ? error.message : error);
  res.status(401).json({ ... });
}
```

---

## FINDING RT4-008: Audit Log Filtering Bypass via `actorId` Mismatch

**Severity**: MEDIUM
**Location**: `src/routes/audit.ts` lines 27-41

### Description

The audit route applies two layers of filtering:
1. Queries audit logs with `actorId: authenticatedUserId` (line 33).
2. Filters results to only include logs for keys in `userKeyIds` (line 41).

However, audit entries for failed validation attempts use `actorId: 'unknown'` (keyService.ts line 89) or `actorId: 'anonymous'` (keys.ts line 272). These entries will never match any user's query because neither layer 1 (actorId filter) nor layer 2 (keyId filter, since keyId is 'unknown') will include them.

This means failed validation attempts are **invisible to all users** through the API. There is no admin endpoint to view them. The only record is in the database (if the FK constraint is removed per RT4-001 fix) or nowhere at all.

### Recommended Fix

Provide an admin-level audit endpoint that can query all logs. At minimum, ensure failed validation audit entries use the actual key ID when available (which they do for hash-mismatch cases on line 100, but not for the no-prefix-found case on line 87).

---

## FINDING RT4-009: Unbounded Rate Limiter Memory Growth

**Severity**: LOW
**Location**: `src/services/rateLimiter.ts`

### Description

The rate limiter stores all timestamps in an in-memory `Map`. Cleanup runs every 5 minutes and removes entries older than 1 hour. However, the validate endpoint (`keys.ts` line 251) uses IP-based keys (`validate:${clientIp}`), and the global rate limit middleware uses key IDs.

An attacker behind a botnet can generate entries for thousands of unique IP addresses. Each IP accumulates up to `VALIDATE_MAX_REQUESTS` (10) timestamps before being rate-limited. Between cleanup cycles (5 minutes), an attacker can create entries for hundreds of thousands of IPs, each with up to 10 timestamps. This grows linearly with the number of unique IPs.

While the cleanup timer prevents indefinite growth, a sustained attack during a 5-minute window can consume significant memory.

### Recommended Fix

Add a maximum map size. When the map exceeds a threshold (e.g., 100,000 entries), evict the oldest entries or reject new entries with a 429.

---

## FINDING RT4-010: `datetime('now')` vs JavaScript `new Date().toISOString()` Format Mismatch

**Severity**: MEDIUM
**Location**: Schema (`001_initial_schema.ts` line 23) vs `KeyRepository.ts` line 136

### Description

The SQLite schema uses `DEFAULT (datetime('now'))` for `created_at`, which produces timestamps in the format `YYYY-MM-DD HH:MM:SS` (no `T` separator, no `Z` suffix, no milliseconds).

However, all JavaScript code uses `new Date().toISOString()` which produces `YYYY-MM-DDTHH:MM:SS.sssZ` (with `T` separator, milliseconds, and `Z` suffix).

This means:
- `created_at` from default values: `2026-03-22 14:30:00`
- `expires_at`, `revoked_at`, `last_used_at` from JS code: `2026-03-22T14:30:00.000Z`

String comparisons between these formats will produce incorrect results. For example, in `findExpired()` (KeyRepository line 169):
```sql
WHERE expires_at <= ?
```
Comparing `2026-03-22T14:30:00.000Z` (JS-generated `expires_at`) against `2026-03-22T14:31:00.000Z` (JS-generated `now`) works correctly because both use the same format.

But if `created_at` (format A) is compared against a JS-generated date (format B) in audit queries with `startDate`/`endDate` filtering (AuditRepository lines 82-88), the results can be wrong because `YYYY-MM-DD ` sorts differently from `YYYY-MM-DDT` (space < T in ASCII).

Specifically: `"2026-03-22 23:59:59" < "2026-03-22T00:00:00.000Z"` evaluates to `true` in SQLite string comparison, meaning a `created_at` of `2026-03-22 23:59:59` would be considered "before" `2026-03-22T00:00:00.000Z` -- which is wrong by nearly 24 hours.

### Reproduction

1. Let SQLite auto-populate `created_at` on an audit log (using the default).
2. Query with `startDate=2026-03-22T12:00:00.000Z`.
3. A log created at `2026-03-22 14:00:00` (2 PM) will be excluded because `"2026-03-22 14:00:00" < "2026-03-22T12:00:00.000Z"` is `true` in string comparison.

### Recommended Fix

Standardize on one format. Either:
- Change the schema defaults to use `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`, or
- Ensure all INSERT statements explicitly supply JS-formatted timestamps instead of relying on defaults.

---

## FINDING RT4-011: Key ID Leaked in 404 Error Response (Non-Production)

**Severity**: LOW
**Location**: `src/routes/keys.ts` lines 109, 149, 199, 239, 305

### Description

Multiple route handlers return the raw `req.params.id` in 404 error messages:
```typescript
message: `Key not found: ${req.params.id}`
```

While the `errorHandler` sanitizes UUIDs in production mode, these 404 responses are sent directly from route handlers, bypassing the error handler entirely. In development/staging, the full key ID is reflected back to the caller. This is a minor information disclosure.

Additionally, this reflects user input directly into the response body, which could be used for log injection or response manipulation if the ID contains special characters (though UUID format validation would mitigate this if applied).

### Recommended Fix

Use a generic message like `"Key not found"` without echoing the ID, or validate that `req.params.id` is a valid UUID before using it in responses.

---

## FINDING RT4-012: No Validation on `limit` and `offset` Query Parameters in Routes

**Severity**: LOW
**Location**: `src/routes/keys.ts` lines 81, 87-88; `src/routes/keys.ts` line 314

### Description

The `limit` and `offset` query parameters are parsed with `parseInt()` but never validated:
```typescript
limit: limit ? parseInt(limit as string, 10) : undefined,
offset: offset ? parseInt(offset as string, 10) : undefined,
```

- `parseInt("0", 10)` returns `0`, which is falsy, so `limit: 0` is treated as "no limit" and defaults to 50 in the repository. This is benign.
- `parseInt("-1", 10)` returns `-1`. SQLite `LIMIT -1` means "no limit" -- this allows dumping all rows.
- `parseInt("99999999", 10)` causes a large query result set.
- `parseInt("abc", 10)` returns `NaN`. SQLite `LIMIT NaN` is treated as `LIMIT 0`, returning no rows.

The `validator.ts` file has `validateQueryParams()` that checks for positive integers, but it is **never called** from the keys routes or audit routes. The validator exists but is unused.

### Recommended Fix

Call `validateQueryParams()` at the top of each route handler that accepts query parameters, or add validation inline.

---

## FINDING RT4-013: Validate Endpoint Rate Limiter is Per-IP but Auth Check is Per-Key

**Severity**: LOW
**Location**: `src/routes/keys.ts` lines 220-296

### Description

The `POST /:id/validate` endpoint requires authentication (the caller needs a valid API key to reach it), then applies IP-based rate limiting for the validation attempt itself. However, the rate limiting uses `req.ip` which, when behind a reverse proxy without `TRUST_PROXY=true`, will be the proxy's IP address.

If `TRUST_PROXY` is not set, all requests through a load balancer share the same `req.ip`, causing legitimate users to be rate-limited by other users' validation attempts. Conversely, if an attacker can forge `X-Forwarded-For` when `TRUST_PROXY=true` is set, they can bypass the rate limit entirely by rotating source IPs.

### Recommended Fix

Use the authenticated key ID as the rate limit key instead of (or in addition to) the IP address, since authentication is already required.

---

## FINDING RT4-014: Encryption Key in Config is Never Zeroed from Memory

**Severity**: LOW
**Location**: `src/config/index.ts`, `src/services/keyService.ts`

### Description

The encryption key is loaded from environment variables and stored as a plain string in the `AppConfig` object and in the `KeyServiceDeps` closure. JavaScript strings are immutable and cannot be securely wiped from memory. The key persists in the V8 heap until garbage collected, and may appear in heap dumps or core dumps.

While this is a known limitation of Node.js, it is worth noting as it means a memory dump of the process will reveal the encryption key in plaintext.

### Recommended Fix

This is a platform limitation. Document it as an accepted risk. For higher security, consider using a KMS or HSM for encryption operations.

---

## FINDING RT4-015: Shutdown Does Not Close Database

**Severity**: LOW
**Location**: `src/server.ts` lines 80-83

### Description

The shutdown handler calls `rateLimiter.destroy()` and `httpServer.close()`, but does not close the SQLite database connection. While SQLite WAL mode is generally resilient to ungraceful shutdown, not calling `db.close()` can result in:
- WAL file not being checkpointed
- Potential `-wal` and `-shm` files left behind
- Data written in the last WAL transaction possibly not being visible to other processes

### Recommended Fix

Add `db.close()` to the shutdown handler.

---

## FINDING RT4-016: `listKeys` in Audit Route Has Hardcoded Limit of 1000

**Severity**: MEDIUM
**Location**: `src/routes/audit.ts` line 27

### Description

The audit route fetches all of a user's keys to build a filter set:
```typescript
const userKeys = await keyService.listKeys(authenticatedUserId, { limit: 1000 });
```

If a user has more than 1000 keys, keys beyond the 1000th will not be included in `userKeyIds`. Audit logs for those keys will be silently filtered out, and the user will receive an incomplete audit trail with no indication that data is missing.

### Recommended Fix

Either paginate through all keys, or use a direct SQL query to get all key IDs for a user without the artificial limit, or use a subquery in the audit log query itself.

---

## Summary

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| RT4-001 | HIGH | Silent Failure | FK constraint on `audit_logs.key_id` breaks audit of unknown-prefix validation failures |
| RT4-002 | MEDIUM | Timing Attack | Prefix existence oracle via bcrypt timing difference |
| RT4-003 | MEDIUM | Data Corruption | `JSON.parse` crash on corrupted `scopes` column takes down all auth |
| RT4-004 | LOW | Data Corruption | `JSON.parse` crash on corrupted audit `metadata` column |
| RT4-005 | HIGH | State Inconsistency | Grace period rotation leaves old key in `ROTATING` forever; grace period is non-functional |
| RT4-006 | MEDIUM | Race Condition | `revokeKey()` has TOCTOU race -- no transaction wrapper |
| RT4-007 | MEDIUM | Silent Failure | Auth middleware bare `catch {}` swallows all errors silently |
| RT4-008 | MEDIUM | Audit Integrity | Failed validation audit entries invisible to all users via API |
| RT4-009 | LOW | Resource Exhaustion | Unbounded in-memory rate limiter growth under IP-diverse attack |
| RT4-010 | MEDIUM | Data Corruption | SQLite `datetime('now')` vs JS `toISOString()` format mismatch breaks date comparisons |
| RT4-011 | LOW | Info Leakage | Key ID reflected in 404 responses, bypassing error handler sanitization |
| RT4-012 | LOW | Input Validation | `limit`/`offset` never validated; negative limit dumps all rows; validator exists but unused |
| RT4-013 | LOW | Rate Limit Bypass | IP-based validate rate limiter bypassable via header spoofing or shared proxy IP |
| RT4-014 | LOW | Crypto Hygiene | Encryption key persists in JS heap, cannot be securely wiped |
| RT4-015 | LOW | Data Integrity | Shutdown handler does not close SQLite database |
| RT4-016 | MEDIUM | Audit Integrity | Hardcoded limit of 1000 keys silently truncates audit log filtering |

**Critical path**: RT4-001 + RT4-007 together mean that all failed validation attempts where the prefix matches zero keys are completely invisible -- no audit log, no error log, no trace. This is a monitoring blind spot that makes brute-force prefix enumeration undetectable.

**Functional bug**: RT4-005 means the grace period feature is entirely broken. Any consumer relying on grace periods for zero-downtime rotation is getting immediate invalidation of the old key.

---

*RT4 -- The Ghost*
*"What you cannot see, you cannot defend."*
