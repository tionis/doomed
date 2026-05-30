export type RoomStatus =
  | "lobby"
  | "round_intro"
  | "submitting"
  | "judging"
  | "revealing"
  | "scoreboard"
  | "finished";

export type Difficulty = "easy" | "normal" | "ruthless";
export type Verdict = "survived" | "barely_survived" | "perished";

export type Room = {
  id: string;
  code: string;
  hostClientId: string;
  hostUserId?: string;
  hostEmail?: string;
  hostName: string;
  activePlayerId?: string;
  status: RoomStatus;
  roundIndex: number;
  roundCount: number;
  submissionSeconds: number;
  difficulty: Difficulty;
  revealIndex: number;
  scenarioTitle?: string;
  scenarioText?: string;
  immediateThreat?: string;
  timePressure?: string;
  category?: string;
  bannedWords?: string[];
  deadlineAt?: number;
  hiddenFromHostHistory?: boolean;
  finishedAt?: number;
  archivedAt?: number;
  cleanupReason?: string;
  createdAt: number;
  updatedAt: number;
};

export type Player = {
  id: string;
  roomId: string;
  clientId: string;
  name: string;
  seatIndex: number;
  isHost: boolean;
  connected: boolean;
  ready: boolean;
  score: number;
  survivalCount: number;
  deathCount: number;
  joinedAt: number;
  lastSeenAt: number;
};

export type Submission = {
  id: string;
  roomId: string;
  roundIndex: number;
  playerId: string;
  clientId: string;
  text: string;
  submittedAt: number;
  locked: boolean;
};

export type Judgment = {
  id: string;
  roomId: string;
  roundIndex: number;
  playerId: string;
  logicScore: number;
  creativityScore: number;
  feasibilityScore: number;
  humorScore: number;
  verdict: Verdict;
  survived: boolean;
  pointsAwarded: number;
  outcome: string;
  judgeComment: string;
  causeOfDeath?: string;
  rawModelOutput?: string;
  createdAt: number;
};

export type AdminIdentity = {
  id: string;
  email: string;
  note?: string;
  createdAt: number;
  createdBy?: string;
};

export type AiSettings = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  responseFormat: "json_object" | "none";
  httpReferer: string;
  appTitle: string;
};
