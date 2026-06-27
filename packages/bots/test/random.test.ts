import { describe, it, expect } from "vitest";
import {
  makeRng,
  nextInt,
  createDeal,
  applyMove,
  isTerminal,
  result,
  observe,
  legalMoves,
  type GameState,
  type Move,
} from "@guandan/engine";
import { randomBot, type Bot } from "../src/index";

/**
 * Minimal driver: four bots play one deal to the end. The driver owns the full GameState and
 * only ever hands each bot its own Observation + legal moves (mirrors how the real app/server
 * will run). This is the seed of the future eval harness in tools/.
 */
function playDeal(bots: Bot[], seed: number): GameState {
  const rng = makeRng(seed);
  let s = createDeal(2, rng, nextInt(rng, 4));
  let guard = 0;
  while (!isTerminal(s)) {
    const seat = s.toAct;
    const legal = legalMoves(s, seat);
    const move: Move = (bots[seat] as Bot)(observe(s, seat), legal, rng);
    // the bot must return one of the offered moves
    expect(legal).toContain(move);
    s = applyMove(s, move);
    if (++guard > 100000) throw new Error("deal did not terminate");
  }
  return s;
}

describe("randomBot (v0)", () => {
  it("always returns a legal move", () => {
    const s = createDeal(2, makeRng(3), 0);
    const legal = legalMoves(s, s.toAct);
    const move = randomBot(observe(s, s.toAct), legal, makeRng(99));
    expect(legal).toContain(move);
  });

  it("four random bots complete a full deal with a valid finish order", () => {
    const bots: Bot[] = [randomBot, randomBot, randomBot, randomBot];
    for (let seed = 0; seed < 20; seed++) {
      const s = playDeal(bots, seed);
      const order = result(s);
      expect(order.length).toBe(4);
      expect(new Set(order).size).toBe(4);
    }
  });

  it("is deterministic given the same seed", () => {
    const bots: Bot[] = [randomBot, randomBot, randomBot, randomBot];
    expect(result(playDeal(bots, 7))).toEqual(result(playDeal(bots, 7)));
  });
});
