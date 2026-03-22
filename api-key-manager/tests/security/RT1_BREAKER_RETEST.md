# RT1 Breaker Retest Report

**Date:** 2026-03-22
**Tester:** RT1 - The Breaker
**Scope:** Full source review of all service, route, middleware, repository, and CLI files
**Status:** RETEST after 16 prior vulnerability patches

---

## Summary

Found **7 new vulnerabilities** (1 High, 4 Medium, 2 Low).

---

## Findings

### V-RT1-001: Validators defined but never wired into route handlers (High)

- **Severity:** High
- **Location:** `src/routes/keys.ts` (all handlers), `src/routes/audit.ts`, `src/utils/validator.ts`
- **Description:** The file `src/utils/validator.ts` defines thorough validation functions (`validateKeyCreate`, `validateRevoke`, `validateRotate`, `validateQueryParams`) that check types, enforce positive numbers, validate scopes are string arrays, validate audit action enums, etc. However, **none of these validators are imported or called anywhere in the route handlers**. The routes in `keys.ts` perform only minimal inline checks (e.g., `!keyName || !scopes`, `!Array.isArray(scopes)`), and the audit route performs zero input validation on query parameters.
- **Impact:** This completely bypasses the intended validation layer. Attackers can:
  - Pass non-string values as `keyName` (numbers, objects, booleans) -- the `!keyName` check passes for any truthy value.
  - Pass `expiresInHours` as a negative number, zero, `Infinity`, `NaN`, a string, or an object. Negative values create keys that expire in the past. `Infinity` causes `Infinity * 60 * 60 * 1000 = Infinity`, and `new Date(Date.now() + Infinity).toISOString()` produces `"Invalid Date"` which is stored in SQLite as a string that can never be compared meaningfully.
  - Pass `rateLimit.windowMs` or `rateLimit.maxRequests` as zero, negative, or non-numeric values. A `maxRequests` of 0 with the rate limiter's `count < maxRequests` check means the key can never pass rate limiting. A negative `windowMs` means `windowStart` is in the future, so no timestamps match and the key always passes rate limiting.
  - Pass `gracePeriodMs` as a negative number to the rotate endpoint, setting `oldKeyValidUntil` to a time in the past.
  - Pass arbitrary strings as `action`, `limit`, or `offset` query params to audit endpoint with no validation.
- **How to reproduce:**
  ```bash
  # Create key with negative expiresInHours
  curl -X POST /api/keys -H "Authorization: Bearer <key>" \
    -H "Content-Type: application/json" \
    -d '{"keyName": 123, "scopes": ["read"], "expiresInHours": -1}'

  # Create key with Infinity expiresInHours
  curl -X POST /api/keys -H "Authorization: Bearer <key>" \
    -H "Content-Type: application/json" \
    -d '{"keyName": "test", "scopes": ["read"], "expiresInHours": 1e308}'

  # Rotate with negative grace period
  curl -X PUT /api/keys/<id>/rotate -H "Authorization: Bearer <key>" \
    -H "Content-Type: application/json" \
    -d '{"reason": "test", "gracePeriodMs": -86400000}'

  # Create key with zero maxRequests (permanently rate-limited)
  curl -X POST /api/keys -H "Authorization: Bearer <key>" \
    -H "Content-Type: application/json" \
    -d '{"keyName": "test", "scopes": ["read"], "rateLimit": {"windowMs": 60000, "maxRequests": 0}}'
  ```
- **Recommended fix:** Import and call the validator functions at the top of each route handler before processing:
  ```typescript
  // In POST / handler of keys.ts:
  const validation = validateKeyCreate(req.body);
  if (!validation.valid) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: validation.errors.join('; ') } });
  }
  ```
  Do the same for `validateRevoke`, `validateRotate`, and `validateQueryParams` in their respective handlers.

---

### V-RT1-002: Non-string `keyName` stored in database without type coercion (Medium)

- **Severity:** Medium
- **Location:** `src/routes/keys.ts:34-46`
- **Description:** The inline validation `if (!keyName || !scopes)` uses JavaScript truthiness. Passing `keyName` as a number (e.g., `123`), boolean (`true`), or object (`{}`) passes this check. The value is then stored directly in SQLite, which silently stores whatever type it receives. This is a type confusion bug.
- **Impact:** Database contains non-string key names. Downstream code that calls `.trim()`, `.length`, `.includes()` etc. on `keyName` will throw at runtime. The audit log metadata will also contain the wrong type.
- **How to reproduce:**
  ```bash
  curl -X POST /api/keys -H "Authorization: Bearer <key>" \
    -H "Content-Type: application/json" \
    -d '{"keyName": true, "scopes": ["read"]}'
  ```
- **Recommended fix:** Wire up `validateKeyCreate` which already checks `isNonEmptyString(b.keyName)`.

---

### V-RT1-003: Scopes array elements not validated as strings in route handler (Medium)

- **Severity:** Medium
- **Location:** `src/routes/keys.ts:48-57`
- **Description:** The route checks `Array.isArray(scopes) && scopes.length > 0` but does not verify that each element is a string. An attacker can pass `scopes: [null, 123, {}, true, []]`. These are JSON-stringified via `JSON.stringify(data.scopes)` in the repository and stored. When read back via `JSON.parse(row.scopes)`, the non-string values survive round-tripping. Any downstream scope-matching logic that does string comparison will malfunction.
- **Impact:** Type confusion in scope checking. If scope authorization is ever enforced (e.g., checking `entity.scopes.includes("admin")`), a scope of `true` or `null` could bypass or break the check.
- **How to reproduce:**
  ```bash
  curl -X POST /api/keys -H "Authorization: Bearer <key>" \
    -H "Content-Type: application/json" \
    -d '{"keyName": "test", "scopes": [null, 123, true, {"x":1}]}'
  ```
- **Recommended fix:** Wire up the existing validator, or add inline: `if (!scopes.every(s => typeof s === 'string' && s.trim().length > 0))`.

---

### V-RT1-004: `parseInt` on query params yields NaN without validation (Medium)

- **Severity:** Medium
- **Location:** `src/routes/keys.ts:82-87`, `src/routes/keys.ts:314`, `src/routes/audit.ts:36-37`
- **Description:** `parseInt(limit as string, 10)` returns `NaN` for non-numeric strings like `"abc"`. This `NaN` is passed through to the repository's `LIMIT @limit OFFSET @offset` clause. In `better-sqlite3`, binding `NaN` to a parameter may produce undefined behavior or errors depending on the SQLite driver version. Even if it doesn't crash, `NaN` as a limit/offset is logically meaningless.

  Additionally, negative values for `limit` and `offset` are accepted. A negative `LIMIT` in SQLite returns all rows (equivalent to no limit), which could be used to dump the entire table in a single request.
- **Impact:** Potential data dump via `?limit=-1`. Possible SQLite driver errors with NaN values.
- **How to reproduce:**
  ```bash
  # Dump all keys
  curl "/api/keys?limit=-1" -H "Authorization: Bearer <key>"

  # NaN limit
  curl "/api/keys?limit=abc" -H "Authorization: Bearer <key>"
  ```
- **Recommended fix:** Validate and clamp `limit` and `offset` before passing to the repository:
  ```typescript
  const parsedLimit = parseInt(limit as string, 10);
  const safeLimit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 50 : Math.min(parsedLimit, 1000);
  ```

---

### V-RT1-005: Audit log insert with `keyId: 'unknown'` violates foreign key constraint (Medium)

- **Severity:** Medium
- **Location:** `src/services/keyService.ts:86-93`
- **Description:** When key validation fails because no candidate is found by prefix, the code calls `auditRepo.create({ keyId: 'unknown', ... })`. The `audit_logs` table has `FOREIGN KEY (key_id) REFERENCES api_keys(id)`, and foreign keys are enabled (`PRAGMA foreign_keys = ON` in `connection.ts:31`). Inserting `key_id = 'unknown'` will throw a SQLite foreign key constraint violation, because no row with `id = 'unknown'` exists in `api_keys`.
- **Impact:** Every failed key validation attempt where the prefix doesn't match any key will throw an unhandled database error. This error bubbles up through `validateKey` in the auth middleware, causing the auth middleware's catch block to return 401. While this doesn't crash the server (the error is caught), it means:
  1. The audit log entry for failed validation is silently lost.
  2. An extra unnecessary database error is generated on every failed auth attempt.
  3. The error handler logs a stack trace for what is normal operational behavior.
- **How to reproduce:**
  ```bash
  # Send a request with a completely invalid API key
  curl -H "Authorization: Bearer hg_totallyinvalidkey" /api/keys
  # Check server logs for foreign key constraint error
  ```
- **Recommended fix:** Either (a) remove the foreign key constraint on `audit_logs.key_id`, (b) don't insert an audit record when keyId is unknown, or (c) use a sentinel row in `api_keys` with `id = 'unknown'`.

---

### V-RT1-006: `reason` field in revoke/rotate accepts any truthy non-string value (Low)

- **Severity:** Low
- **Location:** `src/routes/keys.ts:134`, `src/routes/keys.ts:187`
- **Description:** The `if (!reason)` check only rejects falsy values. Passing `reason: 123`, `reason: true`, or `reason: ["array"]` all pass the check. These non-string values are then stored in the database's `revoked_reason` TEXT column and in audit log metadata. SQLite will coerce numbers and booleans to their string representations, but arrays/objects will be stored as `[object Object]` or similar.
- **How to reproduce:**
  ```bash
  curl -X PUT /api/keys/<id>/revoke -H "Authorization: Bearer <key>" \
    -H "Content-Type: application/json" \
    -d '{"reason": ["not", "a", "string"]}'
  ```
- **Recommended fix:** Use the existing `validateRevoke`/`validateRotate` validators which check `isNonEmptyString(b.reason)`.

---

### V-RT1-007: Validate endpoint key body param accepts non-string types (Low)

- **Severity:** Low
- **Location:** `src/routes/keys.ts:223-234`
- **Description:** The `POST /:id/validate` handler checks `if (!key)` but does not verify `key` is a string. Passing `key: 123` or `key: true` will reach `keyService.validateKey(key, req.ip)`. Inside `validateKey`, `generateKeyPrefix(plaintextKey)` calls `apiKey.slice(...)` on the non-string value. Since numbers and booleans don't have `.slice()` in the same way (they do via prototype but return unexpected substrings), this produces incorrect prefix lookups rather than a clear error.
- **How to reproduce:**
  ```bash
  curl -X POST /api/keys/<id>/validate -H "Authorization: Bearer <key>" \
    -H "Content-Type: application/json" \
    -d '{"key": 12345678901234567890}'
  ```
- **Recommended fix:** Add `typeof key !== 'string'` check before processing.

---

## Vectors that were tested and found to be adequately defended

1. **Empty string as API key / `hg_` with no body:** Auth middleware's `!apiKey` check (line 25) catches empty string after `slice(7)`. The `hg_` prefix with no body yields a 3-char string that produces an 8-char prefix via `.slice(3, 11)` which returns a short/empty string that simply won't match any stored prefix. Returns 401. Acceptable.

2. **SQL injection in query params:** All database queries use parameterized statements (`?` and `@named` placeholders) via `better-sqlite3`. No string concatenation of user input into SQL. Safe.

3. **Null bytes in strings:** These are passed through to SQLite via parameterized queries. SQLite handles embedded null bytes in TEXT columns by truncating at the null byte, which is a known SQLite behavior but not exploitable for injection in this context. Low risk, not actionable.

4. **Extremely long strings (>1MB):** The Express JSON body parser is configured with `limit: '100kb'` (server.ts:23), which rejects request bodies larger than 100KB with a 413 status. This adequately defends against memory exhaustion via oversized payloads.

5. **Unicode and special characters:** Parameterized queries handle these safely. No XSS risk since this is a JSON API with `Content-Security-Policy: default-src 'none'`.

6. **Duplicate scopes:** Stored as-is. Not a security issue -- just a data quality concern. The application doesn't perform scope-based authorization enforcement in the current codebase.

7. **Extra unexpected fields in request bodies:** Ignored by destructuring. No mass-assignment vulnerability since the repository explicitly maps only known fields.

8. **Concurrent requests / TOCTOU in rotation:** The `rotateKey` function uses `withTransaction` and re-checks key status inside the transaction (keyService.ts:160-167). This prevents the race condition. Well defended.

9. **Cross-origin requests:** Blocked by origin header check in server.ts:37-48.

10. **Error message information leakage:** The error handler sanitizes UUIDs and uses generic messages in production mode.

---

## Recommendations Summary

| Priority | Action |
|----------|--------|
| **P0** | Wire up existing validators from `src/utils/validator.ts` into all route handlers |
| **P1** | Fix the `keyId: 'unknown'` foreign key violation in failed validation audit logging |
| **P1** | Validate and clamp `limit`/`offset` query parameters to prevent data dumping |
| **P2** | Add type checks for `reason` and `key` body params in revoke, rotate, and validate endpoints |

---

*End of RT1 Breaker Retest Report*
