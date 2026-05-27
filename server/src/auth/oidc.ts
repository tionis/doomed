import type { FastifyInstance } from "fastify";
import { decodeJwt, createRemoteJWKSet, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { URLSearchParams } from "node:url";
import { getConfig } from "../config.js";
import { createSession, setSessionCookie, clearSessionCookie, revokeSession } from "./session.js";
import { createDevUser, findOrCreateUserFromIdentity } from "./users.js";
import { getUserFromRequest } from "./session.js";

type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
};

function randomState() {
  return randomBytes(24).toString("base64url");
}

async function discover(issuer: string): Promise<Discovery> {
  const response = await fetch(
    `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
  );
  if (!response.ok) throw new Error("OIDC discovery failed");
  return (await response.json()) as Discovery;
}

function isOidcConfigured() {
  const config = getConfig();
  return Boolean(
    config.oidcIssuer &&
      config.oidcClientId &&
      config.oidcClientSecret &&
      config.oidcRedirectUri,
  );
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/config", async () => {
    const config = getConfig();
    return {
      provider: config.oidcProvider,
      oidcConfigured: isOidcConfigured(),
      devLoginEnabled: config.nodeEnv !== "production" && !isOidcConfigured(),
    };
  });

  app.get("/auth/login/:provider", async (request, reply) => {
    const config = getConfig();
    const { provider } = request.params as { provider: string };

    if (config.nodeEnv !== "production" && !isOidcConfigured()) {
      const displayName =
        typeof request.query === "object" &&
        request.query &&
        "name" in request.query &&
        typeof request.query.name === "string"
          ? request.query.name
          : `Player ${Math.floor(Math.random() * 900 + 100)}`;
      const userId = await createDevUser(displayName);
      const sessionId = await createSession(userId);
      setSessionCookie(reply, sessionId);
      return reply.redirect(config.appOrigin);
    }

    if (provider !== config.oidcProvider) {
      return reply.code(404).send({ error: "Unknown OIDC provider" });
    }

    if (!isOidcConfigured()) {
      return reply.code(500).send({ error: "OIDC is not configured" });
    }

    const discovery = await discover(config.oidcIssuer!);
    const state = randomState();
    const nonce = randomState();
    reply.setCookie("jba_oidc_state", state, {
      path: "/",
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 600,
    });
    reply.setCookie("jba_oidc_nonce", nonce, {
      path: "/",
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 600,
    });

    const authorizationUrl = new URL(discovery.authorization_endpoint);
    authorizationUrl.search = new URLSearchParams({
      client_id: config.oidcClientId!,
      redirect_uri: config.oidcRedirectUri!,
      response_type: "code",
      scope: "openid profile email",
      state,
      nonce,
    }).toString();

    return reply.redirect(authorizationUrl.toString());
  });

  app.get("/auth/callback/:provider", async (request, reply) => {
    const config = getConfig();
    const { provider } = request.params as { provider: string };
    if (!isOidcConfigured()) {
      return reply.code(500).send({ error: "OIDC is not configured" });
    }
    if (provider !== config.oidcProvider) {
      return reply.code(404).send({ error: "Unknown OIDC provider" });
    }

    const query = request.query as { code?: string; state?: string };
    if (!query.code || !query.state || query.state !== request.cookies.jba_oidc_state) {
      return reply.code(400).send({ error: "Invalid OIDC callback" });
    }

    const discovery = await discover(config.oidcIssuer!);
    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization:
          "Basic " +
          Buffer.from(
            `${config.oidcClientId}:${config.oidcClientSecret}`,
          ).toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: config.oidcRedirectUri!,
      }),
    });

    if (!tokenResponse.ok) {
      return reply.code(400).send({ error: "OIDC token exchange failed" });
    }

    const tokenBody = (await tokenResponse.json()) as { id_token?: string };
    if (!tokenBody.id_token) {
      return reply.code(400).send({ error: "OIDC id_token missing" });
    }

    const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    const { payload } = await jwtVerify(tokenBody.id_token, jwks, {
      issuer: discovery.issuer,
      audience: config.oidcClientId,
    });
    const decoded = decodeJwt(tokenBody.id_token);
    if (decoded.nonce !== request.cookies.jba_oidc_nonce) {
      return reply.code(400).send({ error: "Invalid OIDC nonce" });
    }

    const userId = await findOrCreateUserFromIdentity({
      provider: config.oidcProvider,
      issuer: String(payload.iss),
      subject: String(payload.sub),
      displayName:
        (payload.name as string | undefined) ??
        (payload.preferred_username as string | undefined) ??
        (payload.email as string | undefined) ??
        "Player",
      email: payload.email as string | undefined,
      avatarUrl: payload.picture as string | undefined,
    });

    const sessionId = await createSession(userId);
    setSessionCookie(reply, sessionId);
    reply.clearCookie("jba_oidc_state", { path: "/" });
    reply.clearCookie("jba_oidc_nonce", { path: "/" });
    return reply.redirect(config.appOrigin);
  });

  app.post("/auth/logout", async (request, reply) => {
    await revokeSession(request);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/me", async (request) => {
    const user = await getUserFromRequest(request);
    return {
      user: user
        ? {
            id: user.id,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          }
        : null,
    };
  });
}
