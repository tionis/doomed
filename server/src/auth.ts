import { createRemoteJWKSet, jwtVerify } from "jose";

export type HostIdentity = { sub: string; email?: string };

const issuer = process.env.OIDC_ISSUER;
const audience = process.env.OIDC_CLIENT_ID;
const devBypass = process.env.OIDC_DEV_BYPASS === "1";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
if (issuer) {
  jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, "")}/.well-known/jwks.json`));
}

export async function verifyHostToken(authHeader: string | null): Promise<HostIdentity | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (!token) return null;
  if (devBypass && token === "dev-host-token") {
    return { sub: "dev-host", email: "host@example.com" };
  }
  if (!issuer || !jwks) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      ...(audience ? { audience } : {}),
    });
    return { sub: String(payload.sub ?? ""), email: typeof payload.email === "string" ? payload.email : undefined };
  } catch {
    return null;
  }
}

export function requireHost(identity: HostIdentity | null) {
  return identity && identity.sub.length > 0;
}
