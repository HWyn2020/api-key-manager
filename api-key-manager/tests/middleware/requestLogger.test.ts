import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';
import { requestLogger } from '../../src/middleware/requestLogger';

function createMocks(overrides: Partial<{ method: string; originalUrl: string; ip: string; statusCode: number }> = {}) {
  const mockReq = {
    method: overrides.method ?? 'GET',
    originalUrl: overrides.originalUrl ?? '/api/keys',
    ip: overrides.ip ?? '127.0.0.1',
    headers: {},
    socket: { remoteAddress: overrides.ip ?? '127.0.0.1' },
  } as unknown as Request;

  const mockRes = Object.assign(new EventEmitter(), {
    statusCode: overrides.statusCode ?? 200,
  }) as unknown as Response;

  const mockNext = jest.fn() as NextFunction;

  return { mockReq, mockRes, mockNext };
}

describe('requestLogger middleware', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('calls next() immediately', () => {
    const { mockReq, mockRes, mockNext } = createMocks();

    requestLogger(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('logs on response finish', () => {
    const { mockReq, mockRes, mockNext } = createMocks();

    requestLogger(mockReq, mockRes, mockNext);

    expect(consoleSpy).not.toHaveBeenCalled();

    (mockRes as unknown as EventEmitter).emit('finish');

    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('includes method and URL in log output', () => {
    const { mockReq, mockRes, mockNext } = createMocks({
      method: 'POST',
      originalUrl: '/api/keys/create',
    });

    requestLogger(mockReq, mockRes, mockNext);
    (mockRes as unknown as EventEmitter).emit('finish');

    const logMessage: string = consoleSpy.mock.calls[0][0];
    expect(logMessage).toContain('POST');
    expect(logMessage).toContain('/api/keys/create');
  });

  it('includes status code in log output', () => {
    const { mockReq, mockRes, mockNext } = createMocks({ statusCode: 404 });

    requestLogger(mockReq, mockRes, mockNext);
    (mockRes as unknown as EventEmitter).emit('finish');

    const logMessage: string = consoleSpy.mock.calls[0][0];
    expect(logMessage).toContain('404');
  });

  it('includes response time in log output', () => {
    const { mockReq, mockRes, mockNext } = createMocks();

    requestLogger(mockReq, mockRes, mockNext);
    (mockRes as unknown as EventEmitter).emit('finish');

    const logMessage: string = consoleSpy.mock.calls[0][0];
    // Should contain a duration like "0ms" or "1ms"
    expect(logMessage).toMatch(/\d+ms/);
  });
});
