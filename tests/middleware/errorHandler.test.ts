import { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../src/middleware/errorHandler';

function createMocks() {
  const mockReq = {
    method: 'GET',
    originalUrl: '/api/keys/123',
  } as Request;

  const mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;

  const mockNext = jest.fn() as NextFunction;

  return { mockReq, mockRes, mockNext };
}

describe('errorHandler middleware', () => {
  const originalEnv = process.env.NODE_ENV;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    consoleSpy.mockRestore();
  });

  it('returns 404 for "not found" errors', () => {
    const { mockReq, mockRes, mockNext } = createMocks();
    const err = new Error('API key not found');

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'NOT_FOUND', message: 'API key not found' },
    });
  });

  it('returns 409 for "already revoked" errors', () => {
    const { mockReq, mockRes, mockNext } = createMocks();
    const err = new Error('Key is already revoked');

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'ALREADY_REVOKED', message: 'Key is already revoked' },
    });
  });

  it('returns 409 for "must be ACTIVE" errors', () => {
    const { mockReq, mockRes, mockNext } = createMocks();
    const err = new Error('Key must be active to rotate');

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INVALID_STATUS', message: 'Key must be active to rotate' },
    });
  });

  it('returns 500 for unknown errors', () => {
    const { mockReq, mockRes, mockNext } = createMocks();
    const err = new Error('Something broke');

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
  });

  it('does not leak error details in production', () => {
    process.env.NODE_ENV = 'production';
    const { mockReq, mockRes, mockNext } = createMocks();
    const err = new Error('database connection pool exhausted');

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });

  it('includes error message in development', () => {
    process.env.NODE_ENV = 'development';
    const { mockReq, mockRes, mockNext } = createMocks();
    const err = new Error('database connection pool exhausted');

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'database connection pool exhausted' },
    });
  });

  it('calls console.error with error details', () => {
    const { mockReq, mockRes, mockNext } = createMocks();
    const err = new Error('Something broke');

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const [logMessage, details] = consoleSpy.mock.calls[0];
    expect(logMessage).toContain('Something broke');
    expect(details).toEqual(
      expect.objectContaining({
        method: 'GET',
        url: '/api/keys/123',
        stack: expect.any(String),
      })
    );
  });

  it('response format is { success: false, error: { code, message } }', () => {
    const { mockReq, mockRes, mockNext } = createMocks();
    const err = new Error('API key not found');

    errorHandler(err, mockReq, mockRes, mockNext);

    const body = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(body).toHaveProperty('success', false);
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
    expect(Object.keys(body)).toEqual(['success', 'error']);
    expect(Object.keys(body.error)).toEqual(['code', 'message']);
  });
});
