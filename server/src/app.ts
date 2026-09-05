import { Hono } from "hono";
import { cors } from "hono/cors";
import { rooms } from "./routes_rooms.js";
import { admin } from "./routes_admin.js";
import { host } from "./routes_host.js";
import { oidc } from "./oidc.js";
import { scim } from "./scim.js";
import { ensureDoc } from "./store.js";
import { rateLimit } from "./ratelimit.js";
import { serveClient } from "./static.js";

const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const app = new Hono();
app.use(
  "/*",
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    allowHeaders: ["content-type", "authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  }),
);

// Abuse-sensitive endpoints: login callback, judging (LLM spend), SCIM writes.
app.use("/api/auth/oidc/*", rateLimit(30, 60_000));
app.use("/api/rooms/*/judge", rateLimit(30, 60_000));
app.use("/scim/v2/*", rateLimit(120, 60_000));
// General API guardrail (polling + heartbeats sit far below this).
app.use("/api/*", rateLimit(600, 60_000));

app.get("/healthz", (c) => c.json({ ok: true }));
app.get("/api/config", (c) =>
  c.json({
    oidcIssuer: process.env.OIDC_ISSUER ?? null,
    oidcClientId: process.env.OIDC_CLIENT_ID ?? null,
    oidcRequired: Boolean(process.env.OIDC_ISSUER),
    syncMode: "automerge",
  }),
);
app.route("/api/rooms", rooms);
app.route("/api/host", host);
app.route("/api/admin", admin);
app.route("/api/auth/oidc", oidc);
app.route("/scim/v2", scim);

app.get("/sync/:code", async (c) => {
  const doc = await ensureDoc(c.req.param("code"));
  if (!doc) return c.json({ error: "not found" }, 404);
  return c.json(doc);
});

// Serve the built client when dist/client exists (single-container deploy),
// otherwise 404 so split hosting keeps working.
app.get("*", serveClient);
