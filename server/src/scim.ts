import { Hono } from "hono";
import { cors } from "hono/cors";
import { saveScimUsers, scimUsers, type ScimUser } from "./scimStore.js";

const SCIM_TOKEN = () => process.env.SCIM_TOKEN ?? "";

export const scim = new Hono();
scim.use("/*", cors());

function authed(c: { req: { header: (n: string) => string | undefined } }) {
  return c.req.header("authorization") === `Bearer ${SCIM_TOKEN()}` && SCIM_TOKEN().length > 0;
}

function toScimResource(user: ScimUser) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    ...user,
  };
}

scim.get("/Users", async (c) => {
  if (!authed(c)) return c.text("unauthorized", 401);
  const users = await scimUsers();
  let resources = [...users.values()];
  const filter = c.req.query("filter") ?? "";
  const match = filter.match(/userName\s+eq\s+"([^"]+)"/i);
  if (match) {
    resources = resources.filter(
      (u) => u.userName.toLowerCase() === match[1].toLowerCase(),
    );
  }
  return c.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: resources.length,
    Resources: resources.map(toScimResource),
  });
});

scim.get("/Users/:id", async (c) => {
  if (!authed(c)) return c.text("unauthorized", 401);
  const user = (await scimUsers()).get(c.req.param("id"));
  if (!user) return c.text("not found", 404);
  return c.json(toScimResource(user));
});

scim.post("/Users", async (c) => {
  if (!authed(c)) return c.text("unauthorized", 401);
  const body = (await c.req.json()) as {
    userName?: string;
    emails?: Array<{ value: string }>;
    active?: boolean;
    entitlements?: Array<string | { value: string }>;
  };
  if (!body.userName) return c.text("userName required", 400);
  const users = await scimUsers();
  const id = crypto.randomUUID();
  const user: ScimUser = {
    id,
    userName: body.userName,
    emails: body.emails ?? [],
    active: body.active ?? true,
    ...(body.entitlements ? { entitlements: body.entitlements.map((e) => (typeof e === "string" ? e : e.value)) } : {}),
  };
  users.set(id, user);
  await saveScimUsers();
  return c.json(toScimResource(user), 201);
});

scim.put("/Users/:id", async (c) => {
  if (!authed(c)) return c.text("unauthorized", 401);
  const users = await scimUsers();
  const existing = users.get(c.req.param("id"));
  if (!existing) return c.text("not found", 404);
  const body = (await c.req.json()) as {
    userName?: string;
    emails?: Array<{ value: string }>;
    active?: boolean;
    entitlements?: Array<string | { value: string }>;
  };
  if (!body.userName) return c.text("userName required", 400);
  const user: ScimUser = {
    id: existing.id,
    userName: body.userName,
    emails: body.emails ?? [],
    active: body.active ?? true,
    ...(body.entitlements ? { entitlements: body.entitlements.map((e) => (typeof e === "string" ? e : e.value)) } : {}),
  };
  users.set(user.id, user);
  await saveScimUsers();
  return c.json(toScimResource(user));
});

scim.patch("/Users/:id", async (c) => {
  if (!authed(c)) return c.text("unauthorized", 401);
  const users = await scimUsers();
  const user = users.get(c.req.param("id"));
  if (!user) return c.text("not found", 404);
  const body = (await c.req.json()) as {
    Operations?: Array<{ op?: string; path?: string; value?: unknown }>;
  };
  for (const operation of body.Operations ?? []) {
    if (operation.op?.toLowerCase() !== "replace") continue;
    const path = (operation.path ?? "").toLowerCase();
    if (path === "active") user.active = Boolean(operation.value);
    if (path === "entitlements" && Array.isArray(operation.value)) {
      user.entitlements = (operation.value as Array<string | { value: string }>).map((e) =>
        typeof e === "string" ? e : e.value,
      );
    }
  }
  users.set(user.id, user);
  await saveScimUsers();
  return c.json(toScimResource(user));
});

scim.delete("/Users/:id", async (c) => {
  if (!authed(c)) return c.text("unauthorized", 401);
  const users = await scimUsers();
  if (!users.has(c.req.param("id"))) return c.text("not found", 404);
  users.delete(c.req.param("id"));
  await saveScimUsers();
  return c.body(null, 204);
});
