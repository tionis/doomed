import * as A from "@automerge/automerge";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { verifyHostToken, type HostIdentity } from "./auth.js";
import { judgeOne } from "./llm.js";
import { bannedWordsForRound, pickScenario } from "./scenario.js";
import { ensureDoc, getOrCreateDoc, setDoc, stripUndefined } from "./store.js";
import type { Player, Room } from "./schema.js";

const oidcRequired = () => Boolean(process.env.OIDC_ISSUER);

function code4() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i += 1) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

async function hostIdentity(c: { req: { header: (n: string) => string | undefined } }): Promise<HostIdentity | null> {
  return verifyHostToken(c.req.header("authorization") ?? null);
}

function isMember(doc: { players: Record<string, Player> }, clientId: string | undefined) {
  if (!clientId) return false;
  return Object.values(doc.players).some((p) => p.clientId === clientId);
}

const CONTROL_FIELDS: Array<keyof Room> = [
  "status", "roundIndex", "revealIndex", "activePlayerId", "scenarioTitle",
  "scenarioText", "immediateThreat", "timePressure", "category",
  "bannedWords", "deadlineAt", "finishedAt", "archivedAt",
  "hiddenFromHostHistory", "cleanupReason", "updatedAt",
];

export const rooms = new Hono();
rooms.use("/*", cors());

rooms.post("/", async (c) => {
  const identity = await hostIdentity(c);
  if (oidcRequired() && !identity) return c.json({ error: "host OIDC login required" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as Partial<Room & { hostName: string }>;
  const now = Date.now();
  const code = code4();
  const room: Room = {
    id: crypto.randomUUID(),
    code,
    hostClientId: String(body.hostClientId ?? crypto.randomUUID()),
    ...(identity ? { hostUserId: identity.sub, ...(identity.email ? { hostEmail: identity.email } : {}) } : {}),
    hostName: String(body.hostName ?? "Host").slice(0, 40),
    status: "lobby",
    roundIndex: 0,
    roundCount: Math.max(1, Math.min(10, Number(body.roundCount ?? 5))),
    submissionSeconds: Math.max(20, Math.min(240, Number(body.submissionSeconds ?? 60))),
    difficulty: body.difficulty === "easy" || body.difficulty === "ruthless" ? body.difficulty : "normal",
    revealIndex: 0,
    createdAt: now,
    updatedAt: now,
  };
  await getOrCreateDoc(room);
  return c.json({ room });
});

rooms.get("/:code", async (c) => {
  const doc = await ensureDoc(c.req.param("code"));
  if (!doc) return c.json({ error: "not found" }, 404);
  return c.json(doc);
});

rooms.post("/:code/join", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  if (doc.room.archivedAt) return c.json({ error: "archived" }, 410);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; clientId?: string; isHost?: boolean };
  const clientId = String(body.clientId ?? crypto.randomUUID());
  const existing = Object.values(doc.players).find((p) => p.clientId === clientId);
  if (existing) {
    const next = A.change(doc, (d) => {
      d.players[existing.id].connected = true;
      d.players[existing.id].lastSeenAt = Date.now();
      if (body.name) d.players[existing.id].name = String(body.name).slice(0, 40);
    });
    setDoc(code, next);
    return c.json({ player: next.players[existing.id], wsUrl: `/sync/${code}` });
  }
  const seatIndex = Object.keys(doc.players).length;
  const player: Player = {
    id: crypto.randomUUID(),
    roomId: doc.room.id,
    clientId,
    name: String(body.name ?? `Guest ${seatIndex + 1}`).slice(0, 40),
    seatIndex,
    isHost: seatIndex === 0 || body.isHost === true,
    connected: true,
    ready: seatIndex === 0,
    score: 0,
    survivalCount: 0,
    deathCount: 0,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  const next = A.change(doc, (d) => {
    d.players[player.id] = player;
  });
  setDoc(code, next);
  return c.json({ player, wsUrl: `/sync/${code}` });
});

rooms.post("/:code/ready", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json()) as { playerId: string; ready: boolean };
  if (!doc.players[body.playerId]) return c.json({ error: "unknown player" }, 404);
  const next = A.change(doc, (d) => {
    d.players[body.playerId].ready = Boolean(body.ready);
    d.players[body.playerId].lastSeenAt = Date.now();
  });
  setDoc(code, next);
  return c.json(next.players[body.playerId]);
});

rooms.post("/:code/heartbeat", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json()) as { playerId: string };
  if (!doc.players[body.playerId]) return c.json({ error: "unknown player" }, 404);
  const next = A.change(doc, (d) => {
    d.players[body.playerId].connected = true;
    d.players[body.playerId].lastSeenAt = Date.now();
  });
  setDoc(code, next);
  return c.json({ ok: true });
});

rooms.post("/:code/control", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  const identity = await hostIdentity(c);
  const body = (await c.req.json()) as Partial<Room> & { clientId?: string };
  if (!identity && !isMember(doc, body.clientId)) return c.json({ error: "join the room first" }, 403);
  const next = A.change(doc, (d) => {
    for (const k of CONTROL_FIELDS) {
      if (k in body) (d.room as Record<string, unknown>)[k] = body[k] as unknown;
    }
    d.room.updatedAt = Date.now();
  });
  setDoc(code, next);
  return c.json(next.room);
});

rooms.post("/:code/submit", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json()) as { playerId: string; clientId: string; text: string };
  if (doc.room.status !== "submitting") return c.json({ error: "not submitting" }, 409);
  if (!doc.players[body.playerId]) return c.json({ error: "unknown player" }, 404);
  const text = String(body.text ?? "").trim().slice(0, 500);
  if (text.length < 5) return c.json({ error: "too short" }, 400);
  const id = `${doc.room.roundIndex}-${body.playerId}`;
  const next = A.change(doc, (d) => {
    d.submissions[id] = {
      id,
      roomId: d.room.id,
      roundIndex: d.room.roundIndex,
      playerId: body.playerId,
      clientId: body.clientId,
      text,
      submittedAt: Date.now(),
      locked: false,
    };
  });
  setDoc(code, next);
  return c.json(next.submissions[id]);
});

rooms.post("/:code/close", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  const identity = await hostIdentity(c);
  const body = (await c.req.json().catch(() => ({}))) as { clientId?: string };
  if (!identity && !isMember(doc, body.clientId)) return c.json({ error: "join the room first" }, 403);
  if (doc.room.status !== "submitting") return c.json({ error: "not submitting" }, 409);
  const now = Date.now();
  const submitted = new Set(Object.values(doc.submissions).filter((s) => s.roundIndex === doc.room.roundIndex).map((s) => s.playerId));
  const next = A.change(doc, (d) => {
    for (const s of Object.values(d.submissions)) {
      if (s.roundIndex === d.room.roundIndex) s.locked = true;
    }
    for (const player of Object.values(d.players)) {
      if (submitted.has(player.id)) continue;
      const id = `${d.room.roundIndex}-${player.id}`;
      d.submissions[id] = {
        id,
        roomId: d.room.id,
        roundIndex: d.room.roundIndex,
        playerId: player.id,
        clientId: "system",
        text: "The player froze in panic and did absolutely nothing.",
        submittedAt: now,
        locked: true,
      };
    }
    d.room.status = "judging";
    d.room.deadlineAt = 0;
    d.room.updatedAt = now;
  });
  setDoc(code, next);
  return c.json(next.room);
});

rooms.post("/:code/judge", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  const identity = await hostIdentity(c);
  const body = (await c.req.json().catch(() => ({}))) as { clientId?: string };
  if (!identity && !isMember(doc, body.clientId)) return c.json({ error: "join the room first" }, 403);
  if (doc.room.status !== "judging") return c.json({ error: "not judging" }, 409);
  // Fill panic submissions for players who never submitted.
  let next = doc;
  const submitted = new Set(Object.values(next.submissions).filter((s) => s.roundIndex === next.room.roundIndex).map((s) => s.playerId));
  const missing = Object.values(next.players).filter((p) => !submitted.has(p.id));
  if (missing.length > 0) {
    const now = Date.now();
    next = A.change(next, (d) => {
      for (const player of missing) {
        const id = `${d.room.roundIndex}-${player.id}`;
        d.submissions[id] = {
          id,
          roomId: d.room.id,
          roundIndex: d.room.roundIndex,
          playerId: player.id,
          clientId: "system",
          text: "The player froze in panic and did absolutely nothing.",
          submittedAt: now,
          locked: true,
        };
      }
    });
  }
  const pending = Object.values(next.submissions).filter(
    (s) => s.roundIndex === next.room.roundIndex && !next.judgments[`${s.roundIndex}-${s.playerId}`],
  );
  const results: string[] = [];
  for (const s of pending) {
    const player = next.players[s.playerId];
    const judged = await judgeOne({
      scenario: {
        title: next.room.scenarioTitle ?? "Unknown calamity",
        scenarioText: next.room.scenarioText ?? "",
        immediateThreat: next.room.immediateThreat ?? "",
        timePressure: next.room.timePressure ?? "",
      },
      submission: s,
      playerName: player?.name ?? "player",
      difficulty: next.room.difficulty,
    });
    const jid = `${s.roundIndex}-${s.playerId}`;
    next = A.change(next, (d) => {
      d.judgments[jid] = stripUndefined({ ...judged, id: jid, createdAt: Date.now() });
      const p = d.players[s.playerId];
      if (p) {
        p.score += judged.pointsAwarded;
        if (judged.survived) p.survivalCount += 1;
        else p.deathCount += 1;
      }
    });
    results.push(jid);
  }
  next = A.change(next, (d) => {
    d.room.status = "revealing";
    d.room.revealIndex = 1;
    d.room.updatedAt = Date.now();
  });
  setDoc(code, next);
  return c.json({ judged: results });
});

rooms.post("/:code/reveal", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  const identity = await hostIdentity(c);
  const body = (await c.req.json().catch(() => ({}))) as { clientId?: string };
  if (!identity && !isMember(doc, body.clientId)) return c.json({ error: "join the room first" }, 403);
  if (doc.room.status !== "revealing") return c.json({ error: "not revealing" }, 409);
  const count = Object.keys(doc.players).length;
  const next = A.change(doc, (d) => {
    if (d.room.revealIndex < count) d.room.revealIndex += 1;
    else {
      d.room.status = "scoreboard";
      d.room.updatedAt = Date.now();
    }
  });
  setDoc(code, next);
  return c.json(next.room);
});

rooms.post("/:code/next", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  const identity = await hostIdentity(c);
  const body = (await c.req.json().catch(() => ({}))) as { clientId?: string };
  if (!identity && !isMember(doc, body.clientId)) return c.json({ error: "join the room first" }, 403);
  const now = Date.now();
  if (doc.room.roundIndex >= doc.room.roundCount) {
    const next = A.change(doc, (d) => {
      d.room.status = "finished";
      d.room.finishedAt = d.room.finishedAt ?? now;
      d.room.updatedAt = now;
    });
    setDoc(code, next);
    return c.json(next.room);
  }
  const nextIndex = doc.room.roundIndex + 1;
  const scenario = pickScenario(nextIndex);
  const players = Object.values(doc.players).sort((a, b) => a.seatIndex - b.seatIndex);
  const nextActive = players.length > 0 ? players[(nextIndex - 1) % players.length] : undefined;
  const next = A.change(doc, (d) => {
    d.room.status = "round_intro";
    d.room.roundIndex = nextIndex;
    d.room.revealIndex = 0;
    d.room.deadlineAt = 0;
    d.room.activePlayerId = nextActive?.id;
    d.room.scenarioTitle = scenario.title;
    d.room.scenarioText = scenario.scenarioText;
    d.room.immediateThreat = scenario.immediateThreat;
    d.room.timePressure = scenario.timePressure;
    d.room.category = scenario.category;
    d.room.bannedWords = bannedWordsForRound();
    d.room.updatedAt = now;
  });
  setDoc(code, next);
  return c.json(next.room);
});

rooms.post("/:code/start", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  const identity = await hostIdentity(c);
  const body = (await c.req.json().catch(() => ({}))) as { clientId?: string };
  if (!identity && !isMember(doc, body.clientId)) return c.json({ error: "join the room first" }, 403);
  if (doc.room.status !== "lobby") return c.json({ error: "already started" }, 409);
  const scenario = pickScenario(1);
  const players = Object.values(doc.players).sort((a, b) => a.seatIndex - b.seatIndex);
  const next = A.change(doc, (d) => {
    d.room.status = "round_intro";
    d.room.roundIndex = 1;
    d.room.revealIndex = 0;
    d.room.activePlayerId = players[0]?.id;
    d.room.scenarioTitle = scenario.title;
    d.room.scenarioText = scenario.scenarioText;
    d.room.immediateThreat = scenario.immediateThreat;
    d.room.timePressure = scenario.timePressure;
    d.room.category = scenario.category;
    d.room.bannedWords = bannedWordsForRound();
    d.room.updatedAt = Date.now();
  });
  setDoc(code, next);
  return c.json(next.room);
});

rooms.post("/:code/hide", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const doc = await ensureDoc(code);
  if (!doc) return c.json({ error: "not found" }, 404);
  const identity = await hostIdentity(c);
  const body = (await c.req.json().catch(() => ({}))) as { clientId?: string };
  if (!identity && !isMember(doc, body.clientId)) return c.json({ error: "join the room first" }, 403);
  const next = A.change(doc, (d) => {
    d.room.hiddenFromHostHistory = true;
    d.room.updatedAt = Date.now();
  });
  setDoc(code, next);
  return c.json(next.room);
});
