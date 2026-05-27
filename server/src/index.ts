import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import fastify from "fastify";
import { getConfig } from "./config.js";
import { pool } from "./db/pool.js";
import { registerAuthRoutes } from "./auth/oidc.js";
import { registerGameRoutes } from "./game/routes.js";
import { startRecoveryLoop } from "./game/jobs.js";
import { registerRealtime } from "./realtime/hub.js";
import { registerStaticClient } from "./static.js";
import { HttpError } from "./util/http.js";

const config = getConfig();
const app = fastify({ logger: true });

await app.register(cookie);
await app.register(rateLimit, {
  max: 120,
  timeWindow: "1 minute",
});
await app.register(websocket);

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  if (typeof error === "object" && error && "issues" in error) {
    return reply.code(400).send({ error: "Invalid request", details: error.issues });
  }
  return reply.code(500).send({ error: "Internal server error" });
});

app.get("/health", async () => ({ ok: true }));

await registerAuthRoutes(app);
await registerGameRoutes(app);
await registerRealtime(app);
await registerStaticClient(app);

startRecoveryLoop();

const close = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());

await app.listen({ port: config.port, host: "0.0.0.0" });
