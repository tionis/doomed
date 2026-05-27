import type { Difficulty, Verdict } from "./types.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function survivalThreshold(difficulty: Difficulty): number {
  switch (difficulty) {
    case "easy":
      return 5;
    case "normal":
      return 6;
    case "ruthless":
      return 7;
  }
}

export function computeVerdict(params: {
  logic: number;
  creativity: number;
  feasibility: number;
  difficulty: Difficulty;
}): Verdict {
  const avg = (params.logic + params.creativity + params.feasibility) / 3;
  const threshold = survivalThreshold(params.difficulty);

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
}): number {
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
