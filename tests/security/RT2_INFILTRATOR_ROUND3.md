# RT2 Infiltrator - Round 3 Retest Report

**Date:** 2026-03-22
**Tester:** RT2 (Automated Security Retest - Round 3)
**Scope:** Verify Round 2 patches (field lengths, status enum, audit limit) + attempt new infiltration vectors against hardened system

---

## SECTION A: VERIFICATION OF ROUND 2 FIXES

### R2-NEW-1: No max field length enforcement -- VERIFIED FIXED

**File:** `src/utils/validator.ts` lines 39-58, 93-96, 113-114

- `keyName`: capped at 255 chars (line 43-44), null bytes stripped (line 42)
- `reason` (revoke): capped at 1000 chars (line 95)
- `reason` (rotate): capped at 1000 chars (line 114)
- Individual scope strings: capped at 100 chars (line 56-57), null bytes stripped (line 55)

**Verdict:** PASS

### R2-NEW-2: No max cap on scopes array length -- VERIFIED FIXED

**File:** `src/utils/validator.ts` line 50

```typescript
} else if (b.scopes.length > 50) {
  errors.push('scopes must contain at most 50 entries');
}
```

Scopes array is capped at 50 entries.

**Verdict:** PASS

### R2-NEW-6: Status query param not validated against enum -- VERIFIED FIXED

**File:** `src/routes/keys.ts` lines 9, 77-88

```typescript
const VALID_KEY_STATUSES = new Set(Object.values(KeyStatus));
// ...
if (status !== undefined) {
  if (!VALID_KEY_STATUSES.has(status as KeyStatus)) {
    // returns 400
  }
}
```

Status is validated against the `KeyStatus` enum. Invalid values return 400.

**Verdict:** PASS

### R2-NEW-3: Validate audit uses hardcoded 'anonymous' actorId -- STILL OPEN

**File:** `src/routes/keys.ts` line 269

```typescript
actorId: 'anonymous',
```

The failed validation audit log entry still uses `'anonymous'` instead of `getActorId(req)`. This was a LOW severity finding in Round 2 and remains unpatched. Not a security vulnerability -- it is an audit quality gap.

**Verdict:** STILL OPEN (LOW -- unchanged from R2)

### R2-NEW-4: Validate rate limiter keyed on IP only -- STILL OPEN (ACCEPTED)

**File:** `src/routes/keys.ts` line 250

Rate limiter still uses `validate:${clientIp}`. This was a LOW/design-tradeoff item in Round 2.

**Verdict:** STILL OPEN (LOW -- accepted risk)

---

## SECTION B: NEW INFILTRATION VECTORS TESTED

### VECTOR-1: Prototype pollution via JSON body

**Attack:** Send `{ "__proto__": { "isAdmin": true }, "keyName": "test", "scopes": ["read"] }` to `POST /api/keys`. Can we pollute `Object.prototype` through Express's JSON parser?

**Analysis:** Express uses `JSON.parse()` internally, which does not invoke setters on `__proto__`. The parsed object has a `__proto__` *own property*, but `Object.prototype` is not modified. The validators cast with `as Record<string, unknown>` and only access known keys. The extra `__proto__` property is ignored.

Additionally tested: `{ "constructor": { "prototype": { "isAdmin": true } } }`. Same result -- `JSON.parse` creates plain objects, no prototype chain mutation occurs.

**Verdict:** NOT EXPLOITABLE. Express JSON parsing is safe against prototype pollution.

### VECTOR-2: Parameter pollution on query strings (HPP)

**Attack:** Send `GET /api/keys?status=active&status=revoked` to bypass the status enum validation.

**Analysis:** Express parses duplicate query params as an array: `req.query.status` becomes `['active', 'revoked']`. The check at keys.ts line 78 is:

```typescript
if (!VALID_KEY_STATUSES.has(status as KeyStatus))
```

`Set.has()` with an array argument returns `false` because the Set contains strings, not arrays. This means the request is correctly rejected with 400.

However, in the `KeyRepository.list()` method (KeyRepository.ts line 89-93), if an array somehow reached it:

```typescript
if (options.status) {
  conditions.push('status = @status');
  params.status = options.status;
}
```

`better-sqlite3` would call `.toString()` on the array, producing `'active,revoked'`, which would match nothing. So even if the route validation were bypassed, no SQL injection or logic error would occur.

**Verdict:** NOT EXPLOITABLE. Validation correctly rejects array values; defense-in-depth holds.

### VECTOR-3: Integer overflow / extreme values in numeric params

**Attack vectors tested:**
- `expiresInHours: Number.MAX_SAFE_INTEGER` (9007199254740991)
- `expiresInHours: 1e308` (near Infinity)
- `rateLimit.windowMs: 0.0001` (fractional)
- `rateLimit.maxRequests: 0.0001` (fractional)
- `gracePeriodMs: 604800001` (just over max)
- `limit: 999999999999`

**Analysis:**

1. `expiresInHours`: `isPositiveNumber` checks `isFinite(value) && value > 0`, so `Infinity` and `NaN` are rejected. But `Number.MAX_SAFE_INTEGER` passes. The expiry calculation in keyService.ts line 51 is:
   ```typescript
   new Date(Date.now() + request.expiresInHours * 60 * 60 * 1000)
   ```
   With `expiresInHours = 9007199254740991`, the multiplication overflows to `Infinity`, and `new Date(Infinity)` produces `Invalid Date`. The `.toISOString()` call on an invalid date throws a `RangeError`, which propagates to the error handler and returns 500.

   **Finding: RT2R3-01** (see Section C)

2. `rateLimit.windowMs` and `maxRequests`: `isPositiveNumber` allows fractional values like `0.0001`. These are stored in the DB as-is (SQLite stores them as REAL). A `maxRequests` of `0.0001` means the rate limiter would effectively block all requests after the first one. This is self-inflicted DoS -- the attacker harms only themselves.

   **Verdict:** LOW. Self-harming only.

3. `gracePeriodMs: 604800001`: Correctly rejected by the `> 604800000` check at validator.ts line 120. **PASS.**

4. `limit: 999999999999`: The route caps it: `Math.min(parseInt(limit as string, 10), 100)`. Maximum effective limit is 100. **PASS.**

### VECTOR-4: UUID path parameter injection

**Attack:** Send requests with non-UUID path parameters like `GET /api/keys/../../etc/passwd` or `GET /api/keys/'; DROP TABLE api_keys; --`.

**Analysis:** The `req.params.id` value is passed to `keyRepo.findById(id)` which uses a parameterized query:

```typescript
'SELECT * FROM api_keys WHERE id = ?'
```

Parameterized queries prevent SQL injection. The malicious ID simply matches no rows, returning 404.

Path traversal is not relevant here because the ID is used as a database lookup value, never as a file path.

**Verdict:** NOT EXPLOITABLE. Parameterized queries prevent injection.

### VECTOR-5: Null byte injection in string fields

**Attack:** Send `keyName: "legitimate\x00<script>alert(1)</script>"` to attempt null byte truncation.

**Analysis:** The validator calls `stripNullBytes()` on `keyName` (line 42) and each scope (line 55):

```typescript
export function stripNullBytes(str: string): string {
  return str.replace(/\0/g, '');
}
```

Null bytes are stripped before length validation and storage.

However, `reason` in `validateRevoke` and `validateRotate` does NOT strip null bytes. See RT2R3-02.

**Verdict:** PARTIALLY MITIGATED. Null byte stripping applied to `keyName` and `scopes` but not to `reason` fields.

### VECTOR-6: Audit log memory exhaustion via unbounded getKeyHistory

**Attack:** The `GET /api/keys/:id/audit` endpoint calls `auditService.getKeyHistory(keyId, limit)` where `limit` defaults to `undefined` when not provided. The `AuditRepository.findByKeyId` defaults to `limit = 50` (AuditRepository.ts line 56).

**Analysis:** The route validates `limit` when provided (must be positive integer), but does NOT cap it with `Math.min()`:

```typescript
const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
const logs = auditService.getKeyHistory(req.params.id, limit);
```

If an attacker sends `?limit=999999`, the full value is passed to `findByKeyId`, which uses it directly in the SQL `LIMIT` clause. For a key with many audit entries, this could return a very large result set.

However, `AuditRepository.findByKeyId` signature is `findByKeyId(keyId: string, limit = 50)` -- the default is 50 but a caller can override it to any value.

Compare with the main keys list endpoint which does `Math.min(parseInt(limit as string, 10), 100)`.

See RT2R3-03.

### VECTOR-7: CORS bypass via non-browser clients

**Attack:** The CORS protection in server.ts (lines 37-48) blocks requests with an `Origin` header. But non-browser clients (curl, Postman, server-to-server) do not send `Origin` headers, so they pass through freely.

**Analysis:** This is by design -- the API is meant to be called by server-side clients. The `Origin` check only prevents browser-based CSRF. API key authentication is the primary access control. A browser-based attacker cannot forge the `Authorization: Bearer` header cross-origin.

**Verdict:** NOT EXPLOITABLE. The CORS block is defense-in-depth for browsers. API key auth is the real gate.

### VECTOR-8: Race condition in validate rate limiter (check-then-increment)

**Attack:** The validate endpoint does `check()` then `increment()` as two separate calls (keys.ts lines 251-262). Under high concurrency, multiple requests could pass the `check()` before any `increment()` is processed, exceeding the rate limit.

**Analysis:** Node.js is single-threaded for JavaScript execution. The `check()` and `increment()` calls are synchronous in-memory Map operations. Between them, no other request's `check()` can execute (no `await` between check and increment). The rate limiter is race-condition-safe in Node.js's event loop model.

**Verdict:** NOT EXPLOITABLE. Single-threaded execution model prevents this race.

### VECTOR-9: Request body size limit bypass via chunked transfer encoding

**Attack:** Send a body larger than 100KB using chunked transfer encoding to bypass `express.json({ limit: '100kb' })`.

**Analysis:** Express's `body-parser` (which backs `express.json()`) checks the `Content-Length` header AND counts bytes during parsing of chunked encoding. It rejects payloads exceeding the limit regardless of transfer encoding.

**Verdict:** NOT EXPLOITABLE.

### VECTOR-10: Scope-based authorization enforcement

**Attack:** Keys are created with specific `scopes`, but are these scopes actually enforced on any endpoint?

**Analysis:** Scopes are stored in the database and returned in API responses, but NO middleware or route handler checks whether the authenticated key's scopes authorize the requested operation. Every authenticated key can perform every operation (create, list, rotate, revoke, validate, audit).

This is an authorization gap if scopes are intended to restrict access. Currently scopes are metadata-only.

See RT2R3-04.

---

## SECTION C: NEW FINDINGS

### RT2R3-01: expiresInHours extreme values cause 500 error (LOW)

**Severity:** LOW
**File:** `src/utils/validator.ts` (validateKeyCreate), `src/services/keyService.ts` line 51
**Vector:** `POST /api/keys` with `expiresInHours: 9007199254740991`

The validator accepts any positive finite number, but extremely large values cause `Date` arithmetic overflow, producing `Invalid Date` and a `RangeError` on `.toISOString()`. This results in an unhandled 500 error rather than a clean 400 validation rejection.

**Impact:** Denial of service at the request level (500 error). No data corruption. The error handler catches it gracefully, but it should be caught earlier.

**Recommendation:** Add an upper bound to `expiresInHours` in the validator. A reasonable maximum would be 87600 (10 years):

```typescript
if (b.expiresInHours !== undefined) {
  if (!isPositiveNumber(b.expiresInHours)) {
    errors.push('expiresInHours must be a positive number');
  } else if ((b.expiresInHours as number) > 87600) {
    errors.push('expiresInHours must be at most 87600 (10 years)');
  }
}
```

### RT2R3-02: Null byte stripping not applied to reason fields (LOW)

**Severity:** LOW
**Files:** `src/utils/validator.ts` lines 84-100 (validateRevoke), 102-126 (validateRotate)

The `stripNullBytes()` function is applied to `keyName` and scope strings, but NOT to the `reason` field in `validateRevoke` and `validateRotate`. Null bytes in `reason` are stored in the database and audit log metadata. While SQLite handles null bytes in TEXT columns without truncation, downstream consumers (log aggregators, monitoring dashboards) may truncate or misinterpret strings containing null bytes.

**Impact:** Low. No direct security exploit, but inconsistent sanitization.

**Recommendation:** Apply `stripNullBytes()` to the `reason` field in both validators after the non-empty check:

```typescript
if (!isNonEmptyString(b.reason)) {
  errors.push('reason is required and must be a non-empty string');
} else {
  b.reason = stripNullBytes(b.reason as string);
  if ((b.reason as string).length > 1000) {
    errors.push('reason must be at most 1000 characters');
  }
}
```

### RT2R3-03: Key audit endpoint limit not capped (LOW)

**Severity:** LOW
**File:** `src/routes/keys.ts` lines 300-318

The `GET /api/keys/:id/audit` endpoint validates that `limit` is a positive integer but does not apply `Math.min()` to cap it. An attacker can request `?limit=999999` to retrieve a potentially very large result set. The main `GET /api/keys` and `GET /api/audit` endpoints both cap at 100 via `Math.min(parseInt(...), 100)`, but this endpoint does not.

**Impact:** Resource exhaustion on keys with extensive audit histories. Bounded by the fact that a single key's audit log is finite, but could still produce large responses.

**Recommendation:** Apply the same cap as other list endpoints:

```typescript
const limit = req.query.limit
  ? Math.min(parseInt(req.query.limit as string, 10), 100)
  : undefined;
```

### RT2R3-04: Scopes stored but never enforced (INFO)

**Severity:** INFORMATIONAL
**Files:** `src/middleware/authMiddleware.ts`, `src/routes/keys.ts`, `src/middleware/rateLimitMiddleware.ts`

API keys are created with `scopes` arrays (e.g., `["keys:read", "keys:write"]`), but no middleware or route handler checks whether the authenticated key has the required scope for the requested operation. Every valid key has full access to all endpoints.

If scopes are intended as a future feature with no current enforcement contract, this is fine. If users expect scopes to restrict access, this is a functional authorization gap.

**Impact:** No current exploit since all keys belong to their own user's data (tenant isolation is enforced via `userId`). However, if the API is extended with admin endpoints or cross-user operations, missing scope enforcement would become a real vulnerability.

**Recommendation:** Either (a) document that scopes are metadata-only and not enforced, or (b) add a scope-checking middleware.

### RT2R3-05: rateLimit.windowMs and maxRequests accept fractional values (INFO)

**Severity:** INFORMATIONAL
**File:** `src/utils/validator.ts` lines 72-73

`isPositiveNumber` allows fractional values for `rateLimit.windowMs` and `rateLimit.maxRequests`. A `maxRequests: 0.5` or `windowMs: 0.001` is technically valid but semantically nonsensical. The rate limiter will function but with unexpected behavior (e.g., `maxRequests: 0.5` means every request is rate-limited since `0 < 0.5` passes but `1 < 0.5` fails).

**Impact:** Self-inflicted misconfiguration only. Attacker harms only their own key.

**Recommendation:** Use `Number.isInteger` for these fields, or at minimum enforce `>= 1`.

---

## SECTION D: SUMMARY TABLE

| ID         | Severity | Status           | Description                                              |
|------------|----------|------------------|----------------------------------------------------------|
| R2-NEW-1   | MEDIUM   | VERIFIED FIXED   | Field length enforcement added                           |
| R2-NEW-2   | LOW      | VERIFIED FIXED   | Scopes array capped at 50                                |
| R2-NEW-3   | LOW      | STILL OPEN       | Validate audit uses hardcoded 'anonymous' actorId        |
| R2-NEW-4   | LOW      | ACCEPTED         | Validate rate limiter keyed on IP only                   |
| R2-NEW-6   | LOW      | VERIFIED FIXED   | Status enum validation added                             |
| RT2R3-01   | LOW      | NEW              | expiresInHours extreme values cause 500                  |
| RT2R3-02   | LOW      | NEW              | Null bytes not stripped from reason fields                |
| RT2R3-03   | LOW      | NEW              | Key audit endpoint limit not capped at 100               |
| RT2R3-04   | INFO     | NEW              | Scopes stored but never enforced                         |
| RT2R3-05   | INFO     | NEW              | rateLimit fields accept fractional values                |

---

## OVERALL ASSESSMENT

**Zero critical or high severity issues found.**

All three targeted patches from Round 2 (field lengths, scopes cap, status enum) are confirmed fixed. The hardened system successfully resists prototype pollution, SQL injection, parameter pollution, null byte injection (on patched fields), CORS bypass, race conditions, and body size limit bypass.

Five new findings were identified, all LOW or INFORMATIONAL severity. The most actionable are RT2R3-01 (cap `expiresInHours`), RT2R3-02 (strip null bytes from `reason`), and RT2R3-03 (cap the audit `limit` parameter). None of these are directly exploitable for data breach or privilege escalation.

The system's security posture is solid for its current scope: single-tenant key management with per-user data isolation. The main area for future hardening is scope enforcement (RT2R3-04) if the API surface expands.
