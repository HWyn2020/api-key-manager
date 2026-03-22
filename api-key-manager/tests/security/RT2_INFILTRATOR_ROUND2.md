# RT2 Infiltrator - Round 2 Retest Report

**Date:** 2026-03-22
**Tester:** RT2 (Automated Security Retest)
**Scope:** Verify RT1 patches + hunt for new issues in all patched files

---

## SECTION A: VERIFICATION OF PREVIOUS FIXES

### FIX-1: Key existence oracle (404 vs 403) -- VERIFIED FIXED

**Files reviewed:** `src/routes/keys.ts` lines 14-22, 117-118, 149, 227, 296

The `notFoundResponse()` helper now returns a uniform 404 with code `NOT_FOUND` for both
"key does not exist" and "key belongs to another user". The pattern is consistent across
all endpoints: `GET /:id`, `PUT /:id/rotate`, `PUT /:id/revoke`, `POST /:id/validate`,
`GET /:id/audit`.

**Verdict:** PASS

### FIX-2: Rate-limit bypass via x-forwarded-for -- VERIFIED FIXED

**Files reviewed:** `src/server.ts` lines 17-19, `src/middleware/requestLogger.ts` lines 5-7

`app.set('trust proxy', true)` is gated behind `TRUST_PROXY === 'true'`. The request
logger also gates `x-forwarded-for` usage behind the same env var.

**Verdict:** PASS

### FIX-3: Field length validation -- VERIFIED FIXED

**Files reviewed:** `src/utils/validator.ts`, `src/routes/keys.ts` lines 36-46, 134-144, 178-188

`validateKeyCreate`, `validateRevoke`, and `validateRotate` are all called before any
business logic. Required fields are type-checked (non-empty strings, positive numbers).

**Verdict:** PASS -- with caveats (see NEW-1 below)

### FIX-4: Audit query params unvalidated -- VERIFIED FIXED

**Files reviewed:** `src/routes/audit.ts` lines 15-25, `src/utils/validator.ts` lines 108-168

`validateQueryParams` is called and checks `action` against the enum, validates date
formats, and enforces integer types for `limit`/`offset`.

**Verdict:** PASS

---

## SECTION B: NEW ATTACK VECTORS TESTED

### TEST-1: Timing side-channel on 404 (not found) vs 404 (wrong owner)

**Attack:** Measure response times to distinguish "key ID does not exist" (no DB hit
after `getKey` returns null) from "key exists but belongs to someone else" (`getKey`
returns a row, then ownership check fails).

**Analysis of `GET /:id` (keys.ts line 113-129):**
```typescript
const key = await keyService.getKey(req.params.id);
if (!key || req.apiKeyEntity!.userId !== key.userId) {
  notFoundResponse(res, req.params.id);
  return;
}
```

`keyService.getKey` calls `keyRepo.findById` which is a synchronous SQLite query
regardless. When the key does not exist, `findById` returns `null` and the short-circuit
`!key` avoids the string comparison. When the key exists but is owned by another user,
the extra string comparison is negligible. Both paths return the same response body.

**Verdict:** LOW RISK. The timing difference is a single string comparison (~nanoseconds),
which is not exploitable over a network. No code change needed.

### TEST-2: Auth middleware timing consistency

**Analysis of `src/middleware/authMiddleware.ts`:**
```typescript
let apiKey: string;
if (!authHeader || !authHeader.startsWith('Bearer ')) {
  apiKey = 'invalid';
} else {
  apiKey = authHeader.slice(7) || 'invalid';
}
const entity = await keyService.validateKey(apiKey, req.ip);
```

When no auth header is present, `apiKey` is set to `'invalid'` and still passed through
`validateKey`. In `keyService.validateKey`, `generateKeyPrefix('invalid')` yields a
prefix `'alid'` (chars 3-11 of `'invalid'`), which will not match any stored key.
The code then hits the dummy bcrypt compare path (line 96 of keyService.ts), ensuring
constant-time behavior.

**Verdict:** PASS. The RT4-002 dummy hash path ensures consistent timing.

### TEST-3: Content-Type bypass (text/plain body parsing)

**Attack:** Send `Content-Type: text/plain` to bypass JSON validation. If Express
does not parse the body, `req.body` would be `undefined`, potentially skipping validators.

**Analysis of `src/server.ts` line 23:**
```typescript
app.use(express.json({ limit: '100kb' }));
```

Only `express.json()` is registered. No `express.text()` or `express.urlencoded()`.
When a request arrives with `Content-Type: text/plain`, Express will not parse the body,
so `req.body` will be `undefined`.

**Testing the validators:**
- `validateKeyCreate(undefined)` -> checks `if (!body || typeof body !== 'object')` ->
  returns `{ valid: false, errors: ['Request body must be a JSON object'] }`.
- `validateRevoke(undefined)` -> same guard -> returns invalid.
- `validateRotate(undefined)` -> same guard -> returns invalid.

**Verdict:** PASS. Sending `text/plain` causes all validators to reject with 400. The
body is never processed.

**However**, note that `POST /:id/validate` (line 211) does NOT call a formal validator
function. It checks `isNonEmptyString(req.body?.key)` directly (line 215). If `req.body`
is `undefined`, `req.body?.key` is `undefined`, and `isNonEmptyString(undefined)` returns
`false`, so the 400 is correctly returned. PASS.

### TEST-4: Privilege escalation paths

**Attack vectors tested:**

#### 4a. Cross-user key operations via direct ID guessing
All mutating endpoints (`rotate`, `revoke`) and read endpoints (`GET /:id`, `GET /:id/audit`)
perform ownership checks: `req.apiKeyEntity!.userId !== targetKey.userId`. If the check
fails, `notFoundResponse` is returned. No escalation possible.

**Verdict:** PASS

#### 4b. Audit log cross-user data leakage
In `src/routes/audit.ts`, the query endpoint:
1. Passes `actorId: authenticatedUserId` to `auditService.query()` (line 48)
2. Then further filters results by `userKeyIds` (line 54)

This double-filter prevents cross-user log access.

**Verdict:** PASS

#### 4c. userId override in key creation
In `POST /` (keys.ts line 35-36):
```typescript
const userId = req.apiKeyEntity!.userId;
const validation = validateKeyCreate({ ...req.body, userId });
```

The `userId` is taken from the authenticated entity, NOT from `req.body`. Even if an
attacker sends `{ userId: "victim-id" }` in the body, line 35 overwrites it with the
authenticated user's ID before passing to the service.

**Verdict:** PASS

#### 4d. TOCTOU race in rotate/revoke
Both `rotateKey` and `revokeKey` in `keyService.ts` use `withTransaction(db, () => { ... })`
which wraps the read-then-write in a SQLite transaction. This prevents TOCTOU races.

However, the ownership check in the route handler (e.g., keys.ts line 148-151) happens
OUTSIDE the transaction. The flow is:

1. Route: `getKey(id)` -> check ownership -> proceed
2. Service: `withTransaction` -> `findById` -> update

Between step 1 and step 2, the key could theoretically be transferred to another user
(if such an operation existed). Since no "transfer key ownership" operation exists in the
API, this is not currently exploitable.

**Verdict:** LOW RISK (theoretical only; no transfer API exists)

### TEST-5: Audit log manipulation / framing another user

**Attack:** Can an attacker create audit log entries that appear to come from another user?

**Analysis:**

The `actorId` in audit logs is set server-side:
- `getActorId(req)` (keys.ts line 10-12) reads from `req.apiKeyEntity?.userId ?? 'anonymous'`
- This is the authenticated user, not a client-supplied value
- The audit service `log()` method trusts what the route passes

There is no endpoint that allows direct audit log creation or modification.

**One anomaly found:** In `POST /:id/validate` (keys.ts line 252-258), when validation
fails, the audit log entry uses `actorId: 'anonymous'` regardless of who the authenticated
caller is. This is not a security issue (it does not leak information), but it means
failed validation attempts cannot be attributed to the authenticated user who initiated
them. See NEW-3 below.

**Verdict:** PASS. No audit log framing is possible.

---

## SECTION C: NEW FINDINGS

### NEW-1: No maximum field length enforcement (MEDIUM)

**Severity:** MEDIUM
**File:** `src/utils/validator.ts`

The validators check that fields are "non-empty strings" but do not enforce maximum
lengths. An attacker can send:

```json
{
  "keyName": "<100KB string>",
  "scopes": ["<100KB string>", "<100KB string>", ...],
  "reason": "<100KB string>"
}
```

The `express.json({ limit: '100kb' })` body size limit provides a coarse upper bound,
but individual fields could still be very large (up to ~100KB each within the body limit).
These values are stored directly in SQLite and in audit log metadata, potentially causing:
- Storage bloat
- Slow queries on large text fields
- Memory pressure when listing keys

**Recommendation:** Add maximum length checks to the validators:
- `keyName`: max 255 chars
- `reason`: max 1000 chars
- Individual scope strings: max 255 chars
- `scopes` array: max 50 entries

### NEW-2: No max cap on scopes array length (LOW)

**Severity:** LOW
**File:** `src/utils/validator.ts` line 39

The validator checks `scopes.length === 0` but does not cap the maximum number of scopes.
An attacker could send thousands of scope entries (within the 100KB body limit), causing
storage and processing overhead.

**Recommendation:** Cap scopes at a reasonable maximum (e.g., 50).

### NEW-3: Validate endpoint audit log uses hardcoded 'anonymous' actorId (LOW)

**Severity:** LOW
**File:** `src/routes/keys.ts` line 256

When an authenticated user calls `POST /:id/validate` and validation fails, the audit
log records `actorId: 'anonymous'` instead of the actual authenticated user. This reduces
audit trail quality -- if a malicious insider is probing keys, their failed attempts
are not attributed to them.

**Recommendation:** Change line 256 from:
```typescript
actorId: 'anonymous',
```
to:
```typescript
actorId: getActorId(req),
```

### NEW-4: Validate endpoint rate limiter keys on IP only, not user+IP (LOW)

**Severity:** LOW
**File:** `src/routes/keys.ts` lines 233-234

The validate rate limiter uses `validate:${clientIp}` as the key. In a shared-IP
environment (corporate NAT, VPN), all users behind the same IP share the same rate limit
bucket. An attacker behind the same NAT could exhaust the validation rate limit for all
other users at that IP.

Conversely, if per-user keying were used, an attacker with multiple API keys could
bypass the rate limit by rotating which key they authenticate with.

**Recommendation:** Use `validate:${clientIp}:${req.apiKeyEntity?.userId}` as the rate
limit key for a balanced approach. This is a design tradeoff -- current approach is
acceptable but worth noting.

### NEW-5: Audit log query actorId filter can be bypassed by omission (INFO)

**Severity:** INFORMATIONAL
**File:** `src/routes/audit.ts` line 48

The audit query passes `actorId: authenticatedUserId` which filters audit logs by the
authenticated user's ID. However, the secondary filter on line 54 (filtering by
`userKeyIds`) is the actual security boundary. If the `actorId` filter were removed, the
`userKeyIds` filter would still prevent cross-user data leakage.

The defense-in-depth is good here. No action needed, just noting the architecture.

### NEW-6: Status query parameter on GET /keys not validated against enum (LOW)

**Severity:** LOW
**File:** `src/routes/keys.ts` line 98

```typescript
status: status as string | undefined,
```

The `status` query parameter is passed through to `keyService.listKeys` without
validation against the `KeyStatus` enum. An invalid status value (e.g., `?status=foo`)
will simply return no results (no match in the WHERE clause), so this is not exploitable,
but it is inconsistent with the audit endpoint which validates the `action` enum.

**Recommendation:** Validate `status` against `KeyStatus` enum values and return 400
for invalid values.

### NEW-7: Error handler leaks internal details in non-production mode (INFO)

**Severity:** INFORMATIONAL
**File:** `src/middleware/errorHandler.ts` lines 22-58

In non-production mode (`NODE_ENV !== 'production'`), error messages including sanitized
but still informative text are returned to the client. The UUID sanitization is good, but
messages like "Cannot rotate key with status 'revoked'. Key must be ACTIVE." reveal
internal state.

This is acceptable for development but ensure `NODE_ENV=production` in deployment.

**Verdict:** No action needed if production config is correct.

### NEW-8: No request ID for audit correlation (INFO)

**Severity:** INFORMATIONAL

There is no request ID (e.g., `X-Request-Id` header) propagated through the middleware
stack. This makes it harder to correlate a specific HTTP request with its audit log
entries during incident response.

**Recommendation:** Add a request ID middleware that generates a UUID per request and
includes it in audit log entries and response headers.

---

## SUMMARY

| ID    | Severity      | Status          | Description                                        |
|-------|---------------|------------------|----------------------------------------------------|
| FIX-1 | --           | VERIFIED FIXED   | Key existence oracle                               |
| FIX-2 | --           | VERIFIED FIXED   | x-forwarded-for rate-limit bypass                  |
| FIX-3 | --           | VERIFIED FIXED   | Field validation wired                             |
| FIX-4 | --           | VERIFIED FIXED   | Audit query params validated                       |
| NEW-1 | MEDIUM       | OPEN             | No max field length enforcement in validators      |
| NEW-2 | LOW          | OPEN             | No max cap on scopes array length                  |
| NEW-3 | LOW          | OPEN             | Validate audit uses hardcoded 'anonymous' actorId  |
| NEW-4 | LOW          | OPEN             | Validate rate limiter keyed on IP only             |
| NEW-5 | INFO         | ACCEPTED         | Audit query double-filter (defense-in-depth OK)    |
| NEW-6 | LOW          | OPEN             | Status query param not validated against enum       |
| NEW-7 | INFO         | ACCEPTED         | Error handler leaks details in non-production      |
| NEW-8 | INFO         | ACCEPTED         | No request ID for audit correlation                |

**Overall assessment:** All four previous findings are confirmed fixed. No critical or high
severity issues found. One medium issue (field length limits) and several low/info items
identified. The codebase security posture has meaningfully improved since RT1.
