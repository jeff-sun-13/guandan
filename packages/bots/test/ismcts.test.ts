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
import { makeIsmctsBot, randomBot, playMatch } from "../src/index";

// A small ISMCTS config for tests (few iterations, tight candidate cap) — keeps these quick.
const fastIsmcts = makeIsmctsBot({ iterations: 40, maxCandidates: 5 });

describe("ismctsBot (v2.2) — legality", () => {
  it("only ever returns legal moves over a full deal", () => {
    const rng = makeRng(3);
    let s = createDeal(2, rng, nextInt(rng, 4));
    let guard = 0;
    while (!isTerminal(s)) {
      const seat = s.toAct;
      const legal = legalMoves(s, seat);
      const move: Move = fastIsmcts(observe(s, seat), legal, rng);
      expect(legal).toContainEqual(move);
      s = applyMove(s, move);
      if (++guard > 100000) throw new Error("did not terminate");
    }
    expect(s.finished.slice().sort()).toEqual([0, 1, 2, 3]);
  });

  it("is deterministic for a given RNG seed + observation", () => {
    const s = createDeal(2, makeRng(20), 0);
    const obs = observe(s, 0);
    const legal = legalMoves(s, 0);
    const a = fastIsmcts(obs, legal, makeRng(5));
    const b = fastIsmcts(obs, legal, makeRng(5));
    expect(a).toEqual(b);
  });

  it("returns the only move when forced (no search)", () => {
    // Build any observation; a single-element legal list must come straight back.
    const s = createDeal(2, makeRng(7), 0);
    const obs = observe(s, 0);
    const one = legalMoves(s, 0)[0] as Move;
    expect(fastIsmcts(obs, [one], makeRng(1))).toEqual(one);
  });
});

describe("ismctsBot (v2.2) — runs in a full match", () => {
  it("plays whole deals end-to-end without error", () => {
    const tiny = makeIsmctsBot({ iterations: 30, maxCandidates: 4 });
    const out = playMatch([tiny, randomBot, tiny, randomBot], makeRng(1), 2);
    expect(out.deals).toBeGreaterThan(0);
  }, 30000);
});
