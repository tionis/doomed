import * as A from "@automerge/automerge";
import { getDoc } from "./store.js";

type Socket = { send: (data: string | Buffer) => void; subscribe: (t: string) => void };
const topics = new Map<string, Set<{ send: (d: string) => void }>>();

function roomTopic(code: string) {
  return `room:${code}`;
}

export function trackSocket(code: string, send: (d: string) => void) {
  const t = roomTopic(code);
  if (!topics.has(t)) topics.set(t, new Set());
  topics.get(t)!.add({ send });
  return () => topics.get(t)?.delete({ send } as never);
}

export function broadcastDoc(code: string) {
  const doc = getDoc(code);
  if (!doc) return;
  const payload = JSON.stringify({ type: "snapshot", doc });
  topics.get(roomTopic(code))?.forEach((s) => {
    try {
      s.send(payload);
    } catch {
      // ignore dead sockets
    }
  });
}

export function handleSyncMessage(code: string, raw: string) {
  try {
    const msg = JSON.parse(raw) as { type: string; changes?: number[][] };
    if (msg.type === "changes" && msg.changes) {
      void import("./store.js").then((m) => m.applyClientChanges(code, msg.changes!));
    }
  } catch {
    // ignore malformed frames
  }
}

export function snapshotMessage(code: string) {
  const doc = getDoc(code);
  if (!doc) return JSON.stringify({ type: "missing" });
  const changes = A.getAllChanges(doc).map((c) => [...c]);
  return JSON.stringify({ type: "init", changes, doc });
}

void trackSocket;
void broadcastDoc;
void handleSyncMessage;
