import { describe, it, expect } from "vitest";
import { makeRng, nextInt, type Rng } from "../src/rng";
import { type Card, BIG_JOKER } from "../src/cards";
import {
  createDeal,
  applyMove,
  isTerminal,
  observe,
  outOfPlayCards,
} from "../src/deal";
import { legalMoves } from "../src/moves";
import { determinize } from "../src/determinize";
import { type GameState, type Move } from "../src/state";

/** Play `steps` random legal moves (or until the deal ends). */
function advance(s: GameState, steps: number, rng: Rng): GameState {
  for (let i = 0; i < steps && !isTerminal(s); i++) {
    const legal = legalMoves(s, s.toAct);
    s = applyMove(s, legal[nextInt(rng, legal.length)] as Move);
  }
  return s;
}

/** Count every card id across the given hands/arrays; returns Map id -> count. */
function countCards(...lists: Card[][]): Map<number, number> {
  const m = new Map<number, number>();
  for (const list of lists) for (const c of list) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

describe("outOfPlayCards / observe.outOfPlay", () => {
  it("is empty at the start of a deal (nothing played yet)", () => {
    const s = createDeal(2, makeRng(1), 0);
    expect(outOfPlayCards(s.hands)).toEqual([]);
    expect(observe(s, 0).outOfPlay).toEqual([]);
  });

  it("equals exactly the cards that have left all hands", () => {
    const s0 = createDeal(2, makeRng(5), 0);
    const before = countCards(...s0.hands);
    const s1 = advance(s0, 12, makeRng(99));
    const after = countCards(...s1.hands);

    // Reconstruct what's missing from hands and compare to outOfPlay.
    const expected: Card[] = [];
    for (let id = 0; id <= BIG_JOKER; id++) {
      const gone = (before.get(id) ?? 0) - (after.get(id) ?? 0);
      for (let k = 0; k < gone; k++) expected.push(id);
    }
    const out = outOfPlayCards(s1.hands).slice().sort((a, b) => a - b);
    expect(out).toEqual(expected.sort((a, b) => a - b));
  });

  it("hand + outOfPlay always accounts for the full deck per seat's view", () => {
    const s = advance(createDeal(2, makeRng(8), 0), 20, makeRng(8));
    const obs = observe(s, s.toAct === -1 ? 0 : s.toAct);
    // For one observer: their hand + everyone else's (unknown) + outOfPlay = full deck.
    // We can at least check hand + outOfPlay never double-counts beyond the deck.
    const counts = countCards(obs.hand, obs.outOfPlay);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2);
  });
});

describe("determinize", () => {
  it("preserves the observer's own hand exactly", () => {
    const s = advance(createDeal(2, makeRng(11), 0), 15, makeRng(11));
    const me = s.toAct;
    const obs = observe(s, me);
    const d = determinize(obs, makeRng(123));
    expect((d.hands[me] as Card[]).slice().sort((a, b) => a - b)).toEqual(
      obs.hand.slice().sort((a, b) => a - b),
    );
  });

  it("matches every seat's known card count", () => {
    const s = advance(createDeal(2, makeRng(12), 0), 18, makeRng(77));
    const me = s.toAct;
    const obs = observe(s, me);
    const d = determinize(obs, makeRng(7));
    expect(d.hands.map((h) => h.length)).toEqual(obs.handCounts);
  });

  it("produces a full, valid deck: all hands + outOfPlay = two of every id", () => {
    const s = advance(createDeal(2, makeRng(13), 0), 22, makeRng(33));
    const me = s.toAct;
    const obs = observe(s, me);
    const d = determinize(obs, makeRng(55));
    const counts = countCards(...d.hands, obs.outOfPlay);
    expect(counts.size).toBe(54);
    for (const n of counts.values()) expect(n).toBe(2);
  });

  it("is deterministic for a given RNG seed", () => {
    const s = advance(createDeal(2, makeRng(14), 0), 16, makeRng(14));
    const obs = observe(s, s.toAct);
    const a = determinize(obs, makeRng(900));
    const b = determinize(obs, makeRng(900));
    expect(a.hands).toEqual(b.hands);
  });

  it("is faithful to the observer's legal moves (same hand + trick)", () => {
    const s = advance(createDeal(2, makeRng(15), 0), 19, makeRng(15));
    const me = s.toAct;
    const obs = observe(s, me);
    const d = determinize(obs, makeRng(1));
    // The observer's view of their own options must be identical in the sampled world.
    expect(legalMoves(d, me)).toEqual(legalMoves(s, me));
  });

  it("yields a playable state that rolls out to a valid finish", () => {
    const s = advance(createDeal(2, makeRng(16), 0), 14, makeRng(16));
    const obs = observe(s, s.toAct);
    let d = determinize(obs, makeRng(2));
    d = advance(d, 1000, makeRng(2)); // play to completion
    expect(isTerminal(d)).toBe(true);
    expect(d.finished.slice().sort()).toEqual([0, 1, 2, 3]);
  });

  it("throws on an inconsistent observation (bad handCounts)", () => {
    const s = createDeal(2, makeRng(17), 0);
    const obs = observe(s, 0);
    const bad = { ...obs, handCounts: [27, 26, 27, 27] }; // one card too few
    expect(() => determinize(bad, makeRng(1))).toThrow();
  });
});
