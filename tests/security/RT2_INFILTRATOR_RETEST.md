# RT2 Infiltrator Retest Report

**Date:** 2026-03-22
**Tester:** RT2 -- The Infiltrator (automated red-team agent)
**Scope:** Full source-code review of patched codebase -- all 13 primary source files
**Method:** Static analysis of all attack vectors listed in the retest brief

---

## Executive Summary

The codebase has been significantly hardened since the original 16-vulnerability report. Auth bypass, SQL injection, CORS, and most privilege-escalation vectors have been properly addressed. However, **4 exploitable issues remain** (1 Medium, 3 Low severity). These are documented below with reproduction steps and fixes.

---

## FINDING 1: Key Existence Oracle via Divergent Response Paths (GET/PUT /:id endpoints)

**Severity:** MEDIUM
**Location:** `src/routes/keys.ts` lines 100-127, 130-177, 180-218, 298-324
**CWE:** CWE-203 (Observable Discrepancy)

### Description

The `GET /:id`, `PUT /:id/rotate`, `PUT /:id/revoke`, and `GET /:id/audit` endpoints all follow the same pattern: first fetch the key by ID, return 404 if it does not exist, then check ownership and return 403. This two-step behavior creates a key-existence oracle.

An authenticated attacker (user B) can probe arbitrary key UUIDs:
- **404** = key does not exist
- **403** = key exists but belongs to someone else

This allows enumerating which key IDs are valid in the system, which is a precondition for targeted attacks.

### Reproduction Steps

1. Authenticate as user B with a valid API key.
2. Send `GET /api/keys/<user-A-key-id>`.
3. Observe 403 response (key exists, belongs to user A).
4. Send `GET /api/keys/<random-nonexistent-uuid>`.
5. Observe 404 response (key does not exist).
6. The difference confirms key existence.

### Exception: POST /:id/validate

The validate endpoint (lines 236-244) also has this pattern, but the **inner** validation response (lines 277-283) returns a generic `{ valid: false }` regardless. However, the **outer** ownership check still returns 404 vs 403 before reaching the validation logic, so the oracle exists there too.

### Recommended Fix

Return a uniform 404 "Not found" for both cases (key not found AND key not owned by caller). Replace the ownership-check pattern:

```typescript
const targetKey = await keyService.getKey(req.params.id);
if (!targetKey || req.apiKeyEntity!.userId !== targetKey.userId) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Key not found' },
  });
  return;
}
```

Apply this to all six instances in `keys.ts` (GET /:id, PUT /:id/rotate, PUT /:id/revoke, POST /:id/validate, GET /:id/audit).

---

## FINDING 2: Validate Endpoint Rate Limit Bypass via req.ip Manipulation When TRUST_PROXY=true

**Severity:** LOW (conditional -- requires TRUST_PROXY=true in production)
**Location:** `src/routes/keys.ts` lines 250-251, `src/server.ts` line 18
**CWE:** CWE-346 (Origin Validation Error)

### Description

The validate endpoint rate-limits by `req.ip`:

```typescript
const clientIp = req.ip || 'unknown';
const rateLimitKey = `validate:${clientIp}`;
```

When `TRUST_PROXY=true` is set in the environment (line 18 of `server.ts`), Express derives `req.ip` from the `X-Forwarded-For` header. An attacker can rotate this header value on each request to get a fresh rate-limit bucket, effectively bypassing the 10-requests-per-minute limit entirely.

The server does guard this behind an environment variable check (`process.env.TRUST_PROXY === 'true'`), which is good. But if deployed behind a reverse proxy (the typical reason to set this flag), any client that can reach the server directly (or inject extra `X-Forwarded-For` entries) can bypass the rate limit.

### Reproduction Steps

1. Deploy with `TRUST_PROXY=true`.
2. Send 10 POST requests to `/api/keys/:id/validate` with `X-Forwarded-For: 1.1.1.1` -- all succeed.
3. 11th request gets 429.
4. Send request with `X-Forwarded-For: 2.2.2.2` -- succeeds (new bucket).
5. Repeat with incrementing IPs -- unlimited validation attempts.

### Recommended Fix

Rate-limit the validate endpoint by the **authenticated API key ID** (which is already available as `req.apiKeyEntity!.id`) rather than by IP, or use a composite key of both. The auth middleware already ran, so the caller is identified:

```typescript
const rateLimitKey = `validate:${req.apiKeyEntity!.id}`;
```

---

## FINDING 3: No Input Length or Character Validation on keyName, scopes, and reason Fields

**Severity:** LOW
**Location:** `src/routes/keys.ts` lines 34-56 (create), 134 (rotate reason), 193 (revoke reason)
**CWE:** CWE-20 (Improper Input Validation)

### Description

The route handlers validate that `keyName`, `scopes`, and `reason` are present and non-empty, but they do not enforce:
- **Maximum length** -- an attacker can submit a 10MB key name or reason string (the body limit is 100KB, so the practical ceiling is ~100KB per field, but that is still very large for a name).
- **Character restrictions** -- arbitrary Unicode, control characters, null bytes, or HTML/script payloads can be stored and later returned verbatim in JSON responses.

Note: `src/utils/validator.ts` defines comprehensive validators (`validateKeyCreate`, `validateRevoke`, `validateRotate`) but **none of them are actually called** in the route handlers. The routes perform their own inline validation that is less thorough.

The 100KB body-size limit in `server.ts` (line 23) provides a coarse upper bound, but stored values of that size in key names or reasons can cause performance issues in listing endpoints and bloat the database.

### Reproduction Steps

1. Create a key with `keyName` set to a 50,000-character string containing HTML tags and null bytes.
2. The key is created successfully.
3. List keys -- the enormous name is returned in full.

### Recommended Fix

Either (a) call the existing validators from `src/utils/validator.ts` in the route handlers, or (b) add explicit length limits (e.g., 255 chars for keyName, 1000 chars for reason) and a character whitelist/blacklist in the inline validation. Option (a) is preferred since the validators already exist.

---

## FINDING 4: Audit Log Query Does Not Use Validators

**Severity:** LOW
**Location:** `src/routes/audit.ts` lines 12-49
**CWE:** CWE-20 (Improper Input Validation)

### Description

The audit route accepts `action`, `startDate`, `endDate`, `limit`, and `offset` as query parameters and passes them directly to the audit service without validation. The `validateQueryParams` function exists in `src/utils/validator.ts` (lines 108-168) but is never imported or called.

This means:
- `limit` and `offset` can be negative numbers, NaN, or non-integer values. While `better-sqlite3` uses parameterized queries (no SQL injection), passing unexpected values like `NaN` or `-1` could cause unexpected behavior or excessive result sets.
- `action` is not validated against the enum, so meaningless strings pass through without error.
- `startDate` and `endDate` are not validated as ISO date strings.

### Reproduction Steps

1. Send `GET /api/audit?limit=-1&offset=-5&action=garbage_value`.
2. The request succeeds -- no validation error.
3. The query may return unexpected results depending on SQLite's handling of negative LIMIT/OFFSET.

### Recommended Fix

Import and call `validateQueryParams` at the top of the audit GET handler:

```typescript
import { validateQueryParams } from '../utils/validator';

// Inside handler:
const validation = validateQueryParams(req.query as Record<string, unknown>);
if (!validation.valid) {
  res.status(400).json({
    success: false,
    error: { code: 'VALIDATION_ERROR', message: validation.errors.join('; ') },
  });
  return;
}
```

---

## Vectors Tested and Found Secure

The following attack vectors were tested and found to be properly mitigated:

### Auth Bypass -- PASS
- `authMiddleware.ts` correctly requires `Bearer ` prefix (case-sensitive, with space).
- Empty token after `Bearer ` is rejected (line 25 check).
- Missing/malformed `Authorization` header returns 401 with generic message.
- The `validateKey` function in `keyService.ts` checks status (`ACTIVE` only) and expiration, so revoked/expired keys cannot authenticate.

### Privilege Escalation -- PASS (with Finding 1 caveat)
- All mutating endpoints (`rotate`, `revoke`) and read endpoints (`GET /:id`, `GET /:id/audit`) check `req.apiKeyEntity!.userId !== targetKey.userId` before proceeding.
- `listKeys` and the audit query both filter by the authenticated user's ID.
- Key creation uses the authenticated user's `userId` from the token entity, not from the request body -- users cannot create keys for other users.

### SQL Injection -- PASS
- All database queries use parameterized statements via `better-sqlite3`'s `prepare().run()` / `.get()` / `.all()` with named (`@param`) or positional (`?`) parameters.
- No string concatenation of user input into SQL strings. The `WHERE` clause construction in `KeyRepository.list()` and `AuditRepository.list()` uses hardcoded column names with parameterized values.

### Token Reuse (Revoked/Expired Keys) -- PASS
- `keyService.validateKey()` (line 109) rejects keys with `status !== ACTIVE`.
- `keyService.validateKey()` (line 120) rejects expired keys by comparing `expiresAt` to current time.
- `KeyRepository.findByPrefix()` (line 77) only returns `ACTIVE` keys, providing defense-in-depth.

### Header Injection / Identity Spoofing -- PASS
- `getActorId()` in `keys.ts` derives actor identity from `req.apiKeyEntity?.userId`, not from any client-supplied header.
- `x-forwarded-for` is only trusted when `TRUST_PROXY=true` (environment-controlled), and even then only affects `req.ip` for logging and rate limiting, not authentication or authorization.
- No `x-actor-id` header is read anywhere in the codebase.

### CORS Bypass -- PASS
- `server.ts` (lines 37-48) blocks all requests with an `Origin` header by returning 403. This is a blanket deny for cross-origin requests.

### Path Traversal -- PASS
- Route parameters (`:id`) are used as opaque strings passed to parameterized SQL queries. Express route matching does not allow `../` traversal through path segments.

### Body Size / DoS -- PARTIAL PASS
- Express JSON body parsing is limited to 100KB (`server.ts` line 23), preventing unbounded payload attacks. However, individual field length limits are missing (see Finding 3).

### Encryption -- PASS
- AES-256-GCM with random IV and auth tag verification.
- bcrypt with 12 salt rounds for key hashing.
- API keys use 48 random bytes (384 bits of entropy), making brute-force infeasible.

### Error Handling -- PASS
- `errorHandler.ts` sanitizes UUIDs from error messages and in production mode returns generic messages, preventing information leakage in stack traces.

---

## Summary Table

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Key existence oracle (404 vs 403) | MEDIUM | OPEN |
| 2 | Validate rate-limit bypass via X-Forwarded-For | LOW | OPEN (conditional) |
| 3 | No length/character validation on stored fields | LOW | OPEN |
| 4 | Audit query params not validated | LOW | OPEN |

**Total open findings:** 4 (1 Medium, 3 Low)
**Previously reported findings now fixed:** 16/16

---

*End of RT2 Infiltrator Retest Report*
