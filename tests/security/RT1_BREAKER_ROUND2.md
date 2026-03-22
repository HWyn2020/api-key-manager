# RT1 — The Breaker: Round 2 Retest Report

**Date:** 2026-03-22
**Tester:** RT1 (automated security retest)
**Scope:** Verify Round 1 fixes (V-RT1-001 through V-RT1-007) and probe new attack vectors

---

## Part 1: Verification of Previous Findings

### V-RT1-001: Validators not wired into routes — FIXED

Validators are now imported and called at the top of each route handler:
- `validateKeyCreate` in `POST /api/keys` (keys.ts:36)
- `validateRevoke` in `PUT /api/keys/:id/revoke` (keys.ts:179)
- `validateRotate` in `PUT /api/keys/:id/rotate` (keys.ts:134)
- `isNonEmptyString` in `POST /api/keys/:id/validate` (keys.ts:215)
- `validateQueryParams` in `GET /api/audit` (audit.ts:15)

All validators return early with 400 before any service logic executes. **Confirmed fixed.**

### V-RT1-002: Non-string keyName accepted — FIXED

`validateKeyCreate` calls `isNonEmptyString(b.keyName)` (validator.ts:35). The guard checks `typeof value === 'string' && value.trim().length > 0`, which rejects numbers, booleans, objects, null, undefined, and empty/whitespace-only strings. **Confirmed fixed.**

### V-RT1-003: Non-string scope elements accepted — FIXED

`validateKeyCreate` checks `b.scopes.every((s: unknown) => isNonEmptyString(s))` (validator.ts:41). Non-string elements (numbers, objects, null) are rejected. **Confirmed fixed.**

### V-RT1-004: Negative limit / NaN accepted — FIXED

- `GET /api/keys` validates `limit` is a positive integer and `offset` is a non-negative integer (keys.ts:74-93), then clamps limit to max 100 (keys.ts:95).
- `GET /api/keys/:id/audit` validates limit (keys.ts:284-293).
- `GET /api/audit` validates via `validateQueryParams` which checks both limit and offset (validator.ts:153-165).

**Confirmed fixed.**

### V-RT1-005: FK constraint crash on keyId='unknown' — FIXED

- Migration 002 makes `audit_logs.key_id` nullable (002_nullable_audit_key_id.ts).
- `AuditLogCreate.keyId` is typed `string | null` (AuditLog.ts:23).
- `keyService.validateKey` passes `keyId: null` when no candidate matches (keyService.ts:99).
- `AuditRepository.create` correctly passes `keyId: data.keyId` which can be null (AuditRepository.ts:39).

**Confirmed fixed.**

### V-RT1-006: Non-string reason accepted in revoke/rotate — FIXED

`validateRevoke` and `validateRotate` both check `isNonEmptyString(b.reason)` (validator.ts:77, 95). Rejects non-strings and empty strings. **Confirmed fixed.**

### V-RT1-007: Non-string key in validate endpoint — FIXED

`POST /api/keys/:id/validate` checks `isNonEmptyString(key)` before proceeding (keys.ts:215). **Confirmed fixed.**

---

## Part 2: New Attack Vector Analysis

### 2.1 Prototype Pollution via `__proto__`, `constructor`, `toString`

**Vector:** Send `{"__proto__": {"admin": true}, "keyName": "test", ...}` or `{"constructor": {"prototype": {"admin": true}}, ...}`.

**Analysis:** The validators cast `body` to `Record<string, unknown>` via `const b = body as Record<string, unknown>` and then access only known property names (`b.userId`, `b.keyName`, `b.scopes`, etc.). The dangerous properties (`__proto__`, `constructor`) are never read, never iterated, and never spread onto a target object.

Express's `express.json()` uses `JSON.parse()` under the hood. `JSON.parse('{"__proto__": {"admin": true}}')` produces a plain object with a literal `"__proto__"` own property -- it does NOT modify `Object.prototype`. This is safe.

The only spread usage is in `AuditRepository.list` and `KeyRepository.list` where `{ ...params, limit, offset }` is spread. But `params` is built field-by-field from validated strings (never from raw user input object), so no pollution path exists.

**Result: NOT VULNERABLE.** No prototype pollution vector found.

### 2.2 Type Coercion Residuals

**Vector:** Send `{"keyName": ["array"], "scopes": [123], "expiresInHours": "5"}`.

**Analysis:**
- `isNonEmptyString` uses strict `typeof value === 'string'` -- arrays, numbers, and booleans all fail.
- `isPositiveNumber` uses strict `typeof value === 'number'` -- string "5" fails.
- Scopes are validated element-by-element with `isNonEmptyString`.

One edge case worth noting: `expiresInHours: Infinity` passes `typeof value === 'number'` but is caught by `isFinite(value)` in `isPositiveNumber`. `NaN` also fails `isFinite`. **Good.**

**Result: NOT VULNERABLE.** Type coercion is properly guarded.

### 2.3 Validator Edge Cases

**2.3.1 Empty object body `{}`**

- `validateKeyCreate({})` -- body passes `typeof body !== 'object'` check. Then `isNonEmptyString(undefined)` fails for userId, keyName; `Array.isArray(undefined)` fails for scopes. Returns errors. **Safe.**

**2.3.2 Body is an array `[]`**

- `validateKeyCreate([])` -- `Array.isArray` returns true but `typeof [] === 'object'` so it passes the object check. However, `b.userId` etc. are all undefined on an array, so all checks fail. Returns errors. **Safe**, but see finding V-RT1-R2-001 below.

**2.3.3 Extremely long strings**

- `keyName` or `reason` with megabyte-length strings would pass `isNonEmptyString`. The 100KB body limit on `express.json({ limit: '100kb' })` (server.ts:23) caps total body size. But within that limit, a single 99KB keyName would be stored in the database. This is a minor concern -- see V-RT1-R2-002.

**2.3.4 Unicode edge cases**

- `keyName: "\u0000"` (null byte) -- passes `isNonEmptyString` since `typeof` is string and trim().length > 0. Null bytes in SQLite TEXT columns are supported but may cause issues in downstream systems. See V-RT1-R2-003.

### 2.4 Deeply Nested Objects in Metadata

**Vector:** Audit log metadata accepts `Record<string, unknown>`. The keyService passes controlled metadata objects (e.g., `{ keyName, scopes }`, `{ reason }`, `{ success: false, ip: clientIp }`). The metadata is JSON.stringify'd before storage (AuditRepository.ts:43) and JSON.parse'd on read (AuditRepository.ts:25).

User-controlled data that reaches metadata:
- `keyName` -- validated as a non-empty string, bounded by 100KB body limit.
- `scopes` -- validated as array of non-empty strings.
- `reason` -- validated as non-empty string.
- `clientIp` -- from `req.ip`, controlled by Express, not user input body.

No route allows arbitrary user-supplied objects to be passed directly as metadata. The metadata is always constructed by the service layer from validated fields. **NOT VULNERABLE.**

### 2.5 Additional Vectors Examined

**2.5.1 Parameter pollution in query strings**

Express parses duplicate query params as arrays. For example, `?limit=5&limit=10` yields `req.query.limit` as `['5', '10']`. The `Number(['5', '10'])` returns `NaN`, which fails `Number.isInteger`. In audit route, `validateQueryParams` is called with the raw query object, and `Number(query.limit)` on an array returns `NaN`, which fails validation. **Safe.**

**2.5.2 Path traversal in `:id` parameter**

`req.params.id` is passed to `keyService.getKey()` which calls `keyRepo.findById()` using a parameterized SQLite query (`WHERE id = ?`). No path traversal or SQL injection possible. **Safe.**

**2.5.3 Timing oracle on key ownership check**

`GET /api/keys/:id` returns 404 both when the key does not exist and when it belongs to another user (keys.ts:117-119). This is correct and does not leak ownership information. **Safe.**

**2.5.4 auditService.log keyId type mismatch**

`auditService.log()` (auditService.ts:6-8) declares `keyId: string`, not `keyId: string | null`. The route at keys.ts:253 calls `auditService.log({ keyId: req.params.id, ... })` which is always a string from the URL parameter. The underlying `auditRepo.create` accepts `keyId: string | null`. This is not a runtime issue since `auditService.log` always receives a string keyId, but it means failed validations for unknown prefixes go through `keyService.validateKey` -> `auditRepo.create` directly (with null), bypassing `auditService.log`. **No vulnerability**, but a type inconsistency.

---

## Part 3: New Findings

### V-RT1-R2-001 — Array Body Passes Object Check (INFORMATIONAL)

**Severity:** Informational
**Location:** `src/utils/validator.ts:25`
**Description:** `validateKeyCreate` checks `typeof body !== 'object'` but arrays also pass this check. Sending `POST /api/keys` with body `[1, 2, 3]` passes the initial guard. All subsequent property checks fail, so the request is correctly rejected with validation errors. No exploit is possible, but the check could be tightened for defense in depth.
**Recommendation:** Add `|| Array.isArray(body)` to the null check: `if (!body || typeof body !== 'object' || Array.isArray(body))`.

### V-RT1-R2-002 — No Maximum Length on String Fields (LOW)

**Severity:** Low
**Location:** `src/utils/validator.ts` (all string validators)
**Description:** `isNonEmptyString` has no upper bound on string length. While the Express body parser limits total payload to 100KB, a single field like `keyName` or `reason` could be up to ~100KB. This data is stored in SQLite and returned in API responses. Excessively long values could degrade performance of list queries and increase storage waste.
**Recommendation:** Add maximum length checks to `validateKeyCreate` (e.g., keyName <= 255 chars, each scope <= 128 chars, reason <= 1024 chars).

### V-RT1-R2-003 — Null Bytes in String Fields (LOW)

**Severity:** Low
**Location:** `src/utils/validator.ts:13`
**Description:** `isNonEmptyString` does not strip or reject null bytes (`\u0000`). A keyName like `"admin\u0000.hidden"` would pass validation. While SQLite handles null bytes in TEXT, downstream log aggregators, monitoring tools, or export pipelines may truncate at null bytes, potentially causing log injection or mismatched field values.
**Recommendation:** Add a null byte check: reject strings containing `\0`.

### V-RT1-R2-004 — Audit Query Limit Not Clamped (LOW)

**Severity:** Low
**Location:** `src/routes/audit.ts:49`
**Description:** The `GET /api/audit` endpoint validates that `limit` is a positive integer but does not clamp it to a maximum value. A request with `?limit=999999` would attempt to fetch up to ~1M rows from SQLite, which could cause memory pressure or slow responses. The `GET /api/keys` endpoint correctly clamps to 100 (keys.ts:95), but the audit route does not.
**Recommendation:** Clamp the audit limit to a reasonable maximum (e.g., 100 or 500), consistent with the keys endpoint.

### V-RT1-R2-005 — Status Query Parameter Not Validated in Key List (LOW)

**Severity:** Low
**Location:** `src/routes/keys.ts:98`
**Description:** `GET /api/keys` passes `req.query.status` directly as a string to `keyService.listKeys` -> `keyRepo.list`, which uses it in a parameterized `WHERE status = @status` clause. This is SQL-injection safe due to parameterization, but it means arbitrary invalid status values (e.g., `?status=hacked`) are accepted without error -- they simply return empty results. This is not a security vulnerability but violates the principle of strict input validation.
**Recommendation:** Validate `status` against the `KeyStatus` enum values before passing to the service.

---

## Summary

| ID | Description | Severity | Status |
|---|---|---|---|
| V-RT1-001 | Validators not wired | - | FIXED |
| V-RT1-002 | Non-string keyName | - | FIXED |
| V-RT1-003 | Non-string scope elements | - | FIXED |
| V-RT1-004 | Negative limit/NaN | - | FIXED |
| V-RT1-005 | FK constraint on unknown keyId | - | FIXED |
| V-RT1-006 | Non-string reason | - | FIXED |
| V-RT1-007 | Non-string key in validate | - | FIXED |
| V-RT1-R2-001 | Array body passes object check | Informational | NEW |
| V-RT1-R2-002 | No max length on string fields | Low | NEW |
| V-RT1-R2-003 | Null bytes in string fields | Low | NEW |
| V-RT1-R2-004 | Audit query limit not clamped | Low | NEW |
| V-RT1-R2-005 | Status param not validated | Low | NEW |

**Overall assessment:** All 7 original findings are confirmed fixed. No new high or medium severity issues found. The 5 new findings are all low/informational hardening opportunities. The codebase is in good shape from a validation and injection-prevention standpoint.
