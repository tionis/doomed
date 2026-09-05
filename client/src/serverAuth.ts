import { useEffect, useState } from "react";

const KEY = "doomed.hostToken";

export type HostIdentity = { sub: string; email?: string };

export function getHostToken() {
  return localStorage.getItem(KEY) ?? "";
}

export function setHostToken(token: string) {
  if (token) localStorage.setItem(KEY, token);
  else localStorage.removeItem(KEY);
}

export function backendBase() {
  return (import.meta.env.VITE_BACKEND_URL as string | undefined ?? "http://localhost:3001").replace(/\/$/, "");
}

export function oidcConfigured() {
  return Boolean(import.meta.env.VITE_OIDC_ISSUER && import.meta.env.VITE_OIDC_CLIENT_ID);
}

export function authHeaders(): Record<string, string> {
  const token = getHostToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function decodeHostToken(): HostIdentity | null {
  const token = getHostToken();
  if (!token) return null;
  if (token === "dev-host-token") return { sub: "dev-host", email: "host@example.com" };
  try {
    const payload = JSON.parse(atob(token.split(".")[1] ?? ""));
    if (!payload?.sub) return null;
    return { sub: String(payload.sub), email: typeof payload.email === "string" ? payload.email : undefined };
  } catch {
    return null;
  }
}

export function useHostIdentity() {
  const [identity, setIdentity] = useState<HostIdentity | null>(() => decodeHostToken());
  useEffect(() => {
    const onStorage = () => setIdentity(decodeHostToken());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return {
    identity,
    refresh: () => setIdentity(decodeHostToken()),
    signOut: () => {
      setHostToken("");
      setIdentity(null);
    },
  };
}

export async function startOidcLogin() {
  const issuer = (import.meta.env.VITE_OIDC_ISSUER as string | undefined ?? "").replace(/\/$/, "");
  const clientId = import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined;
  if (!issuer || !clientId) throw new Error("OIDC not configured (VITE_OIDC_ISSUER / VITE_OIDC_CLIENT_ID).");
  const verifier = randomString(64);
  const state = randomString(18);
  sessionStorage.setItem("doomed.oidc", JSON.stringify({ verifier, state, returnUrl: window.location.href }));
  const challenge = await sha256url(verifier);
  const redirectUri = window.location.origin + window.location.pathname;
  const url = new URL(`${issuer}/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  window.location.assign(url.toString());
}

function randomString(len: number) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, len);
}

async function sha256url(input: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = new Uint8Array(hash);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
