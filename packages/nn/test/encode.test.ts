import { describe, it, expect } from "vitest";
import {
  makeRng,
  createDeal,
  applyMove,
  isTerminal,
  legalMoves,
  nextInt,
  makeCard,
  Suit,
  type Move,
  type GameState,
  type Card,
} from "@guandan/engine";
import { encodeState, FEATURE_SIZE } from "../src/index";

/** Hand-built state for targeted feature checks (seat 0 to act, leading). */
function stateWithHand(hand: Card[], level = 2): GameState {
  return {
    level,
    hands: [hand, [makeCard(3, Suit.Spades)], [makeCard(4, Suit.Spades)], [makeCard(6, Suit.Spades)]],
    toAct: 0,
    trick: null,
    finished: [],
    rng: makeRng(1),
    phase: "playing",
  };
}

// v3 layout offsets (keep in sync with encode.ts).
const STRUCT_BASE = 60 + 34; // hand block + global block
const STRUCT_PER_SEAT = 11;

describe("encodeState", () => {
  it("returns a fixed-length vector and is deterministic", () => {
    const s = createDeal(2, makeRng(1), 0);
    const a = encodeState(s, 0);
    const b = encodeState(s, 0);
    expect(a.length).toBe(FEATURE_SIZE);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("counts all cards (each seat's rank counts sum to its hand size)", () => {
    const s = createDeal(2, makeRng(5), 0);
    const f = encodeState(s, 0);
    // Each seat's 15-slot block should sum to 27 at the start of a deal.
    for (let seat = 0; seat < 4; seat++) {
      let sum = 0;
      for (let k = 0; k < 15; k++) sum += f[seat * 15 + k]!;
      expect(sum).toBe(27);
    }
  });

  it("encodes the to-act seat as exactly one bit while the deal is live", () => {
    const s = createDeal(2, makeRng(3), 1);
    const f = encodeState(s, 0);
    const toActBlock = Array.from(f.slice(60 + 1, 60 + 1 + 4)); // after 60 hand + 1 level
    expect(toActBlock.filter((x) => x === 1).length).toBe(1);
  });

  it("is team-relative: our-team blocks come first for whichever team we score", () => {
    // Seat 0 (team 0) vs seat 1 (team 1): encoding for team 0 puts seat 0's hand in block 0;
    // encoding for team 1 puts seat 1's hand in block 0. So the two should differ at the start.
    const s = createDeal(2, makeRng(9), 0);
    const f0 = encodeState(s, 0);
    const f1 = encodeState(s, 1);
    // Block 0 for team0 = seat 0's counts; for team1 = seat 1's counts. Different hands ⇒ differ.
    const block0t0 = Array.from(f0.slice(0, 15));
    const block0t1 = Array.from(f1.slice(0, 15));
    expect(block0t0).not.toEqual(block0t1);
  });

  it("v3: encodes WHO holds the trick top (relative seat one-hot)", () => {
    const rng = makeRng(7);
    let s = createDeal(2, rng, nextInt(rng, 4));
    let guard = 0;
    while (!isTerminal(s) && !s.trick && ++guard < 50) {
      s = applyMove(s, legalMoves(s, s.toAct)[0] as Move);
    }
    expect(s.trick).not.toBeNull();
    const f = encodeState(s, 0);
    // Trick block starts after 60 hand + 1 level + 4 toAct; topPlayer one-hot at +13, leader at +17.
    const trickBase = 60 + 1 + 4;
    const topHot = Array.from(f.slice(trickBase + 13, trickBase + 17));
    const leadHot = Array.from(f.slice(trickBase + 17, trickBase + 21));
    expect(topHot.filter((x) => x === 1)).toHaveLength(1);
    expect(leadHot.filter((x) => x === 1)).toHaveLength(1);
  });

  it("v3: sees a wild-completed bomb (2 naturals + 2 wilds) that the natural census misses", () => {
    // Level 2 ⇒ wild = Heart 2. Hand: two natural 9s + both wild hearts + filler.
    const hand = [
      makeCard(9, Suit.Clubs),
      makeCard(9, Suit.Spades),
      makeCard(2, Suit.Hearts),
      makeCard(2, Suit.Hearts),
      makeCard(5, Suit.Clubs),
    ];
    const f = encodeState(stateWithHand(hand), 0);
    const seat0 = STRUCT_BASE; // struct block, our seat A = seat 0 for team 0
    expect(f[seat0 + 1]).toBe(0); // no NATURAL bomb...
    expect(f[seat0 + 8]).toBeGreaterThan(0); // ...but wild-bomb options exist
    expect(f[seat0 + 7]).toBeGreaterThan(0); // and biggest makeable bomb is non-zero
  });

  it("v3: run structure — a 6-long natural run registers length and >=5-run coverage", () => {
    const hand = [3, 4, 5, 6, 7, 8].map((r) => makeCard(r, Suit.Clubs));
    const f = encodeState(stateWithHand(hand), 0);
    const seat0 = STRUCT_BASE;
    expect(f[seat0 + 9]).toBeCloseTo(6 / 13, 5); // longest run = 6 ranks
    expect(f[seat0 + 10]).toBeCloseTo(6 / 13, 5); // all 6 ranks sit in a >=5 run
    // A broken shape has neither.
    const broken = [2, 4, 6, 8, 10, 12].map((r) => makeCard(r, Suit.Clubs));
    const g = encodeState(stateWithHand(broken), 0);
    expect(g[seat0 + 9]).toBeCloseTo(1 / 13, 5);
    expect(g[seat0 + 10]).toBe(0);
  });

  it("encodes a sane vector mid-deal (following a trick) with no NaNs", () => {
    const rng = makeRng(7);
    let s = createDeal(2, rng, nextInt(rng, 4));
    let guard = 0;
    while (!isTerminal(s) && !s.trick && ++guard < 50) {
      s = applyMove(s, legalMoves(s, s.toAct)[0] as Move);
    }
    const f = encodeState(s, 0);
    expect(f.length).toBe(FEATURE_SIZE);
    expect(Array.from(f).some((x) => Number.isNaN(x))).toBe(false);
  });
});
