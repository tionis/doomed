import { app } from "./app.js";
import { applyClientChanges, getDoc, subscribe } from "./store.js";
import * as A from "@automerge/automerge";

const port = Number(process.env.PORT ?? 3001);

type SocketState = { heads: A.Heads; unsubscribe: () => void };
const socketState = new WeakMap<object, SocketState>();

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
      const code = ws.data.code;
      if (!code) {
        ws.close();
        return;
      }
      const doc = getDoc(code);
      if (!doc) {
        ws.close();
        return;
      }
      ws.send(JSON.stringify({ type: "init", changes: A.getAllChanges(doc).map((c) => [...c]) }));
      const state: SocketState = {
        heads: A.getHeads(doc),
        unsubscribe: subscribe(code, (next) => {
          const diff = A.getChangesSince(next, state.heads).map((c) => [...c]);
          state.heads = A.getHeads(next);
          if (diff.length === 0) return;
          try {
            ws.send(JSON.stringify({ type: "changes", changes: diff }));
          } catch {
            // ignore dead sockets
          }
        }),
      };
      socketState.set(ws, state);
    },
    message(ws, message) {
      const code = ws.data.code;
      if (!code) return;
      try {
        const msg = JSON.parse(String(message)) as { type?: string; changes?: number[][] };
        if (msg.type === "changes" && msg.changes) {
          const res = applyClientChanges(code, msg.changes);
          if ("doc" in res) {
            const state = socketState.get(ws);
            if (state) state.heads = A.getHeads(res.doc);
            ws.send(JSON.stringify({ type: "ack" }));
          }
        } else if (msg.type === "pull") {
          const doc = getDoc(code);
          if (doc) {
            const state = socketState.get(ws);
            if (state) state.heads = A.getHeads(doc);
            ws.send(JSON.stringify({ type: "init", changes: A.getAllChanges(doc).map((c) => [...c]) }));
          }
        }
      } catch {
        // ignore malformed frames
      }
    },
    close(ws) {
      socketState.get(ws)?.unsubscribe();
      socketState.delete(ws);
    },
  },
});

void server;
console.log(`backend listening on :${port}`);
