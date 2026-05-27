import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { getConfig } from "../config.js";
import { pool } from "../db/pool.js";
import type { User } from "../game/types.js";
import { camel } from "../util/case.js";
import { HttpError } from "../util/http.js";

export async function createSession(userId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into sessions(id, user_id, expires_at)
     values ($1, $2, $3)`,
    [id, userId, new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()],
  );
  return id;
}

export function setSessionCookie(reply: FastifyReply, sessionId: string) {
  const config = getConfig();
  reply.setCookie(config.sessionCookieName, sessionId, {
    path: "/",
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(getConfig().sessionCookieName, { path: "/" });
}

export async function getUserFromRequest(
  request: FastifyRequest,
): Promise<User | null> {
  const sessionId = request.cookies[getConfig().sessionCookieName];
  if (!sessionId) return null;

  const result = await pool.query(
    `select u.*
       from sessions s
       join users u on u.id = s.user_id
      where s.id = $1
        and s.revoked_at is null
        and s.expires_at > now()
      limit 1`,
    [sessionId],
  );

  if (!result.rowCount) return null;
  const user = camel<User>(result.rows[0]);
  if (user.bannedAt) throw new HttpError(403, "User is banned");
  return user;
}

export async function requireUser(request: FastifyRequest): Promise<User> {
  const user = await getUserFromRequest(request);
  if (!user) throw new HttpError(401, "Login required");
  return user;
}

export async function revokeSession(request: FastifyRequest) {
  const sessionId = request.cookies[getConfig().sessionCookieName];
  if (!sessionId) return;
  await pool.query("update sessions set revoked_at = now() where id = $1", [
    sessionId,
  ]);
}
