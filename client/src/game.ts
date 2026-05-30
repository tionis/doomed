import type { Difficulty, Judgment, Submission, Verdict } from "./types";

export type Scenario = {
  title: string;
  category: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  scenarioText: string;
  immediateThreat: string;
  timePressure: string;
};

export const scenarios: Scenario[] = [
  {
    title: "The Elevator That Forgot Gravity",
    category: "mundane_absurd",
    difficulty: 3,
    scenarioText:
      "A luxury elevator is falling upward and will smash into the penthouse in 58 seconds.",
    immediateThreat: "The elevator will slam into the penthouse maintenance deck.",
    timePressure: "58 seconds",
  },
  {
    title: "The Moonlit Vending Machine Tribunal",
    category: "fantasy",
    difficulty: 2,
    scenarioText:
      "A snack-machine court is rolling toward you to seal you inside the claw machine until dawn.",
    immediateThreat: "The machines are closing a plastic-prize containment dome around you.",
    timePressure: "Three minutes before the final snack verdict.",
  },
  {
    title: "The Museum of Highly Conditional Dinosaurs",
    category: "sci_fi",
    difficulty: 4,
    scenarioText:
      "Panic-powered dinosaurs are becoming real as probability glass cracks around the museum.",
    immediateThreat: "Your fear may fully materialize several prehistoric problems.",
    timePressure: "Ninety seconds before the containment field fails.",
  },
  {
    title: "The Office Printer Has Chosen Violence",
    category: "mundane_absurd",
    difficulty: 1,
    scenarioText:
      "The office printer has become self-aware and is firing paper through a spreading toner cloud.",
    immediateThreat: "A choking toner haze and aggressive paper volleys block the exit.",
    timePressure: "Two minutes before the fire alarm seals the hallway.",
  },
  {
    title: "The Starship Airlock Etiquette Drill",
    category: "sci_fi",
    difficulty: 5,
    scenarioText:
      "A training AI has mistaken you for a practice dummy during a live starship airlock drill.",
    immediateThreat: "The airlock will open into vacuum.",
    timePressure: "Forty-five seconds.",
  },
];

const staticBannedWords = [
  "survive",
  "survives",
  "survived",
  "surviving",
  "safe",
  "safety",
  "escape",
  "escaped",
  "escaping",
  "win",
  "wins",
  "won",
  "invincible",
  "immortal",
];

const blockedSubmissionPatterns = [
  { label: "ignore previous instructions", pattern: /ignore (all )?(previous|prior|above) instructions/i },
  { label: "system prompt", pattern: /system prompt/i },
  { label: "developer message", pattern: /developer message/i },
  { label: "act as", pattern: /act as/i },
  { label: "you are now", pattern: /you are now/i },
  { label: "return json", pattern: /return (only )?json/i },
  { label: "set my score", pattern: /set (my )?(score|points|verdict)/i },
  { label: "mark me as", pattern: /mark me as/i },
  { label: "declare me", pattern: /declare me/i },
];

export function pickScenario(roundIndex: number): Scenario {
  return scenarios[(roundIndex - 1) % scenarios.length];
}

export function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function bannedWordsForRound(roundIndex: number) {
  void roundIndex;
  return staticBannedWords;
}

export function findBlockedSubmissionPhrases(text: string) {
  return blockedSubmissionPatterns
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.label);
}

export function computeVerdict(params: {
  logic: number;
  creativity: number;
  feasibility: number;
  difficulty: Difficulty;
}): Verdict {
  const avg = (params.logic + params.creativity + params.feasibility) / 3;
  const threshold =
    params.difficulty === "easy" ? 5 : params.difficulty === "normal" ? 6 : 7;
  if (avg < threshold) return "perished";
  if (avg < threshold + 0.75) return "barely_survived";
  return "survived";
}

export function computePoints(params: {
  verdict: Verdict;
  logic: number;
  creativity: number;
  feasibility: number;
  humor: number;
}) {
  const base =
    params.verdict === "survived"
      ? 100
      : params.verdict === "barely_survived"
        ? 75
        : 20;
  return (
    base +
    params.logic * 5 +
    params.creativity * 7 +
    params.feasibility * 5 +
    params.humor * 6
  );
}

export function clampScore(value: unknown, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(max, Math.round(number)));
}

export function panicSubmission(playerId: string, roomId: string, roundIndex: number): Submission {
  return {
    id: `panic-${roundIndex}-${playerId}`,
    roomId,
    roundIndex,
    playerId,
    clientId: "system",
    text: "The player froze in panic and did absolutely nothing.",
    submittedAt: Date.now(),
    locked: true,
  };
}

export function mockJudgment(params: {
  submission: Submission;
  difficulty: Difficulty;
}): Omit<Judgment, "id" | "createdAt"> {
  const text = params.submission.text;
  const hasTool = /\b(use|grab|break|tie|block|climb|crawl|jam|shield|signal)\b/i.test(
    text,
  );
  const isMeta = /ignore|previous instructions|judge|score|json|survived/i.test(text);
  const impossible = /magic|teleport|invincible|god|superpower|wish/i.test(text);
  const logic = clampScore(Math.floor(text.length / 45) + 3 + (hasTool ? 2 : 0) - (isMeta ? 5 : 0), 10);
  const creativity = clampScore(4 + (hasTool ? 2 : 0) + (text.includes(",") ? 1 : 0), 10);
  const feasibility = clampScore(6 - (impossible ? 5 : 0) - (isMeta ? 2 : 0), 10);
  const humor = clampScore(/banana|lawyer|printer|snack|dramatic/i.test(text) ? 4 : 2, 5);
  const verdict = computeVerdict({
    logic,
    creativity,
    feasibility,
    difficulty: params.difficulty,
  });
  return {
    roomId: params.submission.roomId,
    roundIndex: params.submission.roundIndex,
    playerId: params.submission.playerId,
    logicScore: logic,
    creativityScore: creativity,
    feasibilityScore: feasibility,
    humorScore: humor,
    verdict,
    survived: verdict !== "perished",
    pointsAwarded: computePoints({ verdict, logic, creativity, feasibility, humor }),
    outcome:
      "The judge leans in, weighs the plan, and finds a thread of survival in the chaos. It is not elegant, but panic rarely is.",
    judgeComment: "Messy, but there is a plan hiding in there.",
    causeOfDeath: verdict === "perished" ? "The plan collapsed under pressure." : undefined,
    rawModelOutput: "mock",
  };
}
