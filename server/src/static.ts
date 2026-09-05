import type { Context } from "hono";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

let resolvedDir: Promise<string | null> | undefined;

export function getClientDir(): Promise<string | null> {
  if (!resolvedDir) {
    resolvedDir = (async () => {
      for (const candidate of ["./dist/client", "../dist/client"]) {
        try {
          if (await Bun.file(`${candidate}/index.html`).exists()) return candidate;
        } catch {
          continue;
        }
      }
      return null;
    })();
  }
  return resolvedDir;
}

export async function serveClient(c: Context) {
  const dir = await getClientDir();
  if (!dir) return c.notFound();
  const pathname = new URL(c.req.url).pathname;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/scim/") ||
    pathname.startsWith("/sync/") ||
    pathname === "/healthz"
  ) {
    return c.notFound();
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const hasExtension = /\.[a-z0-9]+$/i.test(relative);
  const filePath = hasExtension ? `${dir}/${relative}` : `${dir}/index.html`;
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    if (hasExtension) return c.notFound();
    return c.body(await Bun.file(`${dir}/index.html`).text(), 200, {
      "content-type": MIME[".html"],
    });
  }
  const ext = (filePath.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
  const headers: Record<string, string> = {};
  if (MIME[ext]) headers["content-type"] = MIME[ext];
  if (ext === ".html" || !hasExtension) headers["cache-control"] = "no-cache";
  else headers["cache-control"] = "public, max-age=31536000, immutable";
  return c.body((await file.arrayBuffer()) as ArrayBuffer, 200, headers);
}
