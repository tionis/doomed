export type GameStatus =
  | "lobby"
  | "round_intro"
  | "submitting"
  | "judging"
  | "revealing"
  | "scoreboard"
  | "finished"
  | "abandoned";

export type Player = {
  id: string;
  userId: string;
  displayName: string;
  seatIndex: number;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  score: number;
  survivalCount: number;
  deathCount: number;
};

export type Game = {
  id: string;
  code: string;
  hostUserId: string;
  status: GameStatus;
  currentRoundIndex: number;
  currentRoundId: string | null;
  roundCount: number;
  submissionSeconds: number;
  difficulty: "easy" | "normal" | "ruthless";
  revealMode: "one_by_one" | "all_at_once";
};

export type Round = {
  id: string;
  roundIndex: number;
  status: string;
  scenarioTitle: string;
  scenarioText: string;
  immediateThreat: string;
  timePressure: string;
  category: string;
  difficulty: number;
  submissionDeadlineAt: string | null;
  revealIndex: number;
};

export type Submission = {
  id: string;
  playerId: string;
  userId: string;
  text: string;
  submittedAt: string;
};

export type Judgment = {
  id: string;
  playerId: string;
  logicScore: number;
  creativityScore: number;
  feasibilityScore: number;
  humorScore: number;
  verdict: "survived" | "barely_survived" | "perished";
  survived: boolean;
  pointsAwarded: number;
  outcome: string;
  judgeComment: string;
  causeOfDeath: string | null;
};

export type Snapshot = {
  game: Game;
  players: Player[];
  currentRound: Round | null;
  submittedPlayerIds: string[];
  visibleSubmissions: Submission[];
  visibleJudgments: Judgment[];
  serverTime: string;
};

export type User = {
  id: string;
  displayName: string;
  avatarUrl?: string;
};
