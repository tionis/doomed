import { bannedWordsForRound, mockJudgment, pickScenario } from "./game";
import type { Judgment, Player, Room, Submission } from "./types";

export type DemoMode = "lobby" | "submitting" | "revealing" | "scoreboard";

const now = Date.now();

export function createDemoState(mode: DemoMode): {
  room: Room;
  players: Player[];
  submissions: Submission[];
  judgments: Judgment[];
  me?: Player;
} {
  const scenario = pickScenario(1);
  const room: Room = {
    id: "demo-room",
    code: "DEMO",
    hostClientId: "demo-host-client",
    hostName: "Mara",
    activePlayerId: "demo-1",
    status:
      mode === "lobby"
        ? "lobby"
        : mode === "submitting"
          ? "submitting"
          : mode === "revealing"
            ? "revealing"
            : "scoreboard",
    roundIndex: mode === "lobby" ? 0 : 1,
    roundCount: 5,
    submissionSeconds: 60,
    difficulty: "normal",
    revealIndex: mode === "revealing" ? 2 : 0,
    scenarioTitle: scenario.title,
    scenarioText: scenario.scenarioText,
    immediateThreat: scenario.immediateThreat,
    timePressure: scenario.timePressure,
    category: scenario.category,
    bannedWords: bannedWordsForRound(1),
    deadlineAt: mode === "submitting" ? now + 42_000 : 0,
    createdAt: now - 300_000,
    updatedAt: now,
  };

  const players: Player[] = [
    demoPlayer("demo-host", "demo-host-client", "Mara", 0, true, 145),
    demoPlayer("demo-1", "demo-client-1", "Jonas", 1, false, 132),
    demoPlayer("demo-2", "demo-client-2", "Priya", 2, false, 98),
    demoPlayer("demo-3", "demo-client-3", "Noah", 3, false, 0),
  ];

  if (mode === "lobby") {
    return { room, players, submissions: [], judgments: [], me: players[1] };
  }

  const submissions: Submission[] = [
    demoSubmission(
      players[0],
      "I wedge the service briefcase under the control panel, use the metal frame as leverage, and yank the emergency brake linkage until something important regrets being built cheaply.",
    ),
    demoSubmission(
      players[1],
      "I lie flat, wrap my belt around the handrail, kick open the lower panel, and jam the maintenance override with my shoe before the impact timer finishes its dramatic monologue.",
    ),
    demoSubmission(
      players[2],
      "I call the emergency phone's legal department and threaten to leave a one-star review unless gravity is restored immediately.",
    ),
  ];

  if (mode === "submitting") {
    return { room, players, submissions, judgments: [], me: players[3] };
  }

  const judgments = submissions.map((submission) => ({
    ...mockJudgment({ submission, difficulty: room.difficulty }),
    id: `judgment-${submission.playerId}`,
    createdAt: now - 20_000,
  }));

  return { room, players, submissions, judgments, me: players[1] };
}

function demoPlayer(
  id: string,
  clientId: string,
  name: string,
  seatIndex: number,
  isHost: boolean,
  score: number,
): Player {
  return {
    id,
    roomId: "demo-room",
    clientId,
    name,
    seatIndex,
    isHost,
    connected: true,
    ready: isHost || seatIndex < 3,
    score,
    survivalCount: score > 0 ? 1 : 0,
    deathCount: 0,
    joinedAt: now - (240_000 - seatIndex * 35_000),
    lastSeenAt: Date.now(),
  };
}

function demoSubmission(player: Player, text: string): Submission {
  return {
    id: `submission-${player.id}`,
    roomId: "demo-room",
    roundIndex: 1,
    playerId: player.id,
    clientId: player.clientId,
    text,
    submittedAt: now - 40_000 + player.seatIndex * 7_000,
    locked: true,
  };
}
