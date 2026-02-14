type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfterMs: number; resetAt: number };

interface RateLimiterBackend {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

class MemoryFallbackLimiter implements RateLimiterBackend {
  private readonly store = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const current = this.store.get(key);

    if (!current || now >= current.resetAt) {
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      return { ok: true, remaining: Math.max(0, limit - 1), resetAt };
    }

    if (current.count >= limit) {
      return { ok: false, retryAfterMs: Math.max(0, current.resetAt - now), resetAt: current.resetAt };
    }

    current.count += 1;
    this.store.set(key, current);
    return { ok: true, remaining: Math.max(0, limit - current.count), resetAt: current.resetAt };
  }
}

class UpstashRestLimiter implements RateLimiterBackend {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const resetAt = now + windowMs;
    const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));

    const pipelineRes = await fetch(`${this.baseUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(ttlSeconds)],
        ["TTL", key]
      ]),
      cache: "no-store"
    });

    if (!pipelineRes.ok) {
      throw new Error(`KV pipeline failed: ${pipelineRes.status}`);
    }

    const payload = (await pipelineRes.json()) as Array<{ result?: number | string }>;
    const count = Number(payload?.[0]?.result ?? 0);
    const ttl = Number(payload?.[2]?.result ?? ttlSeconds);
    const computedResetAt = now + Math.max(0, ttl) * 1000;

    if (count > limit) {
      return {
        ok: false,
        retryAfterMs: Math.max(0, computedResetAt - now),
        resetAt: computedResetAt || resetAt
      };
    }

    return {
      ok: true,
      remaining: Math.max(0, limit - count),
      resetAt: computedResetAt || resetAt
    };
  }
}

function createRateLimiter(): RateLimiterBackend {
  const baseUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

  if (baseUrl && token) {
    return new UpstashRestLimiter(baseUrl, token);
  }

  // TODO: Replace fallback with a durable backend in production if KV is unavailable.
  return new MemoryFallbackLimiter();
}

const limiter = createRateLimiter();

export function getKey(namespace: string, identifier: string) {
  return `ratelimit:${namespace}:${identifier}`;
}

export async function hit(key: string, limit: number, windowMs: number) {
  return limiter.hit(key, limit, windowMs);
}

export async function checkRateLimit(key: string, limit: number, windowMs: number) {
  return hit(key, limit, windowMs);
}
