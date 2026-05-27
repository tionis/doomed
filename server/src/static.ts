import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function registerStaticClient(app: FastifyInstance) {
  const clientRoot = resolve(process.cwd(), "dist/client");
  const rootPrefix = clientRoot.endsWith(sep) ? clientRoot : `${clientRoot}${sep}`;

  app.get("/*", async (request, reply) => {
    const url = new URL(request.url, "http://localhost");
    if (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/auth/") ||
      url.pathname === "/health" ||
      url.pathname === "/ws"
    ) {
      return reply.code(404).send({ error: "Not found" });
    }

    const pathname =
      url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const requestedPath = resolve(clientRoot, `.${pathname}`);
    const filePath = requestedPath.startsWith(rootPrefix)
      ? requestedPath
      : resolve(clientRoot, "index.html");

    const existingPath = await existingFilePath(filePath, clientRoot);
    if (!existingPath) return reply.code(404).send({ error: "Not found" });

    reply.header(
      "content-type",
      contentTypes[extname(existingPath)] ?? "application/octet-stream",
    );
    return reply.send(createReadStream(existingPath));
  });
}

async function existingFilePath(filePath: string, clientRoot: string) {
  try {
    const file = await stat(filePath);
    if (file.isFile()) return filePath;
  } catch {
    if (extname(filePath)) return null;
  }

  const fallback = resolve(clientRoot, "index.html");
  try {
    const file = await stat(fallback);
    return file.isFile() ? fallback : null;
  } catch {
    return null;
  }
}
