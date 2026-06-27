import { describe, it, expect } from "vitest";
import {
  makeRng,
  nextInt,
  createDeal,
  observe,
  legalMoves,
  applyMove,
  isTerminal,
  type Observation,
} from "@guandan/engine";
import { makeBeliefSampler, currentTrickPassers, randomBot } from "../src/index";

// Minimal hand-built observation for the passer-derivation logic (only trick/toAct/finished matter).
function obsWith(over: Partial<Observation>): Observation {
  return {
    level: 2,
    player: 0,
    hand: [],
    handCounts: [1, 1, 1, 1],
    outOfPlay: [],
    trick: null,
    toAct: 0,
    finished: [],
    phase: "playing",
    ...over,
  } as Observation;
}
const single = (rank: number) => ({ type: "single", rank, length: 1 }) as any;

describe("currentTrickPassers", () => {
  it("returns the consecutive passers right before toAct (in walk-back order)", () => {
    // topPlayer 1 holds the top; seats 2 and 3 then passed; seat 0 to act.
    const obs = obsWith({
      trick: { leader: 1, topCombo: single(5), topPlayer: 1, passes: 2 },
      toAct: 0,
    });
    expect(currentTrickPassers(obs)).toEqual([3, 2]); // walk back from 0: 3, then 2
  });

  it("is empty when leading (no trick)", () => {
    expect(currentTrickPassers(obsWith({ trick: null }))).toEqual([]);
  });

  it("skips finished seats while walking back", () => {
    // Seat 3 is out; after topPlayer 1 the only active passer before seat 0 is seat 2.
    const obs = obsWith({
      handCounts: [1, 1, 1, 0],
      finished: [3],
      trick: { leader: 1, topCombo: single(5), topPlayer: 1, passes: 1 },
      toAct: 0,
    });
    expect(currentTrickPassers(obs)).toEqual([2]); // (0→3 finished, skip →2)
  });
});

describe("makeBeliefSampler", () => {
  const sampler = makeBeliefSampler();

  it("falls back to a valid world when leading (no passers)", () => {
    const s = createDeal(2, makeRng(11), 0);
    const obs = observe(s, 0);
    expect(obs.trick).toBeNull();
    const w = sampler(obs, makeRng(3));
    expect(w.hands[0]!.slice().sort()).toEqual(obs.hand.slice().sort()); // my hand preserved
    for (let p = 0; p < 4; p++) expect(w.hands[p]!.length).toBe(obs.handCounts[p]); // counts match
  });

  it("produces a valid world mid-trick (with passers to condition on)", () => {
    // Drive a deal with random bots until the seat to act faces a trick that has passes — then the
    // belief path is exercised. Assert the sampled world is still card-consistent with the obs.
    const rng = makeRng(7);
    let s = createDeal(2, rng, nextInt(rng, 4));
    let found: Observation | null = null;
    let guard = 0;
    while (!isTerminal(s) && ++guard < 5000) {
      const obs = observe(s, s.toAct);
      if (obs.trick && obs.trick.passes > 0) {
        found = obs;
        break;
      }
      s = applyMove(s, randomBot(observe(s, s.toAct), legalMoves(s, s.toAct), rng));
    }
    expect(found).not.toBeNull();
    const obs = found as Observation;
    expect(currentTrickPassers(obs).length).toBeGreaterThan(0);
    const w = sampler(obs, makeRng(9));
    expect(w.hands[obs.player]!.slice().sort()).toEqual(obs.hand.slice().sort());
    for (let p = 0; p < 4; p++) expect(w.hands[p]!.length).toBe(obs.handCounts[p]);
  });
});
