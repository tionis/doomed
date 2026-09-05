import type { Context, Next } from "hono";

const buckets = new Map<string, number[]>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return async (c: Context, next: Next) => {
    const forwarded = c.req.header("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || "direct";
    const key = `${ip}:${c.req.path}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
    if (hits.length >= maxRequests) {
      const retryAfter = Math.ceil((hits[0] + windowMs - now) / 1000);
      c.header("Retry-After", String(Math.max(1, retryAfter)));
      return c.json({ error: "rate limited" }, 429);
    }
    hits.push(now);
    buckets.set(key, hits);
    await next();
  };
}

export function clearRateLimits() {
  buckets.clear();
}
