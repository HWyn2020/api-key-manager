# API Key Manager - Phase 6: Red Team Fixes

## Task
Patch the 16 vulnerabilities found during Phase 4 security audit. The 3 critical issues need immediate attention:
- VULN-001: No authentication → add API key auth middleware
- VULN-002: No authorization/IDOR → add user-scoped access control
- VULN-003: Encryption key validation → validate 32-byte hex on startup

## Requirements

### Vulnerability Patching Priority
**Critical (Must Fix):**
1. Add API key authentication middleware
2. Add authorization checks (user-scoped access)
3. Validate encryption key length on startup
4. Fix encryption key length validation in key creation
5. Fix decryption that leaks internal key data
6. Fix prefix collision vulnerability
7. Fix rate limiter memory growth
8. Fix validate endpoint key oracle vulnerability

**High (Must Fix):**
9. Fix error messages that leak key IDs
10. Add CORS/security headers
11. Fix TOCTOU race condition
12. Audit failed validations

**Medium (Should Fix):**
13. CLI stdout plaintext logging
14. x-forwarded-for header trust
15. Add body size limit
16. Remove uptime leak from /health

### Workflow
1. Patch all 16 vulnerabilities with security-hardening code
2. Run all 4 Red Teams (RT1-Breaker, RT2-Infiltrator, RT3-Dismantler, RT4-Ghost) on each patch
3. Document every vulnerability found, every patch, and every retest result
4. Update `docs/VULNERABILITIES.md` with final patch status and retest confirmations
5. Run full test suite after all patches (127 tests should still pass)

### Documentation Updates
- Update `docs/VULNERABILITIES.md` with:
  - All 16 vulnerabilities marked as FIXED
  - Which Red Team found each vulnerability
  - Severity level
  - How it was patched
  - Retest confirmation (pass/fail)

## Red Team Protocol

For EACH patch, you MUST run all 4 Red Teams:
- **RT1 — The Breaker**: Edge cases, null inputs, unexpected data, overflow conditions
- **RT2 — The Infiltrator**: Brute force, injection attempts, auth bypasses, privilege escalation, prompt injection
- **RT3 — The Dismantler**: Race conditions, memory leaks, dependency vulnerabilities, logic flaws
- **RT4 — The Ghost**: Silent failures, data corruption, timing attacks, subtle cracks

### The Hardening Loop
1. Write the code patch
2. Write tests for the patch
3. Run all 4 Red Teams
4. Document every vulnerability found
5. Patch the vulnerability
6. Red Teams retest
7. Loop repeats until all 4 Red Teams find zero vulnerabilities
8. Only then is the patch approved

## Deliverables

1. All 16 vulnerabilities patched and retested
2. Documentation updated in `docs/VULNERABILITIES.md`
3. Full test suite passing (127/127)
4. No new vulnerabilities found by any Red Team

## Success Criteria

- [ ] All 16 vulnerabilities documented as FIXED in docs/VULNERABILITIES.md
- [ ] All 4 Red Teams find zero vulnerabilities after patching
- [ ] All 127 tests passing
- [ ] No regressions introduced
- [ ] Security audit complete with retest confirmations

## Reporting Back

Report back to Gumball (VJ) with:
1. All patches completed and verified
2. Final vulnerability report showing all FIXED
3. Red Team results for each patch
4. Test suite status
5. Ready for deployment

---

**Important**: Quality standard is 100% hardened. No exceptions. Every patch must pass all 4 Red Teams before approval. Don't ship until it's bulletproof.
---

## ⚡ FULL AUTONOMY INSTRUCTION

**FROM: Gumball (VJ)**

Claude Code — You have FULL AUTONOMY and 100% PERMISSION. 

- **DO NOT ask for permission** to write files, run tests, or modify code
- **DO NOT ask** VS Code for anything
- **EXECUTE** Phase 6 completely on your own
- **Run all 4 Red Teams** on every patch
- **Don't stop** until all 16 vulnerabilities are FIXED and retested
- **Report back** to me when complete

You know what to do. Just build it. No questions. Just results.

**Gotcha Ya Boss! 👍**

