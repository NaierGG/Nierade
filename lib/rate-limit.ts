import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfterMs: number; resetAt: number };

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL ?? "";
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

const redis =
  upstashUrl && upstashToken
    ? new Redis({
        url: upstashUrl,
        token: upstashToken
      })
    : null;

const ratelimitCache = new Map<string, Ratelimit>();

function getLimiter(limit: number, windowMs: number) {
  if (!redis) {
    return null;
  }
  const key = `${limit}:${windowMs}`;
  const cached = ratelimitCache.get(key);
  if (cached) {
    return cached;
  }
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(limit, `${Math.max(1, Math.ceil(windowMs / 1000))} s`),
    prefix: "nierade:ratelimit"
  });
  ratelimitCache.set(key, limiter);
  return limiter;
}

export function getKey(namespace: string, identifier: string) {
  return `ratelimit:${namespace}:${identifier}`;
}

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const limiter = getLimiter(limit, windowMs);
  if (!limiter) {
    return { ok: true, remaining: limit, resetAt: Date.now() + windowMs };
  }

  const result = await limiter.limit(key);
  if (!result.success) {
    const resetAt = result.reset ? result.reset : Date.now() + windowMs;
    return {
      ok: false,
      retryAfterMs: Math.max(0, resetAt - Date.now()),
      resetAt
    };
  }

  return {
    ok: true,
    remaining: Math.max(0, result.remaining),
    resetAt: result.reset
  };
}
