import { describe, it, expect } from "vitest";
import {
  makeRng,
  createDeal,
  applyMove,
  legalMoves,
  observe,
  isTerminal,
  nextInt,
  type GameState,
} from "@guandan/engine";
import { staticDealValue, boundedStaticValue, randomBot } from "../src/index";

/** Sample states from random self-play deals across levels (incl. late-game with finished seats). */
function sampleStates(n: number, seed: number): GameState[] {
  const states: GameState[] = [];
  const rng = makeRng(seed);
  while (states.length < n) {
    let s = createDeal(2 + nextInt(rng, 13), rng);
    while (!isTerminal(s)) {
      if (nextInt(rng, 10) === 0) states.push(s);
      const seat = s.toAct;
      s = applyMove(s, randomBot(observe(s, seat), legalMoves(s, seat), rng));
    }
  }
  return states.slice(0, n);
}

describe("boundedStaticValue — the ISMCTS leaf contract", () => {
  const states = sampleStates(300, 42);

  it("stays within the deal-value scale [-3, 3] on states across levels and game phases", () => {
    // THE CONTRACT: ismcts.ts normalises leaf values as (v+3)/6 and mixes them with exact
    // terminal deal values (±3). A leaf outside [-3,3] silently breaks UCB exploration scaling
    // and lets unfinished positions outscore actual wins — the 2026-07-01 bug this guards against.
    for (const s of states) {
      for (const team of [0, 1]) {
        const v = boundedStaticValue(s, team);
        expect(v).toBeGreaterThanOrEqual(-3);
        expect(v).toBeLessThanOrEqual(3);
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("raw staticDealValue really does exceed ±3 (why the bound exists)", () => {
    // If this ever stops holding, the squash constant should be revisited.
    const exceeds = states.some((s) => Math.abs(staticDealValue(s, 0)) > 3);
    expect(exceeds).toBe(true);
  });

  it("preserves the raw eval's ordering (monotone squash)", () => {
    for (let i = 1; i < 60; i++) {
      const a = states[i - 1] as GameState;
      const b = states[i] as GameState;
      const rawDiff = staticDealValue(a, 0) - staticDealValue(b, 0);
      const boundedDiff = boundedStaticValue(a, 0) - boundedStaticValue(b, 0);
      if (rawDiff !== 0) expect(Math.sign(boundedDiff)).toBe(Math.sign(rawDiff));
    }
  });

  it("is zero-symmetric between the two teams", () => {
    const s = states[0] as GameState;
    expect(boundedStaticValue(s, 0)).toBeCloseTo(-boundedStaticValue(s, 1), 10);
  });
});
