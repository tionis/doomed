import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/session.js";
import { broadcastToGame } from "../realtime/hub.js";
import {
  advanceReveal,
  closeSubmissions,
  createGame,
  getRoundGameId,
  getSnapshot,
  joinGame,
  nextRoundOrFinish,
  openSubmissions,
  setReady,
  startGame,
  submitResponse,
} from "./repository.js";
import { startJudgingJob } from "./jobs.js";

const createGameSchema = z.object({
  displayName: z.string().trim().min(1).max(32),
  settings: z
    .object({
      roundCount: z.number().int().min(1).max(10),
      submissionSeconds: z.number().int().min(15).max(180),
      difficulty: z.enum(["easy", "normal", "ruthless"]),
      mode: z.string(),
      revealMode: z.enum(["one_by_one", "all_at_once"]),
    })
    .default({
      roundCount: 5,
      submissionSeconds: 60,
      difficulty: "normal",
      mode: "score",
      revealMode: "one_by_one",
    }),
});

const joinSchema = z.object({
  code: z.string().trim().min(4).max(8),
  displayName: z.string().trim().min(1).max(32),
});

const readySchema = z.object({ ready: z.boolean() });
const submitSchema = z.object({ text: z.string().trim().min(5).max(500) });

export async function registerGameRoutes(app: FastifyInstance) {
  app.get("/api/games/:gameId", async (request) => {
    const user = await requireUser(request);
    const { gameId } = request.params as { gameId: string };
    return { snapshot: await getSnapshot(gameId, user.id) };
  });

  app.post("/api/games", async (request) => {
    const user = await requireUser(request);
    const body = createGameSchema.parse(request.body);
    return createGame({ user, ...body });
  });

  app.post("/api/games/join", async (request) => {
    const user = await requireUser(request);
    const body = joinSchema.parse(request.body);
    const result = await joinGame({
      user,
      code: body.code,
      displayName: body.displayName,
    });
    await broadcastToGame(result.gameId, {
      type: result.rejoined ? "player_rejoined" : "player_joined",
    });
    return result;
  });

  app.post("/api/games/:gameId/ready", async (request) => {
    const user = await requireUser(request);
    const { gameId } = request.params as { gameId: string };
    const body = readySchema.parse(request.body);
    await setReady(gameId, user.id, body.ready);
    await broadcastToGame(gameId, { type: "player_ready_changed" });
    return { ok: true };
  });

  app.post("/api/games/:gameId/start", async (request) => {
    const user = await requireUser(request);
    const { gameId } = request.params as { gameId: string };
    const roundId = await startGame(gameId, user.id);
    await broadcastToGame(gameId, { type: "game_status_changed", roundId });
    return { roundId };
  });

  app.post("/api/games/:gameId/next-round", async (request) => {
    const user = await requireUser(request);
    const { gameId } = request.params as { gameId: string };
    const result = await nextRoundOrFinish(gameId, user.id);
    await broadcastToGame(gameId, {
      type: result.finished ? "game_finished" : "game_status_changed",
      roundId: result.roundId,
    });
    return result;
  });

  app.post("/api/rounds/:roundId/open-submissions", async (request) => {
    const user = await requireUser(request);
    const { roundId } = request.params as { roundId: string };
    const result = await openSubmissions(roundId, user.id);
    await broadcastToGame(result.gameId, {
      type: "submissions_opened",
      roundId,
    });
    return { ok: true };
  });

  app.post("/api/rounds/:roundId/submit", async (request) => {
    const user = await requireUser(request);
    const { roundId } = request.params as { roundId: string };
    const body = submitSchema.parse(request.body);
    const result = await submitResponse({ roundId, userId: user.id, text: body.text });
    await broadcastToGame(result.gameId, {
      type: "player_submitted",
      roundId,
      playerId: result.playerId,
    });
    return { ok: true };
  });

  app.post("/api/rounds/:roundId/close-submissions", async (request) => {
    const user = await requireUser(request);
    const { roundId } = request.params as { roundId: string };
    const result = await closeSubmissions(roundId, user.id);
    await broadcastToGame(result.gameId, {
      type: "submissions_closed",
      roundId,
    });
    startJudgingJob(roundId, result.gameId);
    return { ok: true };
  });

  app.post("/api/rounds/:roundId/advance-reveal", async (request) => {
    const user = await requireUser(request);
    const { roundId } = request.params as { roundId: string };
    const result = await advanceReveal(roundId, user.id);
    await broadcastToGame(result.gameId, {
      type: result.complete ? "scoreboard_updated" : "reveal_advanced",
      roundId,
    });
    return result;
  });

  app.get("/api/rounds/:roundId/game-id", async (request) => {
    await requireUser(request);
    const { roundId } = request.params as { roundId: string };
    return { gameId: await getRoundGameId(roundId) };
  });
}
