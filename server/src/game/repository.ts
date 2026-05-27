import { randomInt, randomUUID } from "node:crypto";
import type { DbClient } from "../db/pool.js";
import { pool, transaction } from "../db/pool.js";
import { camel, camelRows } from "../util/case.js";
import { assert } from "../util/http.js";
import { assertGameTransition, assertRoundTransition } from "./stateMachine.js";
import { pickScenario } from "./scenarios.js";
import type {
  Difficulty,
  Game,
  GameStatus,
  Judgment,
  Player,
  Round,
  RoundStatus,
  Submission,
  User,
} from "./types.js";

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const panicSubmission = "The player froze in panic and did absolutely nothing.";

export type GameSnapshot = {
  game: Game;
  players: Player[];
  currentRound: Round | null;
  submittedPlayerIds: string[];
  visibleSubmissions: Submission[];
  visibleJudgments: Judgment[];
  serverTime: string;
};

export async function userRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
) {
  await transaction(async (client) => {
    const resetAt = new Date(Date.now() + windowSeconds * 1000);
    const result = await client.query(
      `insert into rate_limits(key, count, reset_at)
       values ($1, 1, $2)
       on conflict (key) do update
          set count = case
                when rate_limits.reset_at < now() then 1
                else rate_limits.count + 1
              end,
              reset_at = case
                when rate_limits.reset_at < now() then excluded.reset_at
                else rate_limits.reset_at
              end
       returning count, reset_at`,
      [key, resetAt],
    );
    const row = result.rows[0] as { count: number };
    assert(row.count <= limit, 429, "Rate limit exceeded");
  });
}

async function generateCode(client: DbClient): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    let code = "";
    for (let i = 0; i < 4; i += 1) {
      code += codeAlphabet[randomInt(codeAlphabet.length)];
    }
    const exists = await client.query("select 1 from games where code = $1", [code]);
    if (!exists.rowCount) return code;
  }
  throw new Error("Could not generate unique game code");
}

export async function createGame(params: {
  user: User;
  displayName: string;
  settings: {
    roundCount: number;
    submissionSeconds: number;
    difficulty: Difficulty;
    mode: string;
    revealMode: "one_by_one" | "all_at_once";
  };
}) {
  await userRateLimit(`user:${params.user.id}:create_game`, 5, 60 * 60);

  return transaction(async (client) => {
    const activeGames = await client.query(
      `select count(*) as count
         from game_players gp
         join games g on g.id = gp.game_id
        where gp.user_id = $1
          and gp.left_at is null
          and g.status not in ('finished', 'abandoned')`,
      [params.user.id],
    );
    assert(Number(activeGames.rows[0].count) < 3, 429, "Too many active games");

    const gameId = randomUUID();
    const playerId = randomUUID();
    const code = await generateCode(client);
    await client.query(
      `insert into games(
         id, code, host_user_id, status, max_players, round_count,
         submission_seconds, difficulty, mode, reveal_mode, created_at, updated_at
       )
       values ($1, $2, $3, 'lobby', 10, $4, $5, $6, $7, $8, now(), now())`,
      [
        gameId,
        code,
        params.user.id,
        params.settings.roundCount,
        params.settings.submissionSeconds,
        params.settings.difficulty,
        params.settings.mode,
        params.settings.revealMode,
      ],
    );
    await client.query(
      `insert into game_players(
         id, game_id, user_id, display_name, seat_index, is_host, ready,
         connected, joined_at
       )
       values ($1, $2, $3, $4, 0, true, true, true, now())`,
      [playerId, gameId, params.user.id, params.displayName],
    );
    await client.query(
      `insert into game_events(game_id, actor_user_id, type, payload)
       values ($1, $2, 'game_created', $3)`,
      [gameId, params.user.id, JSON.stringify({ code })],
    );
    return { gameId, code, playerId };
  });
}

export async function joinGame(params: {
  user: User;
  code: string;
  displayName: string;
}) {
  await userRateLimit(`user:${params.user.id}:join_game`, 20, 60 * 60);

  return transaction(async (client) => {
    const gameResult = await client.query(
      "select * from games where code = $1 for update",
      [params.code.toUpperCase()],
    );
    assert(gameResult.rowCount, 404, "Game not found");
    const game = camel<Game>(gameResult.rows[0]);
    assert(game.status === "lobby", 409, "Game is not joinable");

    const existing = await client.query(
      `select * from game_players
        where game_id = $1 and user_id = $2 and left_at is null`,
      [game.id, params.user.id],
    );
    if (existing.rowCount) {
      return {
        gameId: game.id,
        playerId: existing.rows[0].id as string,
        rejoined: true,
      };
    }

    const players = await client.query(
      `select seat_index from game_players
        where game_id = $1 and left_at is null
        order by seat_index`,
      [game.id],
    );
    assert((players.rowCount ?? 0) < game.maxPlayers, 409, "Game is full");

    const takenSeats = new Set(players.rows.map((row) => Number(row.seat_index)));
    let seatIndex = 0;
    while (takenSeats.has(seatIndex)) seatIndex += 1;

    const playerId = randomUUID();
    await client.query(
      `insert into game_players(
         id, game_id, user_id, display_name, seat_index, connected, joined_at
       )
       values ($1, $2, $3, $4, $5, true, now())`,
      [playerId, game.id, params.user.id, params.displayName, seatIndex],
    );
    await client.query(
      `insert into game_events(game_id, actor_user_id, type, payload)
       values ($1, $2, 'player_joined', $3)`,
      [
        game.id,
        params.user.id,
        JSON.stringify({ playerId, displayName: params.displayName }),
      ],
    );
    return { gameId: game.id, playerId, rejoined: false };
  });
}

export async function setReady(gameId: string, userId: string, ready: boolean) {
  await transaction(async (client) => {
    const game = await getGameForUpdate(client, gameId);
    assert(game.status === "lobby", 409, "Ready can only change in lobby");
    const player = await getPlayerForUser(client, gameId, userId);
    await client.query("update game_players set ready = $1 where id = $2", [
      ready,
      player.id,
    ]);
    await client.query(
      `insert into game_events(game_id, actor_user_id, type, payload)
       values ($1, $2, 'player_ready_changed', $3)`,
      [gameId, userId, JSON.stringify({ playerId: player.id, ready })],
    );
  });
}

export async function startGame(gameId: string, userId: string) {
  return transaction(async (client) => {
    const game = await getGameForUpdate(client, gameId);
    await assertHost(client, gameId, userId);
    assert(game.status === "lobby", 409, "Game already started");

    const players = await getPlayers(client, gameId);
    assert(players.length >= 1, 409, "Need at least one player");
    assertGameTransition(game.status, "round_intro");

    const round = await createRound(client, game, 1);
    await client.query(
      `update games
          set status = 'round_intro',
              current_round_index = 1,
              current_round_id = $2,
              updated_at = now()
        where id = $1`,
      [gameId, round.id],
    );
    await client.query(
      `insert into game_events(game_id, round_id, actor_user_id, type)
       values ($1, $2, $3, 'game_started')`,
      [gameId, round.id, userId],
    );
    return round.id;
  });
}

export async function openSubmissions(roundId: string, userId: string) {
  return transitionRoundToSubmitting(roundId, userId);
}

export async function submitResponse(params: {
  roundId: string;
  userId: string;
  text: string;
}) {
  await userRateLimit(`user:${params.userId}:submit`, 40, 60 * 60);
  return transaction(async (client) => {
    const round = await getRoundForUpdate(client, params.roundId);
    const game = await getGameForUpdate(client, round.gameId);
    assert(game.currentRoundId === round.id, 409, "Round is not current");
    assert(round.status === "submitting", 409, "Submissions are closed");
    assert(game.status === "submitting", 409, "Game is not accepting submissions");
    assert(
      round.submissionDeadlineAt &&
        new Date(round.submissionDeadlineAt).getTime() > Date.now(),
      409,
      "Submission deadline passed",
    );
    const text = params.text.trim();
    assert(text.length >= 5 && text.length <= 500, 400, "Invalid text length");
    assertContentAllowed(text);

    const player = await getPlayerForUser(client, game.id, params.userId);
    const submissionId = randomUUID();
    const result = await client.query(
      `insert into submissions(id, game_id, round_id, player_id, user_id, text, submitted_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (round_id, player_id) do update
          set text = excluded.text,
              submitted_at = now()
       where submissions.locked = false
       returning id`,
      [submissionId, game.id, round.id, player.id, params.userId, text],
    );
    assert(result.rowCount, 409, "Submission is locked");
    await client.query(
      `insert into game_events(game_id, round_id, actor_user_id, type, payload)
       values ($1, $2, $3, 'submission_received', $4)`,
      [game.id, round.id, params.userId, JSON.stringify({ playerId: player.id })],
    );
    return { gameId: game.id, playerId: player.id };
  });
}

function assertContentAllowed(text: string) {
  const blocked = [
    /\bsexual violence\b/i,
    /\breal minor\b/i,
    /\bchild\b.*\b(sex|sexual)\b/i,
    /\bslur\b/i,
    /\bgraphic gore\b/i,
  ];
  assert(
    !blocked.some((pattern) => pattern.test(text)),
    400,
    "Submission violates content rules",
  );
}

export async function closeSubmissions(roundId: string, userId: string | null) {
  return transaction(async (client) => {
    const round = await getRoundForUpdate(client, roundId);
    const game = await getGameForUpdate(client, round.gameId);
    if (userId) await assertHost(client, game.id, userId);
    assert(round.status === "submitting", 409, "Round is not accepting submissions");
    assertGameTransition(game.status, "judging");
    assertRoundTransition(round.status, "judging");

    const players = await getPlayers(client, game.id);
    for (const player of players) {
      await client.query(
        `insert into submissions(
           id, game_id, round_id, player_id, user_id, text, submitted_at, locked
         )
         values ($1, $2, $3, $4, $5, $6, now(), true)
         on conflict (round_id, player_id) do update
            set locked = true`,
        [randomUUID(), game.id, round.id, player.id, player.userId, panicSubmission],
      );
    }

    await client.query(
      "update rounds set status = 'judging', updated_at = now() where id = $1",
      [round.id],
    );
    await client.query(
      "update games set status = 'judging', updated_at = now() where id = $1",
      [game.id],
    );
    await client.query(
      `insert into game_events(game_id, round_id, actor_user_id, type)
       values ($1, $2, $3, 'judging_started')`,
      [game.id, round.id, userId],
    );
    return { gameId: game.id, roundId: round.id };
  });
}

export async function startReveal(roundId: string) {
  return transaction(async (client) => {
    const round = await getRoundForUpdate(client, roundId);
    const game = await getGameForUpdate(client, round.gameId);
    if (round.status === "revealing") return { gameId: game.id };
    assert(round.status === "judging", 409, "Round is not judging");
    assertGameTransition(game.status, "revealing");
    assertRoundTransition(round.status, "revealing");
    await client.query(
      "update rounds set status = 'revealing', reveal_index = 1, updated_at = now() where id = $1",
      [round.id],
    );
    await client.query(
      "update games set status = 'revealing', updated_at = now() where id = $1",
      [game.id],
    );
    await client.query(
      `insert into game_events(game_id, round_id, type) values ($1, $2, 'revealing_started')`,
      [game.id, round.id],
    );
    return { gameId: game.id };
  });
}

export async function advanceReveal(roundId: string, userId: string) {
  return transaction(async (client) => {
    const round = await getRoundForUpdate(client, roundId);
    const game = await getGameForUpdate(client, round.gameId);
    await assertHost(client, game.id, userId);
    assert(round.status === "revealing", 409, "Round is not revealing");

    const playerCount = (await getPlayers(client, game.id)).length;
    if (round.revealIndex < playerCount) {
      await client.query(
        "update rounds set reveal_index = reveal_index + 1, updated_at = now() where id = $1",
        [round.id],
      );
      await client.query(
        `insert into game_events(game_id, round_id, actor_user_id, type)
         values ($1, $2, $3, 'reveal_advanced')`,
        [game.id, round.id, userId],
      );
      return { gameId: game.id, complete: false };
    }

    assertGameTransition(game.status, "scoreboard");
    assertRoundTransition(round.status, "scoreboard");
    await client.query(
      "update rounds set status = 'scoreboard', updated_at = now() where id = $1",
      [round.id],
    );
    await client.query(
      "update games set status = 'scoreboard', updated_at = now() where id = $1",
      [game.id],
    );
    await client.query(
      `insert into game_events(game_id, round_id, actor_user_id, type)
       values ($1, $2, $3, 'round_finished')`,
      [game.id, round.id, userId],
    );
    return { gameId: game.id, complete: true };
  });
}

export async function nextRoundOrFinish(gameId: string, userId: string) {
  return transaction(async (client) => {
    const game = await getGameForUpdate(client, gameId);
    await assertHost(client, game.id, userId);
    assert(game.status === "scoreboard", 409, "Game is not at scoreboard");

    if (game.currentRoundIndex >= game.roundCount) {
      assertGameTransition(game.status, "finished");
      await client.query(
        "update games set status = 'finished', finished_at = now(), updated_at = now() where id = $1",
        [game.id],
      );
      await client.query(
        `insert into game_events(game_id, actor_user_id, type)
         values ($1, $2, 'game_finished')`,
        [game.id, userId],
      );
      return { gameId: game.id, finished: true, roundId: null };
    }

    assertGameTransition(game.status, "round_intro");
    const nextIndex = game.currentRoundIndex + 1;
    const round = await createRound(client, game, nextIndex);
    await client.query(
      `update games
          set status = 'round_intro',
              current_round_index = $2,
              current_round_id = $3,
              updated_at = now()
        where id = $1`,
      [game.id, nextIndex, round.id],
    );
    return { gameId: game.id, finished: false, roundId: round.id };
  });
}

export async function setPlayerConnected(userId: string, gameId: string, connected: boolean) {
  await pool.query(
    `update game_players
        set connected = $3
      where user_id = $1 and game_id = $2 and left_at is null`,
    [userId, gameId, connected],
  );
}

export async function getSnapshot(
  gameId: string,
  viewerUserId: string,
): Promise<GameSnapshot> {
  const game = await getGame(pool, gameId);
  await getPlayerForUser(pool, game.id, viewerUserId);
  const players = await getPlayers(pool, game.id);
  const round = game.currentRoundId ? await getRound(pool, game.currentRoundId) : null;

  const submitted = round
    ? await pool.query("select player_id from submissions where round_id = $1", [
        round.id,
      ])
    : { rows: [] };

  let visibleSubmissions: Submission[] = [];
  let visibleJudgments: Judgment[] = [];

  if (round) {
    const viewerPlayer = players.find((player) => player.userId === viewerUserId);
    const revealPlayerIds = await visiblePlayerIdsForRound(game, round, players);
    const canSeeAll = round.status === "scoreboard" || game.status === "finished";
    const visibleIds = canSeeAll
      ? players.map((player) => player.id)
      : round.status === "revealing"
        ? revealPlayerIds
        : viewerPlayer
          ? [viewerPlayer.id]
          : [];

    if (visibleIds.length) {
      const placeholders = visibleIds
        .map((_, index) => `$${index + 2}`)
        .join(", ");
      visibleSubmissions = camelRows<Submission>(
        (
          await pool.query(
            `select * from submissions
              where round_id = $1 and player_id in (${placeholders})
              order by submitted_at`,
            [round.id, ...visibleIds],
          )
        ).rows,
      );
    }

    if (canSeeAll || round.status === "revealing") {
      const judgmentIds = canSeeAll
        ? players.map((player) => player.id)
        : revealPlayerIds;
      if (judgmentIds.length) {
        const placeholders = judgmentIds
          .map((_, index) => `$${index + 2}`)
          .join(", ");
        visibleJudgments = camelRows<Judgment>(
          (
            await pool.query(
              `select * from judgments
                where round_id = $1 and player_id in (${placeholders})
                order by created_at`,
              [round.id, ...judgmentIds],
            )
          ).rows,
        ).map((judgment) => ({
          ...judgment,
          antiCheatFlags: judgment.antiCheatFlags ?? [],
        }));
      }
    }
  }

  return {
    game,
    players,
    currentRound: round,
    submittedPlayerIds: submitted.rows.map((row) => String(row.player_id)),
    visibleSubmissions,
    visibleJudgments,
    serverTime: new Date().toISOString(),
  };
}

export async function getRoundGameId(roundId: string): Promise<string> {
  const result = await pool.query("select game_id from rounds where id = $1", [roundId]);
  assert(result.rowCount, 404, "Round not found");
  return result.rows[0].game_id as string;
}

export async function getPlayerForUser(
  client: DbClient,
  gameId: string,
  userId: string,
): Promise<Player> {
  const result = await client.query(
    `select * from game_players
      where game_id = $1 and user_id = $2 and left_at is null
      limit 1`,
    [gameId, userId],
  );
  assert(result.rowCount, 403, "Not a player in this game");
  return camel<Player>(result.rows[0]);
}

export async function getPlayers(client: DbClient, gameId: string): Promise<Player[]> {
  const result = await client.query(
    `select * from game_players
      where game_id = $1 and left_at is null
      order by seat_index`,
    [gameId],
  );
  return camelRows<Player>(result.rows);
}

export async function getRound(client: DbClient, roundId: string): Promise<Round> {
  const result = await client.query("select * from rounds where id = $1", [roundId]);
  assert(result.rowCount, 404, "Round not found");
  return camel<Round>(result.rows[0]);
}

export async function getGame(client: DbClient, gameId: string): Promise<Game> {
  const result = await client.query("select * from games where id = $1", [gameId]);
  assert(result.rowCount, 404, "Game not found");
  return camel<Game>(result.rows[0]);
}

async function getGameForUpdate(client: DbClient, gameId: string): Promise<Game> {
  const result = await client.query("select * from games where id = $1 for update", [
    gameId,
  ]);
  assert(result.rowCount, 404, "Game not found");
  return camel<Game>(result.rows[0]);
}

async function getRoundForUpdate(client: DbClient, roundId: string): Promise<Round> {
  const result = await client.query("select * from rounds where id = $1 for update", [
    roundId,
  ]);
  assert(result.rowCount, 404, "Round not found");
  return camel<Round>(result.rows[0]);
}

async function assertHost(client: DbClient, gameId: string, userId: string) {
  const player = await getPlayerForUser(client, gameId, userId);
  assert(player.isHost, 403, "Host only");
}

async function createRound(client: DbClient, game: Game, roundIndex: number): Promise<Round> {
  const scenario = pickScenario(roundIndex - 1);
  const roundId = randomUUID();
  const result = await client.query(
    `insert into rounds(
       id, game_id, round_index, status, scenario_title, scenario_text,
       immediate_threat, time_pressure, category, difficulty, created_at, updated_at
     )
     values ($1, $2, $3, 'round_intro', $4, $5, $6, $7, $8, $9, now(), now())
     returning *`,
    [
      roundId,
      game.id,
      roundIndex,
      scenario.title,
      scenario.description,
      scenario.immediateThreat,
      scenario.timePressure,
      scenario.category,
      scenario.difficulty,
    ],
  );
  await client.query(
    `insert into game_events(game_id, round_id, type, payload)
     values ($1, $2, 'round_created', $3)`,
    [game.id, roundId, JSON.stringify({ roundIndex })],
  );
  return camel<Round>(result.rows[0]);
}

async function transitionRoundToSubmitting(roundId: string, userId: string) {
  return transaction(async (client) => {
    const round = await getRoundForUpdate(client, roundId);
    const game = await getGameForUpdate(client, round.gameId);
    await assertHost(client, game.id, userId);
    assert(game.currentRoundId === round.id, 409, "Round is not current");
    assert(game.status === "round_intro", 409, "Game is not in round intro");
    assertRoundTransition(round.status, "submitting");
    assertGameTransition(game.status, "submitting");

    await client.query(
      `update rounds
          set status = 'submitting',
              submission_deadline_at = $2,
              updated_at = now()
        where id = $1`,
      [
        round.id,
        new Date(Date.now() + game.submissionSeconds * 1000).toISOString(),
      ],
    );
    await client.query(
      "update games set status = 'submitting', updated_at = now() where id = $1",
      [game.id],
    );
    await client.query(
      `insert into game_events(game_id, round_id, actor_user_id, type)
       values ($1, $2, $3, 'submissions_opened')`,
      [game.id, round.id, userId],
    );
    return { gameId: game.id };
  });
}

async function visiblePlayerIdsForRound(
  game: Game,
  round: Round,
  players: Player[],
): Promise<string[]> {
  if (round.status !== "revealing") return [];
  if (game.revealMode === "all_at_once") return players.map((player) => player.id);
  return players.slice(0, round.revealIndex).map((player) => player.id);
}
