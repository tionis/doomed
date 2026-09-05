import { app } from "./app.js";
import { applyClientChanges, getDoc } from "./store.js";
import * as A from "@automerge/automerge";

const port = Number(process.env.PORT ?? 3001);
const peers = new Map<string, Set<import("bun").ServerWebSocket<unknown>>>();

function peersFor(code: string) {
  if (!peers.has(code)) peers.set(code, new Set());
  return peers.get(code)!;
}

const server = Bun.serve<{ code: string }>({
  port,
  fetch(req, srv) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/sync\/([A-Z0-9]{4})$/i);
    if (m && srv.upgrade(req, { data: { code: m[1].toUpperCase() } })) return undefined;
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      const code = (ws.data as unknown as { code?: string }).code;
      if (!code) {
        ws.close();
        return;
      }
      peersFor(code).add(ws);
      const doc = getDoc(code);
      if (doc) ws.send(JSON.stringify({ type: "init", doc }));
    },
    message(ws, message) {
      const code = (ws.data as unknown as { code?: string }).code;
      if (!code) return;
      try {
        const msg = JSON.parse(String(message)) as { type?: string; changes?: number[][] };
        if (msg.type === "changes" && msg.changes) {
          const res = applyClientChanges(code, msg.changes);
          if ("doc" in res) {
            const payload = JSON.stringify({ type: "snapshot", doc: res.doc });
            for (const peer of peersFor(code)) {
              if (peer !== ws) {
                try {
                  peer.send(payload);
                } catch {
                  // ignore
                }
              }
            }
            ws.send(JSON.stringify({ type: "ack" }));
          }
        } else if (msg.type === "pull") {
          const doc = getDoc(code);
          if (doc) ws.send(JSON.stringify({ type: "init", doc, changes: A.getAllChanges(doc).map((c) => [...c]) }));
        }
      } catch {
        // ignore malformed frames
      }
    },
    close(ws) {
      const code = (ws.data as unknown as { code?: string }).code;
      if (code) peersFor(code).delete(ws);
    },
  },
});

void server;
console.log(`backend listening on :${port}`);
