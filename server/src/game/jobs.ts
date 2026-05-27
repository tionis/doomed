import { pool } from "../db/pool.js";
import { judgeRound } from "../ai/judge.js";
import { closeSubmissions } from "./repository.js";
import { broadcastToGame } from "../realtime/hub.js";

const judgingJobs = new Set<string>();

export function startJudgingJob(roundId: string, gameId: string) {
  if (judgingJobs.has(roundId)) return;
  judgingJobs.add(roundId);
  void judgeRound(roundId)
    .catch(async (error) => {
      console.error("judging failed", error);
      await broadcastToGame(gameId, {
        type: "error",
        message: "Judging failed. Try closing submissions again.",
      });
    })
    .finally(() => {
      judgingJobs.delete(roundId);
    });
}

export function startRecoveryLoop() {
  setInterval(() => {
    void runRecovery();
  }, 5000).unref();

  void runRecovery();
}

async function runRecovery() {
  try {
    await recoverExpiredRounds();
    await recoverJudgingRounds();
  } catch (error) {
    console.error("recovery loop failed", error);
  }
}

async function recoverExpiredRounds() {
  const result = await pool.query(
    `select r.id, r.game_id
       from rounds r
       join games g on g.current_round_id = r.id
      where r.status = 'submitting'
        and g.status = 'submitting'
        and r.submission_deadline_at <= now()`,
  );

  for (const row of result.rows as { id: string; game_id: string }[]) {
    try {
      await closeSubmissions(row.id, null);
      await broadcastToGame(row.game_id, {
        type: "submissions_closed",
        roundId: row.id,
      });
      startJudgingJob(row.id, row.game_id);
    } catch (error) {
      console.error("deadline recovery failed", error);
    }
  }
}

async function recoverJudgingRounds() {
  const result = await pool.query(
    `select r.id, r.game_id
       from rounds r
       join games g on g.current_round_id = r.id
      where r.status = 'judging'
        and g.status = 'judging'`,
  );

  for (const row of result.rows as { id: string; game_id: string }[]) {
    startJudgingJob(row.id, row.game_id);
  }
}
