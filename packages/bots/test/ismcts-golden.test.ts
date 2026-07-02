import { describe, it, expect } from "vitest";
import { makeRng, createDeal, applyMove, legalMoves, observe, isTerminal, type Move } from "@guandan/engine";
import { makeIsmctsBot } from "../src/index";

/**
 * Behavior pin for refactors of the ISMCTS internals (2026-07-01, added before extracting
 * `ismctsSearch` for policy distillation). Plays fixed-seed deals with a small ISMCTS config and
 * fingerprints the exact move sequence. Any refactor that changes rng consumption order, candidate
 * ordering, or selection logic breaks this test — which is the point: "output-identical" must be
 * PROVEN, not assumed (cf. the legalMoves optimization's equivalence test, changelog 2026-06-26).
 * If you change search behavior ON PURPOSE, update the fingerprints in the same commit and say so.
 */
function fingerprint(seed: number): string {
  const bot = makeIsmctsBot({ iterations: 60 }); // small but past the forced-move shortcut
  const rng = makeRng(seed);
  let s = createDeal(2, rng, 0);
  const parts: string[] = [];
  let guard = 0;
  while (!isTerminal(s) && ++guard < 400) {
    const seat = s.toAct;
    const legal = legalMoves(s, seat);
    const m: Move = seat === 0 ? bot(observe(s, seat), legal, rng) : (legal[0] as Move);
    parts.push(m.kind === "pass" ? "P" : `${m.combo.type}:${m.combo.rank}:${m.combo.length}`);
    s = applyMove(s, m);
  }
  return parts.join("|");
}

describe("ISMCTS golden fingerprints (refactor guard)", () => {
  it("fixed-seed play is byte-identical across refactors", () => {
    // Recorded 2026-07-01 on the pre-ismctsSearch-extraction code. See docstring before touching.
    expect(fingerprint(11)).toMatchSnapshot();
    expect(fingerprint(23)).toMatchSnapshot();
  });
});
