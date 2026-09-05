import { useEffect, useRef, useState } from "react";
import * as A from "@automerge/automerge";
import { authHeaders, backendBase } from "./serverAuth";
import type { Judgment, Player, Room, Submission } from "./types";

export type RoomSnapshot = {
  room: Room;
  players: Record<string, Player>;
  submissions: Record<string, Submission>;
  judgments: Record<string, Judgment>;
};

type SyncMessage =
  | { type: "init"; changes: number[][] }
  | { type: "changes"; changes: number[][] }
  | { type: "snapshot"; doc: RoomSnapshot }
  | { type: "ack" }
  | { type: "missing" };

function toSnapshot(doc: A.Doc<RoomSnapshot>): RoomSnapshot {
  return JSON.parse(JSON.stringify(doc)) as RoomSnapshot;
}

export type AdminRoomRow = {
  room: Room;
  playerCount: number;
  submissionCount: number;
  judgmentCount: number;
};

export type AdminIdentity = {
  id: string;
  email: string;
  note?: string;
  createdAt: number;
  createdBy?: string;
};

export function getLocalClientId() {
  let id = localStorage.getItem("jba.clientId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("jba.clientId", id);
  }
  return id;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${backendBase()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${text.slice(0, 120)}`);
  }
  return res.json() as Promise<T>;
}

function withClient<T extends object>(body: T): T & { clientId: string } {
  return { ...body, clientId: getLocalClientId() };
}

export function createRoom(input: { hostName: string; roundCount: number; submissionSeconds: number; difficulty: Room["difficulty"] }) {
  return req<{ room: Room }>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ ...input, hostClientId: getLocalClientId() }),
  });
}

export function joinRoom(code: string, name: string) {
  return req<{ player: Player; wsUrl: string }>(`/api/rooms/${code}/join`, {
    method: "POST",
    body: JSON.stringify({ name, clientId: getLocalClientId() }),
  });
}

export function fetchSnapshot(code: string) {
  return req<RoomSnapshot>(`/sync/${code}`);
}

export function setReady(code: string, playerId: string, ready: boolean) {
  return req<Player>(`/api/rooms/${code}/ready`, { method: "POST", body: JSON.stringify({ playerId, ready }) });
}

export function heartbeat(code: string, playerId: string) {
  return req<{ ok: boolean }>(`/api/rooms/${code}/heartbeat`, { method: "POST", body: JSON.stringify({ playerId }) });
}

export function controlRoom(code: string, patch: Partial<Room>) {
  return req<Room>(`/api/rooms/${code}/control`, { method: "POST", body: JSON.stringify(withClient(patch)) });
}

export function submitText(code: string, input: { playerId: string; text: string }) {
  return req<Submission>(`/api/rooms/${code}/submit`, {
    method: "POST",
    body: JSON.stringify({ ...input, clientId: getLocalClientId() }),
  });
}

export function closeSubmissions(code: string) {
  return req<Room>(`/api/rooms/${code}/close`, { method: "POST", body: JSON.stringify(withClient({})) });
}

export function requestJudge(code: string) {
  return req<{ judged: string[] }>(`/api/rooms/${code}/judge`, {
    method: "POST",
    body: JSON.stringify(withClient({})),
  });
}

export function advanceReveal(code: string) {
  return req<Room>(`/api/rooms/${code}/reveal`, { method: "POST", body: JSON.stringify(withClient({})) });
}

export function nextRound(code: string) {
  return req<Room>(`/api/rooms/${code}/next`, { method: "POST", body: JSON.stringify(withClient({})) });
}

export function startGame(code: string) {
  return req<Room>(`/api/rooms/${code}/start`, { method: "POST", body: JSON.stringify(withClient({})) });
}

export function hideFromHistory(code: string) {
  return req<Room>(`/api/rooms/${code}/hide`, { method: "POST", body: JSON.stringify(withClient({})) });
}

export function fetchHostRooms() {
  return req<Room[]>("/api/host/rooms");
}

export function fetchAdminRooms() {
  return req<AdminRoomRow[]>("/api/admin/rooms");
}

export function fetchAdminRoom(code: string) {
  return req<RoomSnapshot>(`/api/admin/rooms/${code}`);
}

export function adminUpdateRoom(code: string, patch: Partial<Room>) {
  return req<Room>(`/api/admin/rooms/${code}`, { method: "POST", body: JSON.stringify(patch) });
}

export function adminCleanup(mode: "stale" | "oldFinished" | "unlinked") {
  return req<{ archived: number }>("/api/admin/rooms/cleanup/run", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export function adminDeleteRoom(code: string) {
  return req<{ deleted: string }>(`/api/admin/rooms/${code}`, { method: "DELETE" });
}

export function fetchAdmins() {
  return req<AdminIdentity[]>("/api/admin/admins");
}

export function addAdminIdentity(email: string, note: string) {
  return req<AdminIdentity>("/api/admin/admins", { method: "POST", body: JSON.stringify({ email, note }) });
}

export function removeAdminIdentity(id: string) {
  return req<{ deleted: string }>(`/api/admin/admins/${id}`, { method: "DELETE" });
}

export function wsUrlFor(code: string) {
  const base = backendBase().replace(/^http/, "ws");
  return `${base}/sync/${code}`;
}

export function useRoomSnapshot(code: string | null) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const docRef = useRef<A.Doc<RoomSnapshot> | null>(null);

  useEffect(() => {
    if (!code || !backendBase()) return;
    let alive = true;
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const applyChanges = (changes: number[][]) => {
      try {
        const binary = changes.map((c) => new Uint8Array(c));
        const base = docRef.current ?? A.init<RoomSnapshot>();
        const [next] = A.applyChanges(base, binary);
        docRef.current = next;
        if (alive) {
          setSnapshot(toSnapshot(next));
          setNotFound(false);
        }
      } catch {
        docRef.current = null;
      }
    };

    setSnapshot(null);
    setNotFound(false);
    docRef.current = null;
    fetchSnapshot(code)
      .then((s) => {
        if (alive) {
          docRef.current = A.from<RoomSnapshot>(s);
          setSnapshot(s);
        }
      })
      .catch(() => {
        if (alive) setNotFound(true);
      });

    try {
      ws = new WebSocket(wsUrlFor(code));
      ws.onopen = () => alive && setConnected(true);
      ws.onclose = () => alive && setConnected(false);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as SyncMessage;
          if ((msg.type === "init" || msg.type === "changes") && alive) {
            applyChanges(msg.changes);
          } else if (msg.type === "snapshot" && "doc" in msg && msg.doc && alive) {
            docRef.current = A.from<RoomSnapshot>(msg.doc);
            setSnapshot(msg.doc);
            setNotFound(false);
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // WS unavailable; polling covers updates
    }

    poll = setInterval(() => {
      fetchSnapshot(code)
        .then((s) => {
          if (!alive) return;
          docRef.current = A.from<RoomSnapshot>(s);
          setSnapshot(s);
        })
        .catch(() => undefined);
    }, 5000);

    return () => {
      alive = false;
      try {
        ws?.close();
      } catch {
        // ignore
      }
      if (poll) clearInterval(poll);
    };
  }, [code]);

  return { snapshot, connected, notFound };
}
