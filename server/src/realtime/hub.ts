import type { FastifyInstance } from "fastify";
import { getUserFromRequest } from "../auth/session.js";
import {
  getSnapshot,
  setPlayerConnected,
} from "../game/repository.js";

type Socket = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  readyState: number;
};

const rooms = new Map<string, Map<string, Socket>>();
const userGames = new Map<Socket, Set<string>>();

export async function broadcastToGame(
  gameId: string,
  event: Record<string, unknown>,
) {
  const members = rooms.get(gameId);
  if (!members) return;

  for (const [userId, socket] of members.entries()) {
    if (socket.readyState !== 1) continue;
    try {
      const snapshot = await getSnapshot(gameId, userId);
      socket.send(
        JSON.stringify({
          ...event,
          gameId,
          snapshot,
          serverTime: new Date().toISOString(),
        }),
      );
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Snapshot failed" }));
    }
  }
}

export async function registerRealtime(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, async (socket: Socket, request) => {
    const user = await getUserFromRequest(request);
    if (!user) {
      socket.close(1008, "Login required");
      return;
    }

    userGames.set(socket, new Set());

    socket.on("message", async (raw: unknown) => {
      try {
        const data = Buffer.isBuffer(raw) ? raw.toString() : String(raw);
        const message = JSON.parse(data) as {
          type?: string;
          gameId?: string;
        };

        if (message.type === "subscribe_game" && message.gameId) {
          const snapshot = await getSnapshot(message.gameId, user.id);
          let room = rooms.get(message.gameId);
          if (!room) {
            room = new Map();
            rooms.set(message.gameId, room);
          }
          room.set(user.id, socket);
          userGames.get(socket)?.add(message.gameId);
          await setPlayerConnected(user.id, message.gameId, true);
          socket.send(JSON.stringify({ type: "game_snapshot", snapshot }));
          await broadcastToGame(message.gameId, {
            type: "presence_changed",
            userId: user.id,
          });
          return;
        }

        if (message.type === "set_presence" && message.gameId) {
          await setPlayerConnected(user.id, message.gameId, true);
          await broadcastToGame(message.gameId, {
            type: "presence_changed",
            userId: user.id,
          });
          return;
        }

        socket.send(JSON.stringify({ type: "error", message: "Unsupported event" }));
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : "Invalid websocket message",
          }),
        );
      }
    });

    socket.on("close", async () => {
      const games = userGames.get(socket) ?? new Set<string>();
      for (const gameId of games) {
        rooms.get(gameId)?.delete(user.id);
        await setPlayerConnected(user.id, gameId, false);
        await broadcastToGame(gameId, {
          type: "presence_changed",
          userId: user.id,
        });
      }
      userGames.delete(socket);
    });
  });
}
