import type { GameStatus, RoundStatus } from "./types.js";

const gameTransitions: Record<GameStatus, GameStatus[]> = {
  lobby: ["round_intro", "abandoned"],
  round_intro: ["submitting", "abandoned"],
  submitting: ["judging", "abandoned"],
  judging: ["revealing", "abandoned"],
  revealing: ["scoreboard", "abandoned"],
  scoreboard: ["round_intro", "finished", "abandoned"],
  finished: [],
  abandoned: [],
};

const roundTransitions: Record<RoundStatus, RoundStatus[]> = {
  round_intro: ["submitting", "complete"],
  submitting: ["judging", "complete"],
  judging: ["revealing", "complete"],
  revealing: ["scoreboard", "complete"],
  scoreboard: ["complete"],
  complete: [],
};

export function assertGameTransition(from: GameStatus, to: GameStatus) {
  if (!gameTransitions[from].includes(to)) {
    throw new Error(`Invalid game transition: ${from} -> ${to}`);
  }
}

export function assertRoundTransition(from: RoundStatus, to: RoundStatus) {
  if (!roundTransitions[from].includes(to)) {
    throw new Error(`Invalid round transition: ${from} -> ${to}`);
  }
}
