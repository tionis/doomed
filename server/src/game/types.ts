export type GameStatus =
  | "lobby"
  | "round_intro"
  | "submitting"
  | "judging"
  | "revealing"
  | "scoreboard"
  | "finished"
  | "abandoned";

export type RoundStatus =
  | "round_intro"
  | "submitting"
  | "judging"
  | "revealing"
  | "scoreboard"
  | "complete";

export type Difficulty = "easy" | "normal" | "ruthless";
export type Verdict = "survived" | "barely_survived" | "perished";

export type User = {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  bannedAt?: string;
};

export type Game = {
  id: string;
  code: string;
  hostUserId: string;
  status: GameStatus;
  currentRoundIndex: number;
  currentRoundId: string | null;
  maxPlayers: number;
  roundCount: number;
  submissionSeconds: number;
  difficulty: Difficulty;
  mode: string;
  revealMode: "one_by_one" | "all_at_once";
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type Player = {
  id: string;
  gameId: string;
  userId: string;
  displayName: string;
  seatIndex: number;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  alive: boolean;
  score: number;
  survivalCount: number;
  deathCount: number;
  joinedAt: string;
  leftAt: string | null;
};

export type Round = {
  id: string;
  gameId: string;
  roundIndex: number;
  status: RoundStatus;
  scenarioTitle: string;
  scenarioText: string;
  immediateThreat: string;
  timePressure: string;
  category: string;
  difficulty: number;
  submissionDeadlineAt: string | null;
  revealIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type Submission = {
  id: string;
  gameId: string;
  roundId: string;
  playerId: string;
  userId: string;
  text: string;
  submittedAt: string;
  locked: boolean;
};

export type Judgment = {
  id: string;
  gameId: string;
  roundId: string;
  playerId: string;
  submissionId: string;
  logicScore: number;
  creativityScore: number;
  feasibilityScore: number;
  humorScore: number;
  verdict: Verdict;
  survived: boolean;
  pointsAwarded: number;
  outcome: string;
  judgeComment: string;
  causeOfDeath: string | null;
  antiCheatFlags: string[];
  modelName: string;
  rawModelOutput: string | null;
  createdAt: string;
};

export type Scenario = {
  title: string;
  category: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  description: string;
  immediateThreat: string;
  timePressure: string;
};
