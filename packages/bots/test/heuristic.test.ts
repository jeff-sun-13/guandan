import { describe, it, expect } from "vitest";
import {
  makeRng,
  nextInt,
  createDeal,
  applyMove,
  isTerminal,
  observe,
  legalMoves,
  type Move,
} from "@guandan/engine";
import { heuristicBot, randomBot, playMatch, type Bot } from "../src/index";

describe("heuristicBot (v1) — legality", () => {
  it("only ever returns legal moves over a full deal", () => {
    const rng = makeRng(11);
    let s = createDeal(2, rng, nextInt(rng, 4));
    let guard = 0;
    while (!isTerminal(s)) {
      const seat = s.toAct;
      const legal = legalMoves(s, seat);
      const move: Move = heuristicBot(observe(s, seat), legal, rng);
      expect(legal).toContainEqual(move);
      s = applyMove(s, move);
      if (++guard > 100000) throw new Error("did not terminate");
    }
  });
});

describe("heuristicBot (v1) — strength vs randomBot (v0)", () => {
  it("a heuristic team beats a random team in the majority of matches", () => {
    // Team 0 = seats {0,2} = heuristic; Team 1 = seats {1,3} = random.
    const bots: Bot[] = [heuristicBot, randomBot, heuristicBot, randomBot];
    const N = 30;
    let heuristicWins = 0;
    for (let seed = 0; seed < N; seed++) {
      const out = playMatch(bots, makeRng(seed));
      if (out.winner === 0) heuristicWins++;
    }
    // A real strategic edge should win clearly more than half. (Expected well above this.)
    expect(heuristicWins).toBeGreaterThan(N / 2);
  });
});
