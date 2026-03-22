import { Request, Response, NextFunction } from 'express';

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

function sanitizeMessage(message: string): string {
  return message.replace(UUID_REGEX, '[redacted]');
}

function mapError(err: Error): { status: number; response: ErrorResponse } {
  const message = err.message || '';
  const lowerMessage = message.toLowerCase();
  const isProduction = process.env.NODE_ENV === 'production';

  if (lowerMessage.includes('not found')) {
    return {
      status: 404,
      response: {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: isProduction ? 'Resource not found' : sanitizeMessage(err.message),
        },
      },
    };
  }

  if (lowerMessage.includes('already revoked')) {
    return {
      status: 409,
      response: {
        success: false,
        error: {
          code: 'ALREADY_REVOKED',
          message: isProduction ? 'Key is already revoked' : sanitizeMessage(err.message),
        },
      },
    };
  }

  if (lowerMessage.includes('must be active')) {
    return {
      status: 409,
      response: {
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: isProduction ? 'Key must be active for this operation' : sanitizeMessage(err.message),
        },
      },
    };
  }

  // Default: 500 — don't leak internals in production
  return {
    status: 500,
    response: {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: isProduction ? 'An unexpected error occurred' : sanitizeMessage(err.message),
      },
    },
  };
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] Error: ${err.message}`, {
    method: req.method,
    url: req.originalUrl,
    stack: err.stack,
  });

  const { status, response } = mapError(err);
  res.status(status).json(response);
}
