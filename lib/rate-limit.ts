type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfterMs: number; resetAt: number };

interface Entry {
  count: number;
  resetAt: number;
}

const STORE = new Map<string, Entry>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const current = STORE.get(key);

  if (!current || now >= current.resetAt) {
    const resetAt = now + windowMs;
    STORE.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt };
  }

  if (current.count >= limit) {
    return { ok: false, retryAfterMs: Math.max(0, current.resetAt - now), resetAt: current.resetAt };
  }

  current.count += 1;
  STORE.set(key, current);
  return { ok: true, remaining: limit - current.count, resetAt: current.resetAt };
}
