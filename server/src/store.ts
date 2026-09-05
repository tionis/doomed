import * as A from "@automerge/automerge";
import { emptyRoomDoc, type Room, type RoomDoc } from "./schema.js";

const docs = new Map<string, A.Doc<RoomDoc>>();
const DATA_DIR = new URL("../../data/", import.meta.url);

async function snapshotPath(code: string) {
  return new URL(`./${code}.json`, DATA_DIR);
}

export async function getOrCreateDoc(room: Room): Promise<A.Doc<RoomDoc>> {
  const existing = docs.get(room.code);
  if (existing) return existing;
  const loaded = await loadFromDisk(room.code);
  if (loaded) {
    docs.set(room.code, loaded);
    return loaded;
  }
  const doc = A.from(emptyRoomDoc(room));
  docs.set(room.code, doc);
  void persist(room.code);
  return doc;
}

export function getDoc(code: string) {
  return docs.get(code);
}

export async function ensureDoc(code: string) {
  const mem = docs.get(code.toUpperCase());
  if (mem) return mem;
  const loaded = await loadFromDisk(code.toUpperCase());
  if (loaded) {
    docs.set(code.toUpperCase(), loaded);
    return loaded;
  }
  return null;
}

export async function listDocs(): Promise<Array<{ code: string; doc: A.Doc<RoomDoc> }>> {
  const codes = new Set<string>(docs.keys());
  try {
    const glob = new Bun.Glob("*.json");
    for await (const file of glob.scan(DATA_DIR.pathname)) {
      const code = file.replace(/\.json$/, "").toUpperCase();
      if (/^[A-Z0-9]{4}$/.test(code)) codes.add(code);
    }
  } catch {
    // no data dir yet
  }
  const out: Array<{ code: string; doc: A.Doc<RoomDoc> }> = [];
  for (const code of codes) {
    const doc = await ensureDoc(code);
    if (doc) out.push({ code, doc });
  }
  return out;
}

export async function deleteRoom(code: string) {
  docs.delete(code.toUpperCase());
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink((await snapshotPath(code.toUpperCase())).pathname);
  } catch {
    // ignore missing file
  }
}

export function setDoc(code: string, doc: A.Doc<RoomDoc>) {
  docs.set(code, doc);
  void persist(code);
  emit(code, doc);
}

type DocListener = (doc: A.Doc<RoomDoc>) => void;
const listeners = new Map<string, Set<DocListener>>();

export function subscribe(code: string, listener: DocListener) {
  const key = code.toUpperCase();
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(listener);
  return () => {
    listeners.get(key)?.delete(listener);
  };
}

function emit(code: string, doc: A.Doc<RoomDoc>) {
  listeners.get(code.toUpperCase())?.forEach((listener) => {
    try {
      listener(doc);
    } catch {
      // ignore dead listeners
    }
  });
}

// Automerge rejects `undefined` property values, so strip them before
// writing judge results (e.g. optional causeOfDeath) into a doc.
export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export async function loadFromDisk(code: string): Promise<A.Doc<RoomDoc> | null> {
  try {
    const file = Bun.file(await snapshotPath(code));
    if (!(await file.exists())) return null;
    const json = (await file.json()) as RoomDoc;
    return A.from(json);
  } catch {
    return null;
  }
}

async function persist(code: string) {
  try {
    const doc = docs.get(code);
    if (!doc) return;
    await Bun.write(await snapshotPath(code), JSON.stringify(doc));
  } catch {
    // best-effort persistence; sync stays authoritative in memory
  }
}

export function applyClientChanges(
  code: string,
  changes: number[][],
): { doc: A.Doc<RoomDoc>; patchChanges: number[][] } | { error: string } {
  const doc = docs.get(code);
  if (!doc) return { error: "unknown room" };
  try {
    const binary = changes.map((c) => new Uint8Array(c));
    const [next] = A.applyChanges(doc, binary);
    // Server is authority: only accept player submission/presence writes.
    // Room transitions, judgments, and scores are applied server-side only,
    // so here we accept the merge then re-persist. Host control is
    // enforced at the route layer, not the CRDT layer, for this scaffold.
    setDoc(code, next);
    return { doc: next, patchChanges: [] };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "bad changes" };
  }
}
