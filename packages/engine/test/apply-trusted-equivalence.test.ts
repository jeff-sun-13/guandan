import { describe, it, expect } from "vitest";
import {
  makeRng,
  nextInt,
  createDeal,
  applyMove,
  applyMoveTrusted,
  observe,
  isTerminal,
  legalMoves,
  type Move,
} from "../src/index";

// `applyMoveTrusted` skips the combo re-validation + `beats` check that `applyMove` runs, for moves
// already known legal (the rollout hot path). It MUST otherwise be byte-identical, or recorded eval
// results would silently shift. This replays many random deals and, at every ply, asserts the trusted
// and checked transitions produce deep-equal states for the move actually taken. Also checks the lean
// `observe({ includeOutOfPlay: false })` fast-path matches the full observation save for `outOfPlay`.
describe("applyMoveTrusted — identical to applyMove for legal moves", () => {
  it("produces deep-equal next states at every ply of many random deals", () => {
    let plays = 0;
    let passes = 0;

    for (let seed = 1; seed <= 50; seed++) {
      const rng = makeRng(seed);
      let s = createDeal(2, rng, nextInt(rng, 4));
      let guard = 0;
      while (!isTerminal(s)) {
        const legal = legalMoves(s, s.toAct);
        const move = legal[nextInt(s.rng, legal.length)] as Move;

        // The core claim: trusted == checked, for this legal move.
        expect(applyMoveTrusted(s, move)).toEqual(applyMove(s, move));
        if (move.kind === "pass") passes++;
        else plays++;

        // Lean observe == full observe except outOfPlay is dropped to [].
        for (let seat = 0; seat < 4; seat++) {
          const full = observe(s, seat);
          const lean = observe(s, seat, { includeOutOfPlay: false });
          expect(lean.outOfPlay).toEqual([]);
          expect({ ...lean, outOfPlay: full.outOfPlay }).toEqual(full);
        }

        s = applyMove(s, move);
        if (++guard > 100000) throw new Error("deal did not terminate");
      }
    }

    // Sanity: we actually exercised both plays and passes.
    expect(plays).toBeGreaterThan(100);
    expect(passes).toBeGreaterThan(50);
  });

  it("does not mutate the input state (purity)", () => {
    const rng = makeRng(7);
    const s = createDeal(2, rng, 0);
    const before = JSON.stringify(s);
    const legal = legalMoves(s, s.toAct);
    applyMoveTrusted(s, legal[0] as Move);
    expect(JSON.stringify(s)).toEqual(before);
  });
});
