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
import { makePimcBot, randomBot, playMatch, staticLeaf, pimcStaticBot } from "../src/index";

// A fast PIMC config for tests (few worlds, tight candidate cap) — keeps these quick.
const fastPimc = makePimcBot({ determinizations: 3, maxCandidates: 5 });

describe("pimcBot (v2.0) — legality", () => {
  it("only ever returns legal moves over a full deal", () => {
    const rng = makeRng(3);
    let s = createDeal(2, rng, nextInt(rng, 4));
    let guard = 0;
    while (!isTerminal(s)) {
      const seat = s.toAct;
      const legal = legalMoves(s, seat);
      const move: Move = fastPimc(observe(s, seat), legal, rng);
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
    const a = fastPimc(obs, legal, makeRng(5));
    const b = fastPimc(obs, legal, makeRng(5));
    expect(a).toEqual(b);
  });
});

describe("pimcBot (v2.0) — runs in a full match", () => {
  it("plays whole deals end-to-end without error", () => {
    // A few deals against random — a smoke test that search drives a real match.
    const tiny = makePimcBot({ determinizations: 2, maxCandidates: 4 });
    const out = playMatch([tiny, randomBot, tiny, randomBot], makeRng(1), 2);
    expect(out.deals).toBeGreaterThan(0);
  }, 30000);
});

describe("pimcStaticBot (v2.1) — static leaf", () => {
  it("only ever returns legal moves over a full deal", () => {
    const rng = makeRng(4);
    let s = createDeal(2, rng, nextInt(rng, 4));
    let guard = 0;
    while (!isTerminal(s)) {
      const seat = s.toAct;
      const legal = legalMoves(s, seat);
      const move: Move = pimcStaticBot(observe(s, seat), legal, rng);
      expect(legal).toContainEqual(move);
      s = applyMove(s, move);
      if (++guard > 100000) throw new Error("did not terminate");
    }
    expect(s.finished.slice().sort()).toEqual([0, 1, 2, 3]);
  });

  it("the static leaf is cheap enough to run a big-K config end-to-end", () => {
    const big = makePimcBot({ leaf: staticLeaf, determinizations: 200, maxCandidates: 24 });
    const out = playMatch([big, randomBot, big, randomBot], makeRng(2), 2);
    expect(out.deals).toBeGreaterThan(0);
  }, 30000);
});
