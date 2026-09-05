import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { clearRateLimits, rateLimit } from "./ratelimit.js";

describe("rateLimit", () => {
  test("allows up to max then returns 429", async () => {
    clearRateLimits();
    const app = new Hono();
    app.use("/limited", rateLimit(2, 60_000));
    app.get("/limited", (c) => c.json({ ok: true }));
    const headers = { "x-forwarded-for": `test-${Date.now()}` };
    expect((await app.request("/limited", { headers })).status).toBe(200);
    expect((await app.request("/limited", { headers })).status).toBe(200);
    const limited = await app.request("/limited", { headers });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
  });
});
