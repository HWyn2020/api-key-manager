import { Request, Response, NextFunction } from 'express';
import { createRateLimiter } from '../../src/services/rateLimiter';
import { createRateLimitMiddleware } from '../../src/middleware/rateLimitMiddleware';

function createMocks(apiKeyEntity?: { id: string; rateLimit: { windowMs: number; maxRequests: number } }) {
  const mockReq = {
    apiKeyEntity,
  } as unknown as Request;

  const headers: Record<string, string | number> = {};
  const mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn((name: string, value: string | number) => {
      headers[name] = value;
    }),
    getHeader: (name: string) => headers[name],
  } as unknown as Response;

  const mockNext = jest.fn() as NextFunction;

  return { mockReq, mockRes, mockNext, headers };
}

function defaultEntity(overrides: Partial<{ id: string; windowMs: number; maxRequests: number }> = {}) {
  return {
    id: overrides.id ?? 'test-key',
    rateLimit: {
      windowMs: overrides.windowMs ?? 60000,
      maxRequests: overrides.maxRequests ?? 5,
    },
  };
}

describe('rateLimitMiddleware', () => {
  let rateLimiter: ReturnType<typeof createRateLimiter>;
  let middleware: ReturnType<typeof createRateLimitMiddleware>;

  beforeEach(() => {
    rateLimiter = createRateLimiter();
    middleware = createRateLimitMiddleware(rateLimiter);
  });

  it('allows request when under limit', () => {
    const { mockReq, mockRes, mockNext } = createMocks(defaultEntity());

    middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('sets X-RateLimit-* headers', () => {
    const { mockReq, mockRes, mockNext, headers } = createMocks(defaultEntity({ maxRequests: 10 }));

    middleware(mockReq, mockRes, mockNext);

    expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(Number));
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
    expect(headers['X-RateLimit-Limit']).toBe(10);
  });

  it('calls next() when allowed', () => {
    const { mockReq, mockRes, mockNext } = createMocks(defaultEntity());

    middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('returns 429 when rate limited', () => {
    const entity = defaultEntity({ maxRequests: 2 });

    // Exhaust the limit
    for (let i = 0; i < 2; i++) {
      const { mockReq, mockRes, mockNext } = createMocks(entity);
      middleware(mockReq, mockRes, mockNext);
    }

    // Third request should be blocked
    const { mockReq, mockRes, mockNext } = createMocks(entity);
    middleware(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'RATE_LIMITED',
        }),
      })
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns correct remaining count', () => {
    const entity = defaultEntity({ maxRequests: 3 });

    // First request: remaining should be 2 after check (3 - 0 = 3 before increment, but header is set before increment)
    const { mockRes: res1, mockReq: req1, mockNext: next1, headers: h1 } = createMocks(entity);
    middleware(req1, res1, next1);
    expect(h1['X-RateLimit-Remaining']).toBe(3);

    // Second request: 1 request already recorded
    const { mockRes: res2, mockReq: req2, mockNext: next2, headers: h2 } = createMocks(entity);
    middleware(req2, res2, next2);
    expect(h2['X-RateLimit-Remaining']).toBe(2);

    // Third request: 2 requests already recorded
    const { mockRes: res3, mockReq: req3, mockNext: next3, headers: h3 } = createMocks(entity);
    middleware(req3, res3, next3);
    expect(h3['X-RateLimit-Remaining']).toBe(1);
  });

  it('skips rate limiting when no apiKeyEntity', () => {
    const { mockReq, mockRes, mockNext } = createMocks(undefined);

    middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRes.setHeader).not.toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('rate limits multiple keys independently', () => {
    const entityA = defaultEntity({ id: 'key-a', maxRequests: 1 });
    const entityB = defaultEntity({ id: 'key-b', maxRequests: 1 });

    // Exhaust key A
    const { mockReq: reqA1, mockRes: resA1, mockNext: nextA1 } = createMocks(entityA);
    middleware(reqA1, resA1, nextA1);
    expect(nextA1).toHaveBeenCalled();

    // Key A should be blocked
    const { mockReq: reqA2, mockRes: resA2, mockNext: nextA2 } = createMocks(entityA);
    middleware(reqA2, resA2, nextA2);
    expect(resA2.status).toHaveBeenCalledWith(429);

    // Key B should still work
    const { mockReq: reqB1, mockRes: resB1, mockNext: nextB1 } = createMocks(entityB);
    middleware(reqB1, resB1, nextB1);
    expect(nextB1).toHaveBeenCalled();
    expect(resB1.status).not.toHaveBeenCalled();
  });
});
