import { describe, it, expect } from "vitest";
import { makeRng, createDeal, applyMove, isTerminal, legalMoves, nextInt, type Move } from "@guandan/engine";
import { encodeState, FEATURE_SIZE } from "../src/index";

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
