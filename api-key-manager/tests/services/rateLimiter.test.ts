import { createRateLimiter } from '../../src/services/rateLimiter';

describe('rateLimiter', () => {
  it('check returns allowed=true when under limit', () => {
    const limiter = createRateLimiter();
    const result = limiter.check('key-1', 60000, 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
    expect(result.limit).toBe(10);
  });

  it('check returns allowed=false when at limit', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.increment('key-1');
    }
    const result = limiter.check('key-1', 60000, 5);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('increment adds to count', () => {
    const limiter = createRateLimiter();
    limiter.increment('key-1');
    limiter.increment('key-1');
    limiter.increment('key-1');
    const result = limiter.check('key-1', 60000, 10);
    expect(result.remaining).toBe(7);
  });

  it('reset clears the key entries', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.increment('key-1');
    }
    limiter.reset('key-1');
    const result = limiter.check('key-1', 60000, 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });

  it('cleanup removes old entries', () => {
    const limiter = createRateLimiter();
    // Manually add timestamps that are older than 1 hour by mocking Date.now
    const realNow = Date.now;
    const pastTime = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago

    // Increment at a past time
    Date.now = () => pastTime;
    limiter.increment('old-key');
    Date.now = realNow;

    // Increment at current time
    limiter.increment('new-key');

    limiter.cleanup();

    // old-key entries should be gone (all older than 1 hour)
    const oldResult = limiter.check('old-key', 60000, 10);
    expect(oldResult.remaining).toBe(10);

    // new-key entries should remain
    const newResult = limiter.check('new-key', 60000, 10);
    expect(newResult.remaining).toBe(9);
  });

  it('sliding window: old requests fall off after window expires', () => {
    const limiter = createRateLimiter();
    const realNow = Date.now;

    const pastTime = Date.now() - 120000; // 2 minutes ago
    Date.now = () => pastTime;
    limiter.increment('key-1');
    limiter.increment('key-1');
    Date.now = realNow;

    // With a 60-second window, those 2-minute-old requests should not count
    const result = limiter.check('key-1', 60000, 10);
    expect(result.remaining).toBe(10);
    expect(result.allowed).toBe(true);
  });

  it('remaining count is accurate', () => {
    const limiter = createRateLimiter();
    limiter.increment('key-1');
    limiter.increment('key-1');
    limiter.increment('key-1');
    const result = limiter.check('key-1', 60000, 5);
    expect(result.remaining).toBe(2);
    expect(result.allowed).toBe(true);
  });

  it('resetAt is correct', () => {
    const limiter = createRateLimiter();
    const before = Date.now();
    limiter.increment('key-1');
    const result = limiter.check('key-1', 60000, 10);
    // resetAt should be approximately the first timestamp + windowMs
    expect(result.resetAt).toBeGreaterThanOrEqual(before + 60000);
    expect(result.resetAt).toBeLessThanOrEqual(Date.now() + 60000);
  });

  it('multiple keys are independent', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.increment('key-a');
    }
    limiter.increment('key-b');

    const resultA = limiter.check('key-a', 60000, 5);
    const resultB = limiter.check('key-b', 60000, 5);

    expect(resultA.allowed).toBe(false);
    expect(resultA.remaining).toBe(0);
    expect(resultB.allowed).toBe(true);
    expect(resultB.remaining).toBe(4);
  });
});
