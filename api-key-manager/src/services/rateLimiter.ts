// In-memory sliding window rate limiter using closures and Maps

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp ms
  limit: number;
}

export interface RateLimiter {
  check(keyId: string, windowMs: number, maxRequests: number): RateLimitResult;
  increment(keyId: string): void;
  reset(keyId: string): void;
  cleanup(): void;
  destroy(): void;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export function createRateLimiter(): RateLimiter {
  const timestamps = new Map<string, number[]>();

  function check(keyId: string, windowMs: number, maxRequests: number): RateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;
    const entries = timestamps.get(keyId);
    const recent = entries ? entries.filter((ts) => ts > windowStart) : [];
    const count = recent.length;
    const allowed = count < maxRequests;
    const remaining = Math.max(0, maxRequests - count);
    // resetAt is the earliest moment the oldest request in the window expires
    const resetAt = recent.length > 0 ? recent[0] + windowMs : now + windowMs;

    return { allowed, remaining, resetAt, limit: maxRequests };
  }

  function increment(keyId: string): void {
    const now = Date.now();
    const cutoff = now - ONE_HOUR_MS;
    const entries = timestamps.get(keyId);
    if (entries) {
      // Inline cleanup: trim entries older than 1 hour
      const trimmed = entries.filter((ts) => ts > cutoff);
      trimmed.push(now);
      timestamps.set(keyId, trimmed);
    } else {
      timestamps.set(keyId, [now]);
    }
  }

  function reset(keyId: string): void {
    timestamps.delete(keyId);
  }

  function cleanup(): void {
    const cutoff = Date.now() - ONE_HOUR_MS;
    for (const [keyId, entries] of timestamps) {
      const recent = entries.filter((ts) => ts > cutoff);
      if (recent.length === 0) {
        timestamps.delete(keyId);
      } else {
        timestamps.set(keyId, recent);
      }
    }
  }

  // Automatic cleanup every 5 minutes
  const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  const cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref(); // Don't prevent process exit

  function destroy(): void {
    clearInterval(cleanupTimer);
    timestamps.clear();
  }

  return { check, increment, reset, cleanup, destroy };
}
