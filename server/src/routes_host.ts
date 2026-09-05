import { Hono } from "hono";
import { cors } from "hono/cors";
import { verifyHostToken } from "./auth.js";
import { listDocs } from "./store.js";

export const host = new Hono();
host.use("/*", cors());

host.get("/rooms", async (c) => {
  const identity = await verifyHostToken(c.req.header("authorization") ?? null);
  if (!identity) return c.json({ error: "host OIDC login required" }, 401);
  const docs = await listDocs();
  return c.json(
    docs
      .filter(({ doc }) => doc.room.hostUserId === identity.sub && !doc.room.hiddenFromHostHistory)
      .map(({ doc }) => doc.room)
      .sort((a, b) => b.createdAt - a.createdAt),
  );
});
