import { randomUUID } from "node:crypto";
import { pool, transaction } from "../db/pool.js";

export type ExternalIdentity = {
  provider: string;
  issuer: string;
  subject: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export async function findOrCreateUserFromIdentity(
  identity: ExternalIdentity,
): Promise<string> {
  return transaction(async (client) => {
    const existing = await client.query(
      `select user_id
         from user_identities
        where provider = $1 and issuer = $2 and subject = $3
        limit 1`,
      [identity.provider, identity.issuer, identity.subject],
    );

    if (existing.rowCount) {
      const userId = existing.rows[0].user_id as string;
      await client.query(
        `update users
            set display_name = coalesce(nullif($2, ''), display_name),
                email = coalesce($3, email),
                avatar_url = coalesce($4, avatar_url),
                last_login_at = now()
          where id = $1`,
        [userId, identity.displayName, identity.email, identity.avatarUrl],
      );
      return userId;
    }

    const userId = randomUUID();
    await client.query(
      `insert into users(id, display_name, email, avatar_url, created_at, last_login_at)
       values ($1, $2, $3, $4, now(), now())`,
      [userId, identity.displayName, identity.email, identity.avatarUrl],
    );
    await client.query(
      `insert into user_identities(id, user_id, provider, issuer, subject, email, created_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [
        randomUUID(),
        userId,
        identity.provider,
        identity.issuer,
        identity.subject,
        identity.email,
      ],
    );
    return userId;
  });
}

export async function createDevUser(displayName: string): Promise<string> {
  const subject = `dev:${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return findOrCreateUserFromIdentity({
    provider: "dev",
    issuer: "local",
    subject,
    displayName,
  });
}

export async function touchPresence(userId: string) {
  await pool.query("update users set last_login_at = now() where id = $1", [userId]);
}
