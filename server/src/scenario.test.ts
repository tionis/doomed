import { describe, expect, test } from "bun:test";
import { bannedWordsForRound, pickScenario, scenarios } from "./scenario.js";

describe("scenarios", () => {
  test("rotates through the list", () => {
    expect(pickScenario(1)).toEqual(scenarios[0]);
    expect(pickScenario(scenarios.length + 1)).toEqual(scenarios[0]);
  });

  test("banned words are non-empty", () => {
    expect(bannedWordsForRound().length).toBeGreaterThan(0);
  });
});
