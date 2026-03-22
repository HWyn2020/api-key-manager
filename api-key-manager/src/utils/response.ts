// Standard API response helpers

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export function success<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function error(
  code: string,
  message: string,
  statusCode: number = 500,
): { body: ApiResponse; status: number } {
  return {
    body: { success: false, error: { code, message } },
    status: statusCode,
  };
}

// Common error factories

export function notFound(message = 'Resource not found') {
  return error('NOT_FOUND', message, 404);
}

export function badRequest(message = 'Bad request') {
  return error('BAD_REQUEST', message, 400);
}

export function unauthorized(message = 'Unauthorized') {
  return error('UNAUTHORIZED', message, 401);
}

export function forbidden(message = 'Forbidden') {
  return error('FORBIDDEN', message, 403);
}

export function tooManyRequests(
  message = 'Too many requests',
  retryAfter?: number,
) {
  const resp = error('TOO_MANY_REQUESTS', message, 429);
  if (retryAfter !== undefined) {
    return { ...resp, retryAfter };
  }
  return resp;
}

export function internal(message = 'Internal server error') {
  return error('INTERNAL_ERROR', message, 500);
}
