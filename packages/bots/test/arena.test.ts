import { describe, it, expect } from "vitest";
import { makeRng } from "@guandan/engine";
import { randomBot, playMatch, type Bot } from "../src/index";

describe("playMatch — full match vs bots, end to end", () => {
  const bots: Bot[] = [randomBot, randomBot, randomBot, randomBot];

  it("runs a complete match to a winner (deal -> tribute -> play -> score, repeated)", () => {
    for (const seed of [1, 2, 3]) {
      const out = playMatch(bots, makeRng(seed));
      expect(out.winner === 0 || out.winner === 1).toBe(true); // someone wins (not the cap)
      expect(out.deals).toBeGreaterThan(0);
      expect(out.deals).toBeLessThan(5000);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = playMatch(bots, makeRng(42));
    const b = playMatch(bots, makeRng(42));
    expect(a).toEqual(b);
  });
});
