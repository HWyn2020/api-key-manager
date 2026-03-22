import {
  success,
  error,
  notFound,
  badRequest,
  unauthorized,
  forbidden,
  tooManyRequests,
  internal,
} from '../../src/utils/response';

describe('response utilities', () => {
  describe('success', () => {
    it('returns success response with data', () => {
      const result = success({ key: 'value' });
      expect(result).toEqual({
        success: true,
        data: { key: 'value' },
      });
    });

    it('works with string data', () => {
      const result = success('hello');
      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('works with array data', () => {
      const result = success([1, 2, 3]);
      expect(result.data).toEqual([1, 2, 3]);
    });

    it('works with null data', () => {
      const result = success(null);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('error', () => {
    it('returns error response with default status 500', () => {
      const result = error('SOME_CODE', 'Something went wrong');
      expect(result.body).toEqual({
        success: false,
        error: { code: 'SOME_CODE', message: 'Something went wrong' },
      });
      expect(result.status).toBe(500);
    });

    it('returns error response with custom status', () => {
      const result = error('BAD_INPUT', 'Invalid data', 400);
      expect(result.status).toBe(400);
      expect(result.body.error!.code).toBe('BAD_INPUT');
    });
  });

  describe('notFound', () => {
    it('returns 404 with default message', () => {
      const result = notFound();
      expect(result.status).toBe(404);
      expect(result.body.error!.code).toBe('NOT_FOUND');
      expect(result.body.error!.message).toBe('Resource not found');
    });

    it('returns 404 with custom message', () => {
      const result = notFound('Key not found');
      expect(result.body.error!.message).toBe('Key not found');
    });
  });

  describe('badRequest', () => {
    it('returns 400 with default message', () => {
      const result = badRequest();
      expect(result.status).toBe(400);
      expect(result.body.error!.code).toBe('BAD_REQUEST');
    });

    it('returns 400 with custom message', () => {
      const result = badRequest('Missing field');
      expect(result.body.error!.message).toBe('Missing field');
    });
  });

  describe('unauthorized', () => {
    it('returns 401 with default message', () => {
      const result = unauthorized();
      expect(result.status).toBe(401);
      expect(result.body.error!.code).toBe('UNAUTHORIZED');
    });
  });

  describe('forbidden', () => {
    it('returns 403 with default message', () => {
      const result = forbidden();
      expect(result.status).toBe(403);
      expect(result.body.error!.code).toBe('FORBIDDEN');
    });
  });

  describe('tooManyRequests', () => {
    it('returns 429 with default message', () => {
      const result = tooManyRequests();
      expect(result.status).toBe(429);
      expect(result.body.error!.code).toBe('TOO_MANY_REQUESTS');
    });

    it('returns 429 with retryAfter', () => {
      const result = tooManyRequests('Slow down', 60);
      expect(result.status).toBe(429);
      expect((result as any).retryAfter).toBe(60);
    });

    it('omits retryAfter when not provided', () => {
      const result = tooManyRequests();
      expect((result as any).retryAfter).toBeUndefined();
    });
  });

  describe('internal', () => {
    it('returns 500 with default message', () => {
      const result = internal();
      expect(result.status).toBe(500);
      expect(result.body.error!.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 with custom message', () => {
      const result = internal('DB connection failed');
      expect(result.body.error!.message).toBe('DB connection failed');
    });
  });
});
