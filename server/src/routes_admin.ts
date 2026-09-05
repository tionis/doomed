import { Hono } from "hono";
import { cors } from "hono/cors";
import * as A from "@automerge/automerge";
import { verifyHostToken, type HostIdentity } from "./auth.js";
import { deleteRoom, ensureDoc, listDocs, setDoc } from "./store.js";

export type AdminIdentity = {
  id: string;
  email: string;
  note?: string;
  createdAt: number;
  createdBy?: string;
};

const ADMINS_PATH = new URL("../../data/admins.json", import.meta.url);

async function readAdmins(): Promise<AdminIdentity[]> {
  try {
    const file = Bun.file(ADMINS_PATH);
    if (!(await file.exists())) return [];
    return (await file.json()) as AdminIdentity[];
  } catch {
    return [];
  }
}

async function writeAdmins(admins: AdminIdentity[]) {
  await Bun.write(ADMINS_PATH, JSON.stringify(admins));
}

function envAdmins(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAdmin(identity: HostIdentity | null): Promise<boolean> {
  if (!identity) return false;
  if (identity.email && envAdmins().includes(identity.email.toLowerCase())) return true;
  const admins = await readAdmins();
  if (admins.length === 0 && envAdmins().length === 0) return true;
  if (!identity.email) return false;
  return admins.some((a) => a.email.toLowerCase() === identity.email!.toLowerCase());
}

function isStale(updatedAt: number) {
  return Date.now() - updatedAt > 24 * 60 * 60 * 1000;
}

export const admin = new Hono<{ Variables: { identity: HostIdentity } }>();
admin.use("/*", cors());

admin.use("/*", async (c, next) => {
  const identity = await verifyHostToken(c.req.header("authorization") ?? null);
  if (!(await isAdmin(identity))) return c.json({ error: "admin required" }, 403);
  c.set("identity", identity!);
  await next();
});

admin.get("/rooms", async (c) => {
  const docs = await listDocs();
  return c.json(
    docs
      .map(({ doc }) => ({
        room: doc.room,
        playerCount: Object.keys(doc.players).length,
        submissionCount: Object.keys(doc.submissions).length,
        judgmentCount: Object.keys(doc.judgments).length,
      }))
      .sort((a, b) => b.room.updatedAt - a.room.updatedAt),
  );
});

admin.get("/rooms/:code", async (c) => {
  const doc = await ensureDoc(c.req.param("code"));
  if (!doc) return c.json({ error: "not found" }, 404);
  return c.json(doc);
});

admin.post("/rooms/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  const patch = (await c.req.json()) as Record<string, unknown>;
  const allowed = new Set([
    "status", "finishedAt", "archivedAt", "hiddenFromHostHistory",
    "cleanupReason", "deadlineAt", "updatedAt",
  ]);
  const next = A.change(doc, (d) => {
    for (const [k, v] of Object.entries(patch)) {
      if (allowed.has(k)) (d.room as Record<string, unknown>)[k] = v;
    }
    d.room.updatedAt = Date.now();
  });
  setDoc(code, next);
  return c.json(next.room);
});

admin.post("/rooms/cleanup/run", async (c) => {
  const { mode } = (await c.req.json()) as { mode: "stale" | "oldFinished" | "unlinked" };
  const docs = await listDocs();
  const now = Date.now();
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const unlinkedMs = Number(process.env.OLD_UNLINKED_MS ?? 7 * 24 * 60 * 60 * 1000);
  let archived = 0;
  for (const { code, doc } of docs) {
    if (doc.room.archivedAt) continue;
    const match =
      mode === "stale"
        ? doc.room.status !== "finished" && isStale(doc.room.updatedAt)
        : mode === "oldFinished"
          ? doc.room.status === "finished" && (doc.room.finishedAt ?? doc.room.updatedAt) < cutoff
          : !doc.room.hostUserId && now - doc.room.updatedAt > unlinkedMs;
    if (!match) continue;
    const next = A.change(doc, (d) => {
      d.room.archivedAt = now;
      d.room.hiddenFromHostHistory = true;
      d.room.cleanupReason = `Archived by ${mode} cleanup from admin panel.`;
      d.room.updatedAt = now;
    });
    setDoc(code, next);
    archived += 1;
  }
  return c.json({ archived });
});

admin.delete("/rooms/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  await deleteRoom(code);
  return c.json({ deleted: code });
});

admin.get("/admins", async () => {
  return Response.json(await readAdmins());
});

admin.post("/admins", async (c) => {
  const identity = c.get("identity") as HostIdentity;
  const body = (await c.req.json()) as { email?: string; note?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email) return c.json({ error: "email required" }, 400);
  const admins = await readAdmins();
  if (admins.some((a) => a.email.toLowerCase() === email)) return c.json({ error: "already admin" }, 409);
  const admin: AdminIdentity = {
    id: crypto.randomUUID(),
    email,
    note: String(body.note ?? "").slice(0, 200),
    createdAt: Date.now(),
    createdBy: identity.email ?? identity.sub,
  };
  admins.push(admin);
  await writeAdmins(admins);
  return c.json(admin, 201);
});

admin.delete("/admins/:id", async (c) => {
  const admins = await readAdmins();
  const next = admins.filter((a) => a.id !== c.req.param("id"));
  if (next.length === admins.length) return c.json({ error: "not found" }, 404);
  await writeAdmins(next);
  return c.json({ deleted: c.req.param("id") });
});
