import {
  validateKeyCreate,
  validateRevoke,
  validateRotate,
  validateQueryParams,
  isNonEmptyString,
  isPositiveNumber,
} from '../../src/utils/validator';

describe('validator utilities', () => {
  // ── Type guards ──────────────────────────────────────────────────────

  describe('isNonEmptyString', () => {
    it('returns true for non-empty string', () => {
      expect(isNonEmptyString('hello')).toBe(true);
    });

    it('returns false for empty string', () => {
      expect(isNonEmptyString('')).toBe(false);
    });

    it('returns false for whitespace-only string', () => {
      expect(isNonEmptyString('   ')).toBe(false);
    });

    it('returns false for non-string types', () => {
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString(undefined)).toBe(false);
      expect(isNonEmptyString(123)).toBe(false);
      expect(isNonEmptyString(true)).toBe(false);
      expect(isNonEmptyString({})).toBe(false);
      expect(isNonEmptyString([])).toBe(false);
    });
  });

  describe('isPositiveNumber', () => {
    it('returns true for positive numbers', () => {
      expect(isPositiveNumber(1)).toBe(true);
      expect(isPositiveNumber(0.5)).toBe(true);
      expect(isPositiveNumber(999999)).toBe(true);
    });

    it('returns false for zero', () => {
      expect(isPositiveNumber(0)).toBe(false);
    });

    it('returns false for negative numbers', () => {
      expect(isPositiveNumber(-1)).toBe(false);
      expect(isPositiveNumber(-0.5)).toBe(false);
    });

    it('returns false for non-finite numbers', () => {
      expect(isPositiveNumber(Infinity)).toBe(false);
      expect(isPositiveNumber(-Infinity)).toBe(false);
      expect(isPositiveNumber(NaN)).toBe(false);
    });

    it('returns false for non-number types', () => {
      expect(isPositiveNumber('1')).toBe(false);
      expect(isPositiveNumber(null)).toBe(false);
      expect(isPositiveNumber(undefined)).toBe(false);
    });
  });

  // ── validateKeyCreate ────────────────────────────────────────────────

  describe('validateKeyCreate', () => {
    const validBody = {
      userId: 'user-1',
      keyName: 'my-key',
      scopes: ['read', 'write'],
    };

    it('returns valid for correct body', () => {
      const result = validateKeyCreate(validBody);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns valid with optional fields', () => {
      const result = validateKeyCreate({
        ...validBody,
        expiresInHours: 24,
        rateLimit: { windowMs: 60000, maxRequests: 100 },
      });
      expect(result.valid).toBe(true);
    });

    it('returns invalid for null body', () => {
      const result = validateKeyCreate(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('JSON object');
    });

    it('returns invalid for non-object body', () => {
      const result = validateKeyCreate('not an object');
      expect(result.valid).toBe(false);
    });

    it('returns error for missing userId', () => {
      const result = validateKeyCreate({ keyName: 'x', scopes: ['read'] });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('userId'))).toBe(true);
    });

    it('returns error for missing keyName', () => {
      const result = validateKeyCreate({ userId: 'x', scopes: ['read'] });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('keyName'))).toBe(true);
    });

    it('returns error for missing scopes', () => {
      const result = validateKeyCreate({ userId: 'x', keyName: 'y' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('scopes'))).toBe(true);
    });

    it('returns error for empty scopes array', () => {
      const result = validateKeyCreate({ ...validBody, scopes: [] });
      expect(result.valid).toBe(false);
    });

    it('returns error for non-string scopes', () => {
      const result = validateKeyCreate({ ...validBody, scopes: [1, 2] });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('scope'))).toBe(true);
    });

    it('returns error for invalid expiresInHours', () => {
      const result = validateKeyCreate({ ...validBody, expiresInHours: -1 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('expiresInHours'))).toBe(true);
    });

    it('returns error for zero expiresInHours', () => {
      const result = validateKeyCreate({ ...validBody, expiresInHours: 0 });
      expect(result.valid).toBe(false);
    });

    it('returns error for invalid rateLimit object', () => {
      const result = validateKeyCreate({ ...validBody, rateLimit: 'not-object' });
      expect(result.valid).toBe(false);
    });

    it('returns error for invalid rateLimit.windowMs', () => {
      const result = validateKeyCreate({
        ...validBody,
        rateLimit: { windowMs: -1, maxRequests: 100 },
      });
      expect(result.valid).toBe(false);
    });

    it('returns error for invalid rateLimit.maxRequests', () => {
      const result = validateKeyCreate({
        ...validBody,
        rateLimit: { windowMs: 60000, maxRequests: 0 },
      });
      expect(result.valid).toBe(false);
    });

    it('accumulates multiple errors', () => {
      const result = validateKeyCreate({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3); // userId, keyName, scopes
    });
  });

  // ── validateRevoke ───────────────────────────────────────────────────

  describe('validateRevoke', () => {
    it('returns valid for correct body', () => {
      const result = validateRevoke({ reason: 'compromised' });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns invalid for null body', () => {
      const result = validateRevoke(null);
      expect(result.valid).toBe(false);
    });

    it('returns error for missing reason', () => {
      const result = validateRevoke({});
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('reason'))).toBe(true);
    });

    it('returns error for empty reason', () => {
      const result = validateRevoke({ reason: '' });
      expect(result.valid).toBe(false);
    });

    it('returns error for whitespace-only reason', () => {
      const result = validateRevoke({ reason: '   ' });
      expect(result.valid).toBe(false);
    });
  });

  // ── validateRotate ───────────────────────────────────────────────────

  describe('validateRotate', () => {
    it('returns valid for correct body', () => {
      const result = validateRotate({ reason: 'scheduled' });
      expect(result.valid).toBe(true);
    });

    it('returns valid with optional gracePeriodMs', () => {
      const result = validateRotate({ reason: 'scheduled', gracePeriodMs: 60000 });
      expect(result.valid).toBe(true);
    });

    it('returns invalid for null body', () => {
      const result = validateRotate(null);
      expect(result.valid).toBe(false);
    });

    it('returns error for missing reason', () => {
      const result = validateRotate({});
      expect(result.valid).toBe(false);
    });

    it('returns error for invalid gracePeriodMs', () => {
      const result = validateRotate({ reason: 'test', gracePeriodMs: -1 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('gracePeriodMs'))).toBe(true);
    });

    it('returns error for zero gracePeriodMs', () => {
      const result = validateRotate({ reason: 'test', gracePeriodMs: 0 });
      expect(result.valid).toBe(false);
    });
  });

  // ── validateQueryParams ──────────────────────────────────────────────

  describe('validateQueryParams', () => {
    it('returns valid for empty query', () => {
      const result = validateQueryParams({});
      expect(result.valid).toBe(true);
    });

    it('returns valid for valid action', () => {
      const result = validateQueryParams({ action: 'key.created' });
      expect(result.valid).toBe(true);
    });

    it('returns error for invalid action', () => {
      const result = validateQueryParams({ action: 'invalid.action' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('action'))).toBe(true);
    });

    it('returns error for empty actorId', () => {
      const result = validateQueryParams({ actorId: '' });
      expect(result.valid).toBe(false);
    });

    it('returns valid for valid date range', () => {
      const result = validateQueryParams({
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-12-31T23:59:59.999Z',
      });
      expect(result.valid).toBe(true);
    });

    it('returns error for invalid startDate', () => {
      const result = validateQueryParams({ startDate: 'not-a-date' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('startDate'))).toBe(true);
    });

    it('returns error for invalid endDate', () => {
      const result = validateQueryParams({ endDate: 'not-a-date' });
      expect(result.valid).toBe(false);
    });

    it('returns error when startDate is after endDate', () => {
      const result = validateQueryParams({
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2024-01-01T00:00:00.000Z',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('before'))).toBe(true);
    });

    it('returns error for non-integer limit', () => {
      const result = validateQueryParams({ limit: 1.5 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('limit'))).toBe(true);
    });

    it('returns error for negative limit', () => {
      const result = validateQueryParams({ limit: -1 });
      expect(result.valid).toBe(false);
    });

    it('returns valid for valid limit', () => {
      const result = validateQueryParams({ limit: 10 });
      expect(result.valid).toBe(true);
    });

    it('returns error for negative offset', () => {
      const result = validateQueryParams({ offset: -1 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('offset'))).toBe(true);
    });

    it('returns valid for zero offset', () => {
      const result = validateQueryParams({ offset: 0 });
      expect(result.valid).toBe(true);
    });

    it('accumulates multiple errors', () => {
      const result = validateQueryParams({
        action: 'invalid',
        startDate: 'bad',
        limit: -1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
