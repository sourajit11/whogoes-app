/**
 * In-memory sliding-window rate limiter.
 * 60 requests per minute per API key.
 *
 * Acceptable for MVP on a single Vercel instance. Move to Redis once we
 * see traffic that spans cold starts or multiple regions.
 */

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 60;

const requestLog = new Map<string, number[]>();

export function checkRateLimit(apiKeyId: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const timestamps = (requestLog.get(apiKeyId) ?? []).filter(
    (t) => t > windowStart,
  );

  if (timestamps.length >= MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: timestamps[0] + WINDOW_MS,
    };
  }

  timestamps.push(now);
  requestLog.set(apiKeyId, timestamps);

  return {
    allowed: true,
    remaining: MAX_REQUESTS - timestamps.length,
    resetAt: now + WINDOW_MS,
  };
}

setInterval(
  () => {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [key, timestamps] of requestLog.entries()) {
      const filtered = timestamps.filter((t) => t > cutoff);
      if (filtered.length === 0) {
        requestLog.delete(key);
      } else {
        requestLog.set(key, filtered);
      }
    }
  },
  5 * 60 * 1000,
);
