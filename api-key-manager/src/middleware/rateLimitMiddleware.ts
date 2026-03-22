import { Request, Response, NextFunction } from 'express';
import { RateLimiter } from '../services/rateLimiter';

declare global {
  namespace Express {
    interface Request {
      apiKeyEntity?: import('../models/Key').ApiKeyEntity;
    }
  }
}

export function createRateLimitMiddleware(rateLimiter: RateLimiter) {
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const entity = req.apiKeyEntity;

    if (!entity) {
      next();
      return;
    }

    const { windowMs, maxRequests } = entity.rateLimit;
    const result = rateLimiter.check(entity.id, windowMs, maxRequests);

    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

    if (!result.allowed) {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: `Rate limit exceeded. Try again after ${new Date(result.resetAt).toISOString()}`,
        },
      });
      return;
    }

    rateLimiter.increment(entity.id);
    next();
  };
}
