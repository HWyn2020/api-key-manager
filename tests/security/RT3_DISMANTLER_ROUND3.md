# RT3 - The Dismantler: Round 3 Retest

**Date:** 2026-03-22
**Auditor:** RT3 (automated security review)
**Scope:** Verify fixes for RT3-R2-01 (rotateKey audit outside txn) and RT3-R2-02 (grace period keys never revoked); check for new issues introduced by the patches.

---

## SECTION A: Verification of Round 2 Fixes

### RT3-R2-01: rotateKey audit outside transaction — VERIFIED FIXED

**File:** `src/services/keyService.ts`, lines 187-251

The `withTransaction(db, () => { ... })` block now spans from the existence
check (line 189) through key status updates, new key creation, rotation history
insert, conditional immediate revoke, **and** the `auditRepo.create` call for
`KEY_ROTATED` (lines 238-247). The transaction closes at line 251 with the
return statement. The audit insert is fully inside the transaction. If the audit
write fails, the entire rotation rolls back.

Fix is correct.

### RT3-R2-02: Grace period keys never revoked — VERIFIED FIXED

Two enforcement paths now exist:

1. **At validation time** (`validateKey`, lines 132-146): When a ROTATING key
   is presented, the service calls `rotationRepo.findByOldKeyId(entity.id)` to
   retrieve the rotation record. If `oldKeyValidUntil <= now()`, the key is
   immediately revoked via `keyRepo.updateStatus` and an audit entry with
   reason `grace_period_expired` is written. The validation then `continue`s,
   denying access.

2. **At scheduled sweep time** (`expireKeys`, lines 323-338): After expiring
   TTL-based keys, the function queries all ROTATING keys (up to 1000) and
   checks each against its rotation record's `oldKeyValidUntil`. Expired grace
   periods are revoked with an audit trail identical to path 1.

Both paths correctly revoke stale ROTATING keys. The grace period is no longer
infinite.

Fix is correct.

---

## SECTION B: Analysis of Patched Code for New Issues

### B1: Race condition in validateKey grace period check — NOT EXPLOITABLE

**File:** `src/services/keyService.ts`, lines 132-146

The grace period check in `validateKey` is not wrapped in a transaction. Two
concurrent requests presenting the same expired-grace-period key could both
read the ROTATING status, both determine the grace period has passed, and both
call `updateStatus(id, REVOKED)`. However:

- SQLite serializes all write operations, so the two UPDATEs execute
  sequentially.
- The second `updateStatus` call sets the already-REVOKED key to REVOKED
  again — this is idempotent (same status, same reason). It returns
  `changes > 0` because the row exists and the UPDATE executes.
- Two audit entries for the same revocation are written. This is a cosmetic
  duplicate, not a security issue. The key is correctly denied on both
  requests (both hit `continue` after the revoke).

**Verdict:** No exploitable race condition. Duplicate audit entries are a minor
cosmetic issue only.

### B2: expireKeys grace sweep capped at 1000 ROTATING keys — LOW

**File:** `src/services/keyService.ts`, line 324

The sweep queries `keyRepo.list({ status: KeyStatus.ROTATING, limit: 1000 })`.
If more than 1000 keys are in ROTATING status simultaneously, keys beyond the
first 1000 (ordered by `created_at DESC`) are not checked in that sweep cycle.
They will be caught on subsequent sweeps or at validation time (path 1).

**Impact:** Theoretical only. Having 1000+ simultaneously rotating keys would
require extraordinary circumstances. The validation-time check (path 1) acts
as a safety net regardless.

**Severity:** Low / Informational.

### B3: findByOldKeyId query safety — VERIFIED SAFE

**File:** `src/database/repositories/RotationRepository.ts`, lines 63-68

The query uses a parameterized placeholder (`WHERE old_key_id = ?`). The
`oldKeyId` value is passed as a bound parameter via `.get(oldKeyId)`. No
string interpolation or concatenation. SQL injection is not possible.

### B4: Grace period revoke not transactional in validateKey — LOW

**File:** `src/services/keyService.ts`, lines 136-143

When `validateKey` revokes an expired grace period key, the `updateStatus` and
`auditRepo.create` calls are not wrapped in a transaction. If the audit insert
fails after the status update succeeds, the key is revoked but the revocation
is unaudited. This mirrors the pattern flagged in RT3-R2-04 for `expireKeys`.

**Impact:** Low. The key is correctly revoked (security-positive outcome). Only
the audit trail is at risk, and only if the audit insert fails — which would
require a database error.

**Severity:** Low.

### B5: No new TOCTOU in rotateKey — VERIFIED CLEAN

**File:** `src/services/keyService.ts`, lines 187-251

The `rotateKey` function now performs all operations inside a single
`withTransaction` block: existence check, status validation, status update,
new key creation, rotation history insert, conditional revoke, and audit log.
SQLite's exclusive write lock during transactions prevents any interleaving.
No TOCTOU window exists.

---

## SECTION C: Status of Previously Open Issues

| ID | Finding | Severity | Round 2 Status | Round 3 Status |
|----|---------|----------|----------------|----------------|
| RT3-R2-01 | rotateKey audit outside txn | Medium | NEW | **VERIFIED FIXED** |
| RT3-R2-02 | Grace period keys never revoked | Medium | NEW | **VERIFIED FIXED** |
| RT3-R2-03 | Validate rate limiter not destroyed | Low | NEW | Unchanged (not in scope) |
| RT3-R2-04 | expireKeys non-transactional audit | Low | NEW | Unchanged |
| RT3-R2-05 | Timing oracle partially mitigated | Info | NEW | Unchanged |
| RT3-R2-06 | Route-level TOCTOU error handling | Low | NEW | Unchanged |
| RT3-R2-07 | Migration index name drift | Info | NEW | Unchanged |

---

## SECTION D: New Findings Summary

| ID | Finding | Severity |
|----|---------|----------|
| RT3-R3-01 | expireKeys grace sweep capped at 1000 | Low / Info |
| RT3-R3-02 | validateKey grace revoke + audit not in txn | Low |

---

## SECTION E: Verdict

**Zero new exploitable security issues found.**

Both MEDIUM findings from Round 2 (RT3-R2-01 and RT3-R2-02) are correctly
fixed. The rotateKey audit is now inside the transaction. The grace period is
enforced at both validation time and sweep time, with proper revocation and
audit logging.

The two new findings (RT3-R3-01 and RT3-R3-02) are low/informational and
represent defense-in-depth improvements rather than exploitable vulnerabilities.
The 1000-key cap is theoretical, and the non-transactional audit in
`validateKey` mirrors an existing accepted pattern.

The patched codebase is in a sound state for the grace period and rotation
audit trail features.
