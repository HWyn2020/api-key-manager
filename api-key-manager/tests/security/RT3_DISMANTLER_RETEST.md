# RT3 -- The Dismantler: Security Retest Report

**Date:** 2026-03-22
**Scope:** Full source audit of api-key-manager after 16-vulnerability patch cycle
**Auditor:** RT3 (automated adversarial analysis)
**Verdict:** 7 real issues found (2 HIGH, 3 MEDIUM, 2 LOW)

---

## RT3-R01: createKey is NOT wrapped in a transaction

**Severity:** HIGH
**Location:** `src/services/keyService.ts` lines 35-76 (`createKey`)
**Status:** OPEN

### Description

`createKey` performs four sequential operations that must be atomic:

1. `keyRepo.create(insertData)` -- INSERT into api_keys
2. `auditRepo.create(...)` -- INSERT into audit_logs

If the audit insert fails (e.g., FK constraint, disk full, DB locked beyond busy_timeout), the key exists in the database but no audit trail is recorded. This is an integrity violation.

More critically, the bcrypt hash and AES encryption happen *before* any DB operation, and the plaintext key is returned to the caller regardless of audit success. If audit fails and throws, the Express error handler catches it -- but the key row is already committed. The caller gets a 500, assumes failure, and the key is orphaned with no audit record.

Compare with `rotateKey` which correctly uses `withTransaction(db, () => {...})`.

### Reproduction

1. Fill the disk or corrupt the audit_logs table schema.
2. Call POST /api/keys to create a key.
3. The key row is inserted into api_keys successfully.
4. The audit insert throws.
5. Key exists with no audit trail. Caller receives 500 error but a valid key now exists in the DB.

### Recommended Fix

Wrap the create + audit in `withTransaction(db, () => {...})`, the same pattern used by `rotateKey`.

---

## RT3-R02: revokeKey has a TOCTOU race (not wrapped in transaction)

**Severity:** HIGH
**Location:** `src/services/keyService.ts` lines 232-258 (`revokeKey`)
**Status:** OPEN

### Description

`revokeKey` performs a read-then-write without a transaction:

```
const existing = keyRepo.findById(keyId);   // READ
// ... status checks ...
keyRepo.updateStatus(keyId, ...);            // WRITE
auditRepo.create(...);                       // WRITE
```

Two concurrent revoke requests for the same key can both pass the `status !== REVOKED` check before either commits the status change. The second revoke will succeed silently, creating a duplicate audit entry. While the end state (revoked) is correct, the duplicate audit log is misleading and the race demonstrates that the status guard is ineffective without a transaction.

This was fixed for `rotateKey` (which correctly uses `withTransaction`) but the same pattern was not applied to `revokeKey`.

### Reproduction

1. Create an ACTIVE key.
2. Send two concurrent PUT /:id/revoke requests.
3. Both pass the `status === REVOKED` check.
4. Both write REVOKED status and create audit entries.
5. Two KEY_REVOKED audit entries exist for one revocation.

### Recommended Fix

Wrap `revokeKey` in `withTransaction(db, () => {...})` with the status check inside the transaction, matching the `rotateKey` pattern.

---

## RT3-R03: Grace period rotation leaves old key in ROTATING status but validateKey rejects non-ACTIVE keys

**Severity:** MEDIUM
**Location:** `src/services/keyService.ts` lines 109, 165-172, 206
**Status:** OPEN

### Description

When `rotateKey` is called with a `gracePeriodMs`, the old key's status is set to `ROTATING` (line 172) and is NOT revoked (the `if (!gracePeriodMs)` block on line 206 is skipped). The intention is that the old key remains usable during the grace period.

However, `validateKey` at line 109 checks:
```typescript
if (entity.status !== KeyStatus.ACTIVE) { continue; }
```

And `findByPrefix` at KeyRepository line 77 filters:
```typescript
WHERE key_prefix = ? AND status = ?
```
passing `KeyStatus.ACTIVE`.

This means a key in ROTATING status is **never returned by findByPrefix** and **would also be rejected by the status check** even if it were. The grace period feature is completely broken -- the old key stops working immediately upon rotation regardless of the grace period value.

### Reproduction

1. Create a key, note the plaintext.
2. Rotate it with `gracePeriodMs: 300000` (5 minutes).
3. Immediately try to validate the old plaintext key.
4. Validation fails -- the old key's status is ROTATING, which is filtered out by both the DB query and the status check.

### Recommended Fix

Two changes needed:
1. `KeyRepository.findByPrefix` should also match `status = 'rotating'`.
2. `validateKey` should allow ROTATING keys that are within their grace period (check `rotation_history.old_key_valid_until`).

---

## RT3-R04: expireKeys() races with rotateKey() -- can expire a ROTATING key's replacement

**Severity:** MEDIUM
**Location:** `src/services/keyService.ts` lines 279-293 (`expireKeys`), lines 159-212 (`rotateKey`)
**Status:** OPEN

### Description

`expireKeys` is not atomic:

```typescript
const expiredEntities = keyRepo.findExpired();  // READ: find active + expired
const count = keyRepo.expireKeys();              // WRITE: update active -> expired
```

Between the `findExpired()` and `expireKeys()` calls, `rotateKey` could create a new key that inherits the old key's `expiresAt` (line 169: `const newExpiresAt = existing.expiresAt`). If the old key's expiration time has already passed, the new key is born with an already-expired `expiresAt` and will be immediately expired by the `expireKeys()` UPDATE that follows.

Additionally, `findExpired` and `expireKeys` are two separate queries with no transaction, so the audit logs generated from `expiredEntities` may not match the rows actually updated by `expireKeys`.

### Reproduction

1. Create a key with `expiresInHours: 0.001` (3.6 seconds).
2. Wait 4 seconds so it's technically expired but `expireKeys` hasn't run yet.
3. Rotate the key (it's still ACTIVE in DB).
4. The new key inherits the past `expiresAt`.
5. Run `expireKeys()` -- it expires the new key immediately.

### Recommended Fix

- Wrap `findExpired` + `expireKeys` in a single transaction.
- In `rotateKey`, if the existing key's `expiresAt` is in the past, either reject the rotation or set a fresh expiration on the new key.

---

## RT3-R05: Validate endpoint rate limiter in keys.ts is never destroyed -- memory leak

**Severity:** MEDIUM
**Location:** `src/routes/keys.ts` line 27 (`const validateRateLimiter = createRateLimiter()`)
**Status:** OPEN

### Description

The keys router creates a dedicated `validateRateLimiter` instance on line 27. This rate limiter starts a `setInterval` every 5 minutes for cleanup (rateLimiter.ts line 69).

The server shutdown handler in `server.ts` line 81 calls `rateLimiter.destroy()` on the main rate limiter, but the `validateRateLimiter` created inside the router is never destroyed. Its interval timer continues to fire after shutdown, and `unref()` only prevents it from keeping the process alive -- it does not stop it from firing and consuming CPU while the process is still running for other reasons.

More importantly, if `createServer` is called multiple times in tests (which is common), each call creates a new router with a new `validateRateLimiter` that is never cleaned up. This leaks interval timers.

### Reproduction

1. In a test, call `createServer()` 100 times.
2. Each creates a `validateRateLimiter` with an active setInterval.
3. None are ever destroyed.
4. 100 interval timers accumulate.

### Recommended Fix

Pass the validate rate limiter as a dependency or return it from the router factory so the server can destroy it during shutdown. Alternatively, use a single rate limiter instance with namespaced keys (which is already partially done via `validate:${clientIp}` prefix).

---

## RT3-R06: No limit on key creation per user -- resource exhaustion

**Severity:** LOW
**Location:** `src/services/keyService.ts` (`createKey`), `src/routes/keys.ts` (POST /)
**Status:** OPEN

### Description

There is no per-user limit on how many API keys can be created. A malicious user (or a compromised key) can call POST /api/keys in a loop to create millions of keys, each generating a bcrypt hash (CPU-intensive at 12 salt rounds) and an AES encryption, plus two DB inserts.

The general rate limiter applies per-key request limits, but a key with generous rate limits (or the default 100/minute) can create keys rapidly.

There is also no cleanup mechanism for old/expired keys -- they remain in the database forever.

### Reproduction

1. Authenticate with a valid key.
2. Loop: POST /api/keys 10,000 times.
3. Database grows unbounded. Each request costs ~250ms of bcrypt CPU time.

### Recommended Fix

- Add a per-user key count limit (e.g., max 100 active keys per user).
- Add a scheduled job or endpoint to purge expired/revoked keys older than a retention period.

---

## RT3-R07: Audit log FK constraint on key_id references api_keys(id) but uses 'unknown' for failed lookups

**Severity:** LOW
**Location:** `src/services/keyService.ts` lines 86-93, `src/database/migrations/001_initial_schema.ts` line 59
**Status:** OPEN

### Description

The `audit_logs` table has a foreign key: `FOREIGN KEY (key_id) REFERENCES api_keys(id)`.

In `validateKey`, when no candidates are found, an audit entry is created with `keyId: 'unknown'` (line 88). This should violate the FK constraint since no api_key row with id='unknown' exists.

However, SQLite's FK enforcement depends on `PRAGMA foreign_keys = ON`, which IS set in `connection.ts` line 30. This means the audit insert for unknown key validations will throw an FK violation error, which bubbles up and causes `validateKey` to throw instead of returning null. The auth middleware catches this and returns 401, but the real error (FK violation) is silently swallowed.

This means failed validation attempts against non-existent key prefixes are never audit-logged, creating a blind spot for brute-force detection.

### Reproduction

1. Start the server.
2. Send a request with a Bearer token containing a completely invalid key (no matching prefix).
3. The audit insert with keyId='unknown' throws an FK violation.
4. The error is caught by the auth middleware catch block (line 51), returning a generic 401.
5. No audit record exists for the failed attempt.

### Recommended Fix

Either:
- Remove the FK constraint on `audit_logs.key_id` (audit logs should be append-only and not constrained by key existence), or
- Create a sentinel row in api_keys with id='unknown' during migration, or
- Skip the audit insert when the key is not found (the information value is low since there's no key to correlate with).

---

## Issues Verified as Fixed

The following previously reported issues were verified as properly patched:

1. **TOCTOU in rotateKey** -- Fixed. The status check is now inside `withTransaction()` (line 159-212).
2. **Rate limiter cleanup interval** -- Fixed. `setInterval` with `unref()` is in place, `destroy()` clears the interval and map.
3. **Missing input validation on routes** -- Fixed. keyName, scopes, reason are all validated.
4. **Error handler leaking internal details** -- Fixed. Production mode sanitizes messages and redacts UUIDs.
5. **CORS blocking** -- Fixed. Cross-origin requests with `Origin` header are rejected with 403.
6. **Security headers** -- Fixed. HSTS, CSP, X-Frame-Options, no-store cache all present.
7. **Body size limit** -- Fixed. Express JSON parser limited to 100kb.
8. **SQLite WAL mode and busy_timeout** -- Fixed. Properly configured in connection.ts.
9. **bcrypt salt rounds** -- Fixed. Using 12 rounds (adequate).
10. **Encryption key validation** -- Fixed. Requires exactly 64 hex chars.
11. **Authorization checks on key operations** -- Fixed. userId ownership verified before rotate, revoke, get, audit.

## Dependency Assessment

| Package | Version | Known Issues |
|---------|---------|-------------|
| better-sqlite3 | ^11.0.0 | No known CVEs for v11.x as of 2026-03. |
| express | ^4.18.0 | Express 4.x is in maintenance mode. No critical CVEs but consider migrating to Express 5.x for active security patches. |
| bcrypt | ^5.1.0 | Clean. |
| jose | ^5.0.0 | Clean. Listed as dependency but not imported anywhere in the codebase -- dead dependency. |
| uuid | ^9.0.0 | Clean. |
| ioredis | ^5.3.0 | Listed as dependency but not imported anywhere in the codebase -- dead dependency. Redis URL is in config but never used. |

**Note:** `jose` and `ioredis` are declared in dependencies but never imported. They add attack surface for no benefit and should be removed.

---

## Summary

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| RT3-R01 | HIGH | Transaction Safety | createKey not wrapped in transaction |
| RT3-R02 | HIGH | Race Condition | revokeKey TOCTOU race (no transaction) |
| RT3-R03 | MEDIUM | Logic Flaw | Grace period rotation broken (ROTATING keys rejected by validation) |
| RT3-R04 | MEDIUM | Race Condition | expireKeys races with rotateKey on inherited expiresAt |
| RT3-R05 | MEDIUM | Memory Leak | validateRateLimiter interval timer never destroyed |
| RT3-R06 | LOW | Resource Exhaustion | No per-user key creation limit or key cleanup |
| RT3-R07 | LOW | Logic Flaw | FK constraint blocks audit logging for unknown key validations |
