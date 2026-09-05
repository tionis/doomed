import { Hono } from "hono";
import { cors } from "hono/cors";
import { rooms } from "./routes_rooms.js";
import { admin } from "./routes_admin.js";
import { host } from "./routes_host.js";
import { scim } from "./scim.js";
import { ensureDoc } from "./store.js";

export const app = new Hono();
app.use("/*", cors());

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
app.route("/scim/v2", scim);

app.get("/sync/:code", async (c) => {
  const doc = await ensureDoc(c.req.param("code"));
  if (!doc) return c.json({ error: "not found" }, 404);
  return c.json(doc);
});
