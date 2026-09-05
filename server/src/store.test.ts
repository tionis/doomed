import { describe, expect, test } from "bun:test";
import { stripUndefined } from "./store.js";

describe("stripUndefined", () => {
  test("drops undefined properties for Automerge writes", () => {
    expect(stripUndefined({ a: 1, b: undefined, c: "x" } as Record<string, unknown>)).toEqual({ a: 1, c: "x" });
  });
});
