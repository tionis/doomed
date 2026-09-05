import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { verifyHostToken } from "./auth.js";

type Discovery = { token_endpoint: string; end_session_endpoint?: string };
const discoveryCache = new Map<string, Discovery>();

async function discover(issuer: string): Promise<Discovery> {
  const normalized = issuer.replace(/\/$/, "");
  const cached = discoveryCache.get(normalized);
  if (cached) return cached;
  const res = await fetch(`${normalized}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const json = (await res.json()) as Partial<Discovery>;
  if (!json.token_endpoint) throw new Error("OIDC discovery missing token_endpoint");
  const doc: Discovery = { token_endpoint: json.token_endpoint, ...(json.end_session_endpoint ? { end_session_endpoint: json.end_session_endpoint } : {}) };
  discoveryCache.set(normalized, doc);
  return doc;
}

export const oidc = new Hono();
oidc.use("/*", cors());

oidc.get("/config", (c) =>
  c.json({
    issuer: process.env.OIDC_ISSUER ?? null,
    clientId: process.env.OIDC_CLIENT_ID ?? null,
    required: Boolean(process.env.OIDC_ISSUER),
  }),
);

oidc.post("/callback", async (c) => {
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  if (!issuer || !clientId) return c.json({ error: "OIDC not configured" }, 500);
  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string;
    verifier?: string;
    redirectUri?: string;
  };
  if (!body.code || !body.verifier || !body.redirectUri) {
    return c.json({ error: "code, verifier, and redirectUri required" }, 400);
  }
  let tokens: { id_token?: string };
  try {
    const { token_endpoint } = await discover(issuer);
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code: body.code,
      redirect_uri: body.redirectUri,
      client_id: clientId,
      code_verifier: body.verifier,
    });
    const secret = process.env.OIDC_CLIENT_SECRET;
    if (secret) params.set("client_secret", secret);
    const res = await fetch(token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) return c.json({ error: "token exchange failed" }, 502);
    tokens = (await res.json()) as { id_token?: string };
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "token exchange failed" }, 502);
  }
  if (!tokens.id_token) return c.json({ error: "no id_token returned" }, 502);
  try {
    const jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, "")}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer, audience: clientId });
    if (!payload.sub) return c.json({ error: "invalid id_token" }, 502);
    return c.json({
      idToken: tokens.id_token,
      identity: {
        sub: String(payload.sub),
        ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      },
    });
  } catch {
    return c.json({ error: "id_token verification failed" }, 502);
  }
});

oidc.get("/logout-url", async (c) => {
  const issuer = process.env.OIDC_ISSUER;
  if (!issuer) return c.json({ logoutUrl: null });
  try {
    const { end_session_endpoint } = await discover(issuer);
    const identity = await verifyHostToken(c.req.header("authorization") ?? null);
    void identity;
    return c.json({ logoutUrl: end_session_endpoint ?? null });
  } catch {
    return c.json({ logoutUrl: null });
  }
});
