import { Hono } from "hono";
import { cors } from "hono/cors";

export type ScimUser = { id: string; userName: string; emails: Array<{ value: string }>; active: boolean };

const users = new Map<string, ScimUser>();
const SCIM_TOKEN = () => process.env.SCIM_TOKEN ?? "";

export const scim = new Hono();
scim.use("/*", cors());

function authed(c: { req: { header: (n: string) => string | undefined } }) {
  return c.req.header("authorization") === `Bearer ${SCIM_TOKEN()}` && SCIM_TOKEN().length > 0;
}

scim.get("/Users", (c) => {
  if (!authed(c)) return c.text("unauthorized", 401);
  return c.json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults: users.size, Resources: [...users.values()] });
});

scim.post("/Users", async (c) => {
  if (!authed(c)) return c.text("unauthorized", 401);
  const body = (await c.req.json()) as { userName?: string; emails?: Array<{ value: string }> };
  if (!body.userName) return c.text("userName required", 400);
  const id = crypto.randomUUID();
  const user: ScimUser = { id, userName: body.userName, emails: body.emails ?? [], active: true };
  users.set(id, user);
  return c.json(user, 201);
});

scim.delete("/Users/:id", (c) => {
  if (!authed(c)) return c.text("unauthorized", 401);
  users.delete(c.req.param("id"));
  return c.body(null, 204);
});
