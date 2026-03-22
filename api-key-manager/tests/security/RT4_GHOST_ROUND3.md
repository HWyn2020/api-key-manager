# RT4 - The Ghost: Round 3 Retest

**Date:** 2026-03-22
**Tester:** RT4 (Ghost)
**Scope:** Post-patch review of keyService.ts, validator.ts, keys.ts, audit.ts, RotationRepository.ts, AuditRepository.ts

## Previous Findings Status

| Finding | Status |
|---------|--------|
| RT4-001: Grace period decorative | **FIXED** - Grace period now enforced in validateKey (line 133-146) and expireKeys (line 323-338) |
| RT4-002: Timing multi-candidate leak | **FIXED** - Dummy bcrypt compare on zero candidates (line 93-96) |
| RT4-003: Datetime issues | **REVIEWED** - See notes below |
| RT4-004: TOCTOU gap in rotateKey | **FIXED** - Existence + status check moved inside withTransaction (line 188-195) |
| RT4-005: Unbounded grace period | **FIXED** - Capped at 604800000ms (7 days) in validator.ts (line 120-121) |

---

## Round 3 Findings

### FINDING RT4-R3-001: Multi-candidate timing side-channel partially mitigated

**Severity: LOW**

The dummy bcrypt fix (DUMMY_HASH on line 26, used on line 96) addresses the zero-candidate case. However, a timing difference still exists between the 1-candidate and N-candidate cases.

When `candidates.length > 0`, the loop at line 108 iterates over all candidates calling `await compareKey()` sequentially. If a prefix collides with 3 keys, the response takes ~3x longer than a prefix matching 1 key. An attacker who can observe response times can estimate how many keys share a given prefix.

**Exploitability assessment:** Low. The prefix is 8 characters from a base64url alphabet (64^8 = ~281 trillion combinations). Prefix collisions are astronomically unlikely in any realistic deployment. The attacker would also need to already know a valid prefix to begin probing. Not practically exploitable.

**Recommendation:** No action required for current threat model. If this system ever scales to billions of keys, consider constant-time iteration (always compare against a fixed number of candidates, padding with dummy hashes).

---

### FINDING RT4-R3-002: Grace period check creates measurable timing delta for ROTATING vs ACTIVE keys

**Severity: LOW**

In `validateKey`, when a key has status `ROTATING` (line 133), an additional synchronous DB query is issued via `rotationRepo.findByOldKeyId(entity.id)` (line 134). This query does not execute for `ACTIVE` keys. An attacker who can measure response time with sub-millisecond precision could distinguish whether a successfully validated key is in ACTIVE vs ROTATING state.

**Exploitability assessment:** Low. The attacker must already possess a valid API key to reach this code path (bcrypt compare must succeed first). If they have the key, they can already use it. Knowing the rotation state leaks operational information but does not grant additional access.

**Recommendation:** Acceptable risk. If desired, always perform the rotation lookup regardless of status and discard the result for non-ROTATING keys.

---

### FINDING RT4-R3-003: Null byte stripping does not cover userId field

**Severity: LOW**

`stripNullBytes` is applied to `keyName` (validator.ts line 42) and each scope (line 55), but `userId` (line 35-36) is only checked with `isNonEmptyString` -- null bytes in the userId are not stripped. In the route handler (keys.ts line 38), `userId` comes from `req.apiKeyEntity!.userId` which is set by auth middleware, not user input. However, the validator function `validateKeyCreate` accepts `userId` as part of the body object, meaning the code path `{ ...req.body, userId }` on line 39 of keys.ts uses the middleware-provided userId, which is safe.

**Exploitability assessment:** Not exploitable in current flow because userId is sourced from the authenticated entity, not raw user input. The validator's acceptance of the field is a defense-in-depth gap only.

**Recommendation:** Add `stripNullBytes` to userId validation for defense in depth. Not urgent.

---

### FINDING RT4-R3-004: Unicode normalization not addressed but null byte regex is sufficient

**Severity: NONE (Informational)**

The question was raised whether `stripNullBytes` using `/\0/g` can be bypassed via Unicode normalization (e.g., overlong UTF-8 sequences, or Unicode characters that normalize to \x00).

Analysis: JavaScript strings are UTF-16 internally. The regex `/\0/g` matches U+0000 (the only actual null character in Unicode). Overlong UTF-8 sequences (e.g., `0xC0 0x80`) are a concern in C/byte-level parsers, but Node.js/Express parse incoming JSON through `JSON.parse()` which operates on properly decoded UTF-16 strings. There is no way to smuggle a null byte through JSON that `\0` would miss -- JSON itself uses `\u0000` which decodes to the same U+0000 that the regex catches.

**Exploitability assessment:** Not exploitable. The regex is correct for the runtime.

---

### FINDING RT4-R3-005: Rate limiter check-then-increment is non-atomic

**Severity: LOW**

In keys.ts lines 251-262, the validate endpoint calls `validateRateLimiter.check()` and then `validateRateLimiter.increment()` as two separate operations. Under concurrent requests from the same IP, multiple requests could pass the `check()` before any of them call `increment()`, allowing a burst slightly above the 10-request limit.

**Exploitability assessment:** Low. This is an in-memory rate limiter on a single-process Node.js server. Because Node.js is single-threaded for JS execution, true concurrent execution of these two lines is impossible within one process -- the event loop will serialize them. This would only matter in a multi-process cluster deployment, which is not the current architecture.

**Recommendation:** No action needed for single-process deployment. If clustering is added, switch to an atomic check-and-increment pattern or use Redis-based rate limiting.

---

### FINDING RT4-R3-006: expireKeys ROTATING sweep has a hard limit of 1000

**Severity: LOW**

In keyService.ts line 324, `expireKeys` fetches ROTATING keys with `limit: 1000`. If more than 1000 keys are simultaneously in ROTATING state, some will not be swept in a single pass.

**Exploitability assessment:** Extremely unlikely scenario. Would require 1000+ concurrent key rotations all with active grace periods. Even if it occurred, keys would be caught on the next sweep cycle.

**Recommendation:** Acceptable. Document the batch limit. If needed, add pagination to the sweep loop.

---

## Summary

| ID | Severity | Exploitable | Action Required |
|----|----------|-------------|-----------------|
| RT4-R3-001 | LOW | No (astronomical prefix collision probability) | None |
| RT4-R3-002 | LOW | No (requires valid key) | None |
| RT4-R3-003 | LOW | No (userId from auth middleware) | Optional defense-in-depth |
| RT4-R3-004 | NONE | No | None |
| RT4-R3-005 | LOW | No (single-threaded Node.js) | None unless clustering |
| RT4-R3-006 | LOW | No (extremely unlikely scale) | None |

**Overall assessment:** The patches from Round 2 are correctly implemented. The grace period is now enforced both at validation time and via the background sweep. The 7-day cap is enforced at the validator layer before reaching keyService. The TOCTOU fix properly moves the check inside the transaction. The timing oracle fix with DUMMY_HASH is correct.

No HIGH or CRITICAL severity issues found. No action-required findings. The remaining items are informational and low-severity edge cases that do not represent exploitable vulnerabilities in the current deployment model.

**Round 3 verdict: PASS**
