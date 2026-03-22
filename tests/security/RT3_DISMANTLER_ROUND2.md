# RT3 - The Dismantler: Round 2 Retest

**Date:** 2026-03-22
**Auditor:** RT3 (automated security review)
**Scope:** Verify RT3-R01 through RT3-R07 fixes, hunt for new issues

---

## SECTION A: Verification of Previous Fixes

### RT3-R01: createKey not in transaction — VERIFIED FIXED

`keyService.createKey` (lines 69-81) now wraps both `keyRepo.create()` and
`auditRepo.create()` inside `withTransaction(db, () => { ... })`. If the audit
insert fails, the key insert is rolled back. Fix is correct.

### RT3-R02: revokeKey TOCTOU — VERIFIED FIXED

`keyService.revokeKey` (lines 250-272) now performs findById, status check,
updateStatus, and audit insert all inside a single `withTransaction` block.
Because better-sqlite3 transactions hold an exclusive lock for writes (SQLite
serializes all writers), the TOCTOU window is eliminated. Fix is correct.

### RT3-R03: Grace period broken — VERIFIED FIXED

- `KeyRepository.findByPrefix` (line 77) now queries `status IN (?, ?)` with
  ACTIVE and ROTATING. Old keys in ROTATING status are returned as candidates.
- `keyService.validateKey` (line 121) accepts both `ACTIVE` and `ROTATING`
  statuses. A key in grace period (status=ROTATING) will validate successfully
  until it is explicitly revoked or expired.
- `keyService.rotateKey` (lines 183-184) sets the old key to ROTATING and only
  revokes it immediately if `gracePeriodMs` is falsy (line 218).

Fix is correct.

### RT3-R04: expireKeys race with rotateKey — ACKNOWLEDGED (unchanged)

`expireKeys()` still operates non-transactionally: it calls `findExpired()` then
`expireKeys()` as two separate statements (lines 295-296). Between these calls,
a key could be rotated, meaning the audit log records expiry for a key that was
actually rotated. This is low severity for SQLite (single-writer), but the
pattern is fragile. Status: **still open, low severity**.

### RT3-R05: Validate rate limiter timer leak — VERIFIED FIXED

`rateLimiter.ts` line 70: `cleanupTimer.unref()` prevents the interval from
keeping the process alive. The `destroy()` method (line 72-75) clears both the
interval and the map. Fix is correct.

### RT3-R07: FK audit logging failure — VERIFIED FIXED

Migration 002 (`002_nullable_audit_key_id.ts`) recreates the `audit_logs` table
with `key_id TEXT REFERENCES api_keys(id)` (nullable, no NOT NULL constraint).
`keyService.validateKey` line 99 now passes `keyId: null` when no candidate
matches a prefix. The AuditLogCreate interface (AuditLog.ts line 23) types
`keyId` as `string | null`. Fix is correct.

---

## SECTION B: New Findings

### RT3-R2-01: rotateKey audit log outside transaction [MEDIUM]

**File:** `src/services/keyService.ts`, lines 226-235
**Issue:** The `rotateKey` function performs all database mutations inside
`withTransaction` (lines 171-224), but the audit log insert for `KEY_ROTATED`
is performed *after* the transaction commits (lines 226-235). If the audit
insert fails (e.g., DB full, constraint violation), the rotation succeeds but
is unaudited. This breaks the audit trail guarantee that was the whole point of
RT3-R01.

**Impact:** Silent audit gap for key rotation events.

**Recommendation:** Move the `auditRepo.create` call for KEY_ROTATED inside the
`withTransaction` block, consistent with how `createKey` and `revokeKey` now
handle it.

### RT3-R2-02: Grace period keys never expire — no scheduled revocation [MEDIUM]

**File:** `src/services/keyService.ts`, lines 203-219
**Issue:** When `rotateKey` is called with a `gracePeriodMs`, the old key is set
to ROTATING status and `oldKeyValidUntil` is stored in `rotation_history`. But
nothing ever reads `oldKeyValidUntil` to revoke the key after the grace period
expires. There is no scheduled task, no cron job, and `expireKeys()` only looks
at `expires_at` on `ACTIVE` keys — it ignores ROTATING keys entirely.

The old key remains in ROTATING status indefinitely, accepting requests forever.

**Impact:** Grace period is effectively infinite. Old keys are never revoked
after rotation unless done manually.

**Recommendation:** Either:
1. Add a `reapRotatingKeys()` function that queries `rotation_history` for
   entries where `old_key_valid_until < now()` and the old key status is still
   ROTATING, then revokes them. Call it alongside `expireKeys()`.
2. Or set `expires_at` on the old key to the grace period deadline inside the
   `rotateKey` transaction.

### RT3-R2-03: Validate endpoint rate limiter never destroyed [LOW]

**File:** `src/routes/keys.ts`, lines 28-29
**Issue:** The `createKeysRouter` function creates a dedicated
`validateRateLimiter` instance (line 28) with its own cleanup interval timer.
Unlike the global rate limiter in `server.ts` (which is destroyed on SIGTERM/
SIGINT via `rateLimiter.destroy()`), this per-route limiter has no shutdown
hook. Its cleanup interval timer runs forever.

The timer does have `.unref()` internally so it won't block process exit, but
if the router is recreated (e.g., in tests), each instance leaks a timer and a
Map until GC collects the closure — which may never happen if anything holds a
reference to the router.

**Impact:** Minor timer/memory leak in test suites or hot-reload scenarios.

**Recommendation:** Either return the limiter's `destroy` handle from the
router factory, or use the global rate limiter with a prefixed key instead of
creating a second instance.

### RT3-R2-04: expireKeys() audit log records stale entity data [LOW]

**File:** `src/services/keyService.ts`, lines 295-307
**Issue:** `expireKeys()` calls `findExpired()` to get entities, then calls
`expireKeys()` (the SQL UPDATE) to mark them expired, then iterates the
*original* entity list to write audit logs. The audit metadata records
`entity.expiresAt` from the snapshot taken *before* the UPDATE. While this
value doesn't change, the `entity.status` in the snapshot is `active`, not
`expired`. If audit consumers trust entity status from the metadata, they get
stale data.

More critically, `findExpired()` and `expireKeys()` are not in a transaction.
Between the two calls, a concurrent connection could insert a new expired key
that gets updated but not audited, or a key in the result set could be rotated
and then incorrectly expired.

**Impact:** Low for SQLite single-writer mode. Would be a real race condition
with PostgreSQL or any multi-writer database.

**Recommendation:** Wrap both operations in a single transaction.

### RT3-R2-05: Dummy bcrypt compare does not prevent prefix enumeration [INFO]

**File:** `src/services/keyService.ts`, lines 93-96
**Issue:** When `candidates.length === 0`, a dummy bcrypt compare runs to
equalize timing. However, when `candidates.length > 0` but none match (hash
mismatch), the function performs N real bcrypt compares (one per candidate).
If a prefix has, say, 3 candidates, the response takes ~3x longer than a prefix
with 0 candidates (1 dummy compare). An attacker can still distinguish
"prefix exists with multiple keys" from "prefix does not exist" via timing.

This is an improvement over the pre-fix state but not a complete mitigation.

**Impact:** Reduced but not eliminated timing oracle.

**Recommendation:** Always perform at least one bcrypt compare, and ideally
pad to a fixed number of compares regardless of candidate count (e.g., always
do max(1, N) compares, or always do exactly 1 real + 1 dummy if N=1, etc.).

### RT3-R2-06: Route-level TOCTOU in rotate and revoke endpoints [LOW]

**File:** `src/routes/keys.ts`, lines 148-160 (rotate), lines 192-200 (revoke)
**Issue:** Both the rotate and revoke route handlers call `keyService.getKey()`
to check ownership, then call `keyService.rotateKey()` / `keyService.revokeKey()`
as a separate operation. Between the two calls, the key could be revoked or
rotated by another request.

The service-layer transactions (RT3-R02 fix) catch the invalid status and throw
an error, so this is not exploitable for data corruption. But it means the user
gets a 500 error with a stack trace instead of a clean 409 Conflict response.

**Impact:** Poor error UX, not a security issue.

**Recommendation:** Catch the specific "Cannot rotate key with status" and
"Key is already revoked" errors in the route handlers and return 409.

### RT3-R2-07: Migration 002 drops FK index names silently [INFO]

**File:** `src/database/migrations/002_nullable_audit_key_id.ts`
**Issue:** The migration recreates indexes with different names than the
original migration. Original uses `idx_audit_actor_id` and `idx_audit_created_at`;
migration 002 uses `idx_audit_actor` and `idx_audit_created`. This is cosmetic
but could confuse tooling that checks for specific index names. The `down`
migration also uses the new names, so a rollback-then-reapply cycle is
consistent, but the names diverge from migration 001.

**Impact:** Cosmetic only.

---

## SECTION C: Summary

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| RT3-R01 | createKey transaction | -- | VERIFIED FIXED |
| RT3-R02 | revokeKey TOCTOU | -- | VERIFIED FIXED |
| RT3-R03 | Grace period validation | -- | VERIFIED FIXED |
| RT3-R04 | expireKeys race | Low | Still open |
| RT3-R05 | Timer leak (.unref) | -- | VERIFIED FIXED |
| RT3-R07 | Nullable key_id FK | -- | VERIFIED FIXED |
| RT3-R2-01 | rotateKey audit outside txn | Medium | NEW |
| RT3-R2-02 | Grace period keys never revoked | Medium | NEW |
| RT3-R2-03 | Validate rate limiter not destroyed | Low | NEW |
| RT3-R2-04 | expireKeys non-transactional audit | Low | NEW |
| RT3-R2-05 | Timing oracle partially mitigated | Info | NEW |
| RT3-R2-06 | Route-level TOCTOU error handling | Low | NEW |
| RT3-R2-07 | Migration index name drift | Info | NEW |

**Memory leak from dummy bcrypt (question 6):** No. `bcrypt.compare` returns a
Promise that resolves to a boolean. The DUMMY_HASH constant is a module-level
string — it does not allocate per-call. There is no accumulating memory from
repeated dummy comparisons.

---

**Round 2 verdict:** All 5 verified fixes are correctly implemented. Two new
MEDIUM findings (RT3-R2-01, RT3-R2-02) require attention — the grace period
mechanism is wired up for validation but has no reaper, making it functionally
incomplete. The rotateKey audit gap undermines the transaction discipline
established by the RT3-R01 fix.
