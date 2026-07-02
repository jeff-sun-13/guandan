import { describe, it, expect } from "vitest";
import {
  makeRng,
  createDeal,
  applyMove,
  applyMoveTrusted,
  legalMoves,
  observe,
  isTerminal,
  result,
  teamOf,
  nextInt,
  type GameState,
  type Move,
} from "@guandan/engine";
import { randomBot, dealValue, makeIsmctsBot, playMatch, heuristicBot } from "../src/index";
import { solveEndgame, cardsRemaining } from "../src/endgame";

/** Collect non-terminal states with ≤ maxCards total remaining, from random self-play deals. */
function sampleEndgames(n: number, maxCards: number, seed: number): GameState[] {
  const out: GameState[] = [];
  const rng = makeRng(seed);
  while (out.length < n) {
    let s = createDeal(2 + nextInt(rng, 13), rng);
    while (!isTerminal(s)) {
      if (cardsRemaining(s) <= maxCards && out.length < n) out.push(s);
      const seat = s.toAct;
      s = applyMove(s, randomBot(observe(s, seat), legalMoves(s, seat), rng));
    }
  }
  return out;
}

/** Reference: plain minimax with NO pruning/shortcuts — the oracle alpha-beta must match. */
function plainMinimax(s: GameState): number {
  if (isTerminal(s)) return dealValue(result(s), 0);
  const seat = s.toAct;
  const maximizing = teamOf(seat) === 0;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of legalMoves(s, seat)) {
    const v = plainMinimax(applyMoveTrusted(s, m));
    best = maximizing ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

describe("solveEndgame — exact perfect-info endgame solver", () => {
  it("matches an unpruned minimax oracle on small endgames (pruning is sound)", () => {
    // The load-bearing test: alpha-beta + move ordering + the ±3 early-outs must return EXACTLY
    // the plain-minimax value, or the solver is silently mis-solving.
    const endgames = sampleEndgames(15, 7, 101);
    for (const s of endgames) {
      const solved = solveEndgame(s, { maxNodes: 2_000_000 });
      expect(solved).not.toBeNull();
      expect(solved!.value).toBe(plainMinimax(s));
    }
  });

  it("returns a legal move for the side to act, and is deterministic", () => {
    const endgames = sampleEndgames(10, 10, 202);
    for (const s of endgames) {
      const a = solveEndgame(s, { maxNodes: 5_000_000 });
      const b = solveEndgame(s, { maxNodes: 5_000_000 });
      expect(a).toEqual(b);
      if (a === null) continue; // budget-abort is allowed; correctness is what's asserted
      expect(a.value).toBeGreaterThanOrEqual(-3);
      expect(a.value).toBeLessThanOrEqual(3);
      const legalKeys = legalMoves(s, s.toAct).map((m) => JSON.stringify(m));
      expect(legalKeys).toContain(JSON.stringify(a.move));
    }
  });

  it("playing the solver's move never does worse than the solved value (self-consistency)", () => {
    // Follow the solver's own line to the end: the realized outcome must equal the claimed value
    // when BOTH sides play the solver (it's an equilibrium value of the perfect-info game).
    const endgames = sampleEndgames(6, 8, 303);
    for (let s of endgames) {
      const claimed = solveEndgame(s, { maxNodes: 5_000_000 });
      if (claimed === null) continue;
      let guard = 0;
      while (!isTerminal(s)) {
        const step = solveEndgame(s, { maxNodes: 5_000_000 });
        expect(step).not.toBeNull();
        s = applyMoveTrusted(s, step!.move as Move);
        if (++guard > 200) throw new Error("solver line did not terminate");
      }
      expect(dealValue(result(s), 0)).toBe(claimed.value);
    }
  });

  it("the endgameSolve rollout leaf plays complete matches (integration smoke)", () => {
    // Cheap config: the flag's code path (rollout → ≤8 cards → solved value) must survive a full
    // match without illegal moves or hangs. Strength gating happens on the eval box, not here.
    const bot = makeIsmctsBot({ iterations: 25, rollout: true, endgameSolve: true });
    const out = playMatch([bot, heuristicBot, bot, heuristicBot], makeRng(3), 3);
    expect(out.deals).toBeGreaterThan(0);
  });

  it("handles a terminal input and rejects oversized positions via the budget", () => {
    const rng = makeRng(7);
    let s = createDeal(2, rng);
    // Fresh 108-card deal: must give up under a tiny budget, not hang.
    expect(solveEndgame(s, { maxNodes: 5_000 })).toBeNull();
    while (!isTerminal(s)) {
      const seat = s.toAct;
      s = applyMove(s, randomBot(observe(s, seat), legalMoves(s, seat), rng));
    }
    const t = solveEndgame(s);
    expect(t).not.toBeNull();
    expect(t!.move).toBeNull();
    expect(t!.value).toBe(dealValue(result(s), 0));
  });
});
