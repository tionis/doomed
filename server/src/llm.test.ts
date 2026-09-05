import { describe, expect, test } from "bun:test";
import { judgeOne, mockJudgment } from "./llm.js";

const submission = {
  id: "1-p1",
  roomId: "r1",
  roundIndex: 1,
  playerId: "p1",
  clientId: "c1",
  text: "I use the ladder to climb down fast and block the door with crates.",
  submittedAt: Date.now(),
  locked: true,
};

describe("mockJudgment", () => {
  test("rewards specific tool-using plans on easy", () => {
    const judged = mockJudgment(submission, "easy");
    expect(judged.verdict).toBe("survived");
    expect(judged.survived).toBe(true);
    expect(judged.pointsAwarded).toBeGreaterThan(100);
  });

  test("same plan perishes on ruthless", () => {
    const judged = mockJudgment(submission, "ruthless");
    expect(judged.verdict).toBe("perished");
    expect(judged.survived).toBe(false);
  });

  test("scores stay in range", () => {
    const judged = mockJudgment(submission, "normal");
    expect(judged.logicScore).toBeGreaterThanOrEqual(0);
    expect(judged.logicScore).toBeLessThanOrEqual(10);
    expect(judged.humorScore).toBeLessThanOrEqual(5);
  });
});

describe("judgeOne", () => {
  test("falls back to mock without LLM_BASE_URL", async () => {
    const judged = await judgeOne({
      scenario: { title: "T", scenarioText: "S", immediateThreat: "I", timePressure: "P" },
      submission,
      playerName: "Player",
      difficulty: "normal",
    });
    expect(judged.roomId).toBe("r1");
    expect(typeof judged.pointsAwarded).toBe("number");
  });
});
