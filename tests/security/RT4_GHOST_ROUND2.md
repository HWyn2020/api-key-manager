# RT4 -- The Ghost: Round 2 Retest

**Tester:** RT4 (Ghost)
**Date:** 2026-03-22
**Scope:** Verify RT4 Round 1 fixes + hunt residual and newly introduced issues
**Status:** COMPLETE

---

## Section A: Verification of Round 1 Fixes

### RT4-001/007 (FK constraint + silent auth errors) -- VERIFIED FIXED

The migration `002_nullable_audit_key_id.ts` correctly recreates the `audit_logs` table with
`key_id TEXT REFERENCES api_keys(id)` (nullable, no NOT NULL). The `AuditLogCreate` interface
now types `keyId` as `string | null`. The auth middleware (`authMiddleware.ts:39`) now logs
errors to `console.error` instead of swallowing them silently.

**Verdict:** Fix is sound.

### RT4-002 (Timing oracle via bcrypt) -- PARTIALLY FIXED, RESIDUAL ISSUES

The dummy bcrypt compare at `keyService.ts:96` fires when `candidates.length === 0`. This
equalizes timing for the zero-candidate vs one-candidate path.

**Residual issue -- see RT4-R2-001 below.**

### RT4-005 (Grace period non-functional) -- VERIFIED FIXED

`findByPrefix` at `KeyRepository.ts:77` now queries `status IN ('active', 'rotating')`,
and `validateKey` at `keyService.ts:121` accepts both `ACTIVE` and `ROTATING` statuses.

**Residual issue -- see RT4-R2-004 below.**

### RT4-010 (DateTime format mismatch) -- VERIFIED FIXED

`AuditRepository.ts` lines 83-86 use `datetime(@startDate)` and `datetime(@endDate)`,
which normalizes input through SQLite's datetime function. The schema default is
`datetime('now')` which produces UTC strings without timezone suffix.

**Residual issue -- see RT4-R2-005 below.**

---

## Section B: New Findings

### RT4-R2-001 -- Timing Oracle: Multi-Candidate Path Leaks Candidate Count
**Severity:** MEDIUM
**File:** `src/services/keyService.ts:108-156`

When `candidates.length >= 1`, the code iterates through each candidate performing a bcrypt
compare (~250ms each). An attacker who has engineered a prefix collision (or found one
organically -- the prefix is only 8 chars of base64url, giving ~2^48 space but collisions
are possible with enough keys) can measure response time to determine the number of
candidates sharing a prefix.

- 0 candidates: 1 bcrypt (~250ms) -- the dummy hash
- 1 candidate: 1 bcrypt
- 2 candidates: up to 2 bcrypts (~500ms)
- N candidates: up to N bcrypts

The fix equalized 0 vs 1, but N>1 is distinguishable. More critically, when the *first*
candidate matches, the function returns early (line 153), so:
- 2 candidates, first matches: ~250ms
- 2 candidates, second matches: ~500ms
- 2 candidates, neither matches: ~500ms

This leaks whether the matching key is first or second in the result set.

**Recommendation:** Always iterate all candidates (or a fixed number of iterations) and
collect the match, returning only after completing all compares. Example:

```typescript
let matched: ApiKeyEntity | null = null;
for (const entity of candidates) {
  const hashMatch = await compareKey(plaintextKey, entity.keyHash);
  if (hashMatch && !matched) {
    matched = entity;
  }
}
// Then do status/expiry checks only on `matched`
```

### RT4-R2-002 -- Audit Log Pollution via Null key_id Entries
**Severity:** LOW
**File:** `src/services/keyService.ts:98-105`, `src/routes/audit.ts:54`

With nullable `key_id`, every failed validation with an unknown prefix creates an audit
entry with `key_id = null, actor_id = 'unknown'`. An attacker can flood the validation
endpoint with garbage keys to generate unbounded null-keyed audit entries.

These entries are filtered out by `audit.ts:54` (`log.keyId !== null`), so they never
appear in user-facing queries. However:

1. They consume database storage indefinitely (no retention policy enforced automatically)
2. They inflate `audit_logs` table size, degrading query performance over time
3. The `deleteOlderThan` cleanup only runs if explicitly called -- there is no scheduled job

**Recommendation:** Add an automatic audit log retention job (e.g., on a timer or at
startup) and/or rate-limit audit log creation for null-keyed entries.

### RT4-R2-003 -- Auth Error Logging Leaks Internal State to Server Logs
**Severity:** LOW
**File:** `src/middleware/authMiddleware.ts:39`

```typescript
console.error('Auth middleware error:', err);
```

This logs the full error object including stack trace to server stdout/stderr. If the error
originates from bcrypt (e.g., malformed hash in DB), the log will contain the hash value.
If it originates from the database layer, it may contain SQL fragments or table names.

This is not an external information leak (the HTTP response is generic), but it is an
internal log leak. If logs are shipped to a centralized logging service (ELK, CloudWatch,
etc.), this data could be accessible to operations staff who should not see cryptographic
material.

**Recommendation:** Sanitize the error before logging -- log only `err.message` (not the
full object), or redact known sensitive patterns.

### RT4-R2-004 -- ROTATING Keys Have No Enforced Expiry: Infinite Grace Period
**Severity:** HIGH
**File:** `src/services/keyService.ts:121-130`, `src/database/repositories/KeyRepository.ts:75-79`

The `rotateKey` function sets `old_key_valid_until` in the `rotation_history` table
(line 204-205), but **nothing reads this value during validation**. The `validateKey`
function only checks:

1. `status IN (ACTIVE, ROTATING)` -- line 121
2. `expiresAt` -- line 132

A ROTATING key passes both checks (status is ROTATING, and `expiresAt` is the original
key's expiry -- not the grace period). The `old_key_valid_until` is stored in
`rotation_history` but **never consulted**.

This means a ROTATING key remains valid **forever** (or until its original `expiresAt`),
completely ignoring the grace period. The grace period is decorative.

To exploit: rotate a key with `gracePeriodMs: 1000` (1 second). After 1 second, the old
key should be invalid. But because `validateKey` only checks `status = ROTATING` and the
original `expiresAt`, the old key continues to work indefinitely.

The only path to revocation is the `if (!gracePeriodMs)` branch at line 218, which
immediately revokes keys rotated without a grace period. Keys rotated *with* a grace
period stay ROTATING forever.

**Recommendation:** During validation of ROTATING keys, look up the `rotation_history`
record and check `old_key_valid_until`:

```typescript
if (entity.status === KeyStatus.ROTATING) {
  const rotation = rotationRepo.findByOldKeyId(entity.id);
  if (rotation && new Date(rotation.oldKeyValidUntil) <= new Date()) {
    keyRepo.updateStatus(entity.id, KeyStatus.REVOKED, 'Grace period expired');
    // log and continue to next candidate
    continue;
  }
}
```

Or add a scheduled job that revokes ROTATING keys past their `old_key_valid_until`.

### RT4-R2-005 -- datetime() Silently Returns NULL for Invalid Date Strings
**Severity:** MEDIUM
**File:** `src/database/repositories/AuditRepository.ts:83-86`

SQLite's `datetime()` function returns NULL for unrecognizable input:

```sql
SELECT datetime('not-a-date');  -- returns NULL
SELECT datetime('2024-13-45');  -- returns NULL
```

When a user passes `startDate=garbage` to the audit query endpoint, the validator at
`validator.ts:131` uses `Date.parse()` which is lenient (e.g., `Date.parse('2024-01-01T99:99:99')` returns NaN and is caught). However, there are edge cases where
`Date.parse()` succeeds but SQLite's `datetime()` returns NULL:

- `Date.parse('Sat, 01 Jan 2024 00:00:00 GMT')` => valid JS timestamp
- `datetime('Sat, 01 Jan 2024 00:00:00 GMT')` => NULL in SQLite

When `datetime(@startDate)` returns NULL, the condition `created_at >= NULL` evaluates
to NULL (falsy in SQL), which means **no rows match** -- the query silently returns
empty results instead of an error.

**Recommendation:** Enforce ISO-8601 format validation in the validator with a strict
regex (e.g., `/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/`) before the value
reaches SQLite.

### RT4-R2-006 -- Request Logger Leaks Full URL Path Including Key IDs
**Severity:** LOW
**File:** `src/middleware/requestLogger.ts:13`

```typescript
console.log(`[${timestamp}] ${req.method} ${req.originalUrl} - ${res.statusCode} ...`);
```

The `originalUrl` includes path parameters. For requests like
`GET /api/keys/550e8400-e29b-41d4-a716-446655440000`, the full key UUID is logged. While
UUIDs are not secrets, they are authorization-relevant identifiers. Combined with the
error handler's UUID redaction (`errorHandler.ts:3`), there is an inconsistency: error
messages redact UUIDs, but request logs do not.

**Recommendation:** Apply the same UUID redaction to request logs, or document the
inconsistency as intentional.

### RT4-R2-007 -- AuditService.log() Types keyId as string (Not Nullable)
**Severity:** LOW
**File:** `src/services/auditService.ts:8`

```typescript
log(params: {
  keyId: string;  // <-- should be string | null
  ...
```

The `auditService.log()` method types `keyId` as `string`, not `string | null`. This means
TypeScript will reject calls with `keyId: null` at compile time. The underlying
`AuditLogCreate` interface correctly types it as `string | null`, but the service wrapper
narrows it.

Currently `auditService.log()` is only called from `keys.ts:252` with a real keyId, so
this is not a runtime bug. But it creates a type-safety gap: if anyone tries to use
`auditService.log()` for null-keyed audit entries (as `keyService.validateKey` does
directly via `auditRepo.create()`), TypeScript will block it, forcing them to bypass
the service layer.

**Recommendation:** Update the type to `keyId: string | null`.

### RT4-R2-008 -- Race Condition: Validate-then-Act in Route Handlers
**Severity:** MEDIUM
**File:** `src/routes/keys.ts:148-149, 193-194, 226-227`

The rotate, revoke, and validate endpoints follow a pattern:

```typescript
const targetKey = await keyService.getKey(req.params.id);  // READ
if (!targetKey || req.apiKeyEntity!.userId !== targetKey.userId) { ... }
const result = await keyService.rotateKey(req.params.id, ...);  // WRITE
```

Between the ownership check and the mutation, the key's state could change (e.g., another
request revokes it). The `keyService.rotateKey` does its own transaction-internal check
(`existing.status !== KeyStatus.ACTIVE`), which partially mitigates this. But for
`revokeKey`, the race is:

1. Request A: getKey -> key exists, ACTIVE, owned by user
2. Request B: revokeKey -> key revoked
3. Request A: revokeKey -> throws "already revoked" -> 409 to user

This is a minor TOCTOU. The error is caught and surfaced, so it is not a security hole,
but it could be confusing. More concerning: the ownership check in step 1 is not repeated
inside the transaction. If ownership could change (unlikely in current schema since
`user_id` is immutable), this would be exploitable.

**Verdict:** Low practical risk given immutable `user_id`, but worth noting.

### RT4-R2-009 -- No Maximum on gracePeriodMs Allows Absurdly Long Grace Periods
**Severity:** MEDIUM
**File:** `src/utils/validator.ts:97-101`, `src/services/keyService.ts:204-205`

The validator only checks that `gracePeriodMs` is a positive number. There is no upper
bound. An attacker (or misconfigured client) can pass:

```json
{ "reason": "rotate", "gracePeriodMs": 999999999999999 }
```

This sets `old_key_valid_until` to a date ~31,000 years in the future. Combined with
RT4-R2-004 (grace period not enforced during validation), this is moot today. But if
RT4-R2-004 is fixed, an unbounded grace period would allow keeping old keys alive
indefinitely by design.

**Recommendation:** Cap `gracePeriodMs` at a reasonable maximum (e.g., 7 days =
604800000ms). Enforce in the validator.

---

## Section C: Summary

| ID | Severity | Status | Summary |
|----|----------|--------|---------|
| RT4-001/007 | -- | FIXED | FK constraint + silent auth errors |
| RT4-002 | -- | PARTIAL | Dummy bcrypt added but multi-candidate timing leak remains (RT4-R2-001) |
| RT4-005 | -- | PARTIAL | ROTATING accepted but grace period not enforced (RT4-R2-004) |
| RT4-010 | -- | PARTIAL | datetime() used but silent NULL on non-ISO input (RT4-R2-005) |
| RT4-R2-001 | MEDIUM | NEW | Multi-candidate bcrypt iteration leaks candidate count |
| RT4-R2-002 | LOW | NEW | Null key_id audit entries enable storage exhaustion |
| RT4-R2-003 | LOW | NEW | Auth error logging may expose cryptographic material |
| RT4-R2-004 | HIGH | NEW | ROTATING keys never expire -- grace period is decorative |
| RT4-R2-005 | MEDIUM | NEW | datetime() silently returns NULL for non-ISO dates |
| RT4-R2-006 | LOW | NEW | Request logger exposes key UUIDs (inconsistent with error handler redaction) |
| RT4-R2-007 | LOW | NEW | auditService.log() keyId type does not accept null |
| RT4-R2-008 | MEDIUM | NEW | TOCTOU between ownership check and mutation in route handlers |
| RT4-R2-009 | MEDIUM | NEW | No upper bound on gracePeriodMs |

**Critical path:** RT4-R2-004 is the highest severity finding. The grace period mechanic
is entirely non-functional -- `old_key_valid_until` is written but never read. This means
rotated keys with a grace period remain valid indefinitely, defeating the purpose of key
rotation.

---

*The ghost sees what the living overlook.*
