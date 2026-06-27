import { describe, it, expect } from "vitest";
import {
  makeRng,
  nextInt,
  createDeal,
  applyMove,
  isTerminal,
  legalMoves,
  enumerateCombos,
  beats,
  type GameState,
  type Move,
  type Player,
} from "../src/index";

// The PRE-optimization behavior: enumerate ALL combo types, then (when following) keep pass + the
// ones that beat the top. The optimized legalMoves routes to fewer types + short-circuits bombs;
// this asserts it produces byte-identical output (same moves, same order, same cards), so none of
// the recorded eval results shift.
function oracleLegal(state: GameState, player: Player): Move[] {
  const hand = state.hands[player] ?? [];
  const all = enumerateCombos(hand, state.level); // full enumeration (all types)
  if (!state.trick) return all; // leading
  const top = state.trick.topCombo;
  const out: Move[] = [{ kind: "pass" }];
  for (const m of all) {
    if (m.kind === "play" && beats(m.combo, top)) out.push(m);
  }
  return out;
}

describe("legalMoves — optimized routing is identical to the enumerate-all oracle", () => {
  it("matches the oracle for all seats at every ply of many random deals", () => {
    let leading = 0;
    let following = 0;
    const topTypes = new Set<string>();

    for (let seed = 1; seed <= 40; seed++) {
      const rng = makeRng(seed);
      let s = createDeal(2, rng, nextInt(rng, 4));
      let guard = 0;
      while (!isTerminal(s)) {
        // Check every seat's view (diverse hands against the same trick).
        for (let seat = 0; seat < 4; seat++) {
          expect(legalMoves(s, seat)).toEqual(oracleLegal(s, seat));
        }
        if (s.trick) {
          following++;
          topTypes.add(s.trick.topCombo.type);
        } else {
          leading++;
        }
        const legal = legalMoves(s, s.toAct);
        s = applyMove(s, legal[nextInt(s.rng, legal.length)] as Move);
        if (++guard > 100000) throw new Error("deal did not terminate");
      }
    }

    // Sanity: we actually exercised both modes and a variety of top types.
    expect(leading).toBeGreaterThan(50);
    expect(following).toBeGreaterThan(200);
    expect(topTypes.size).toBeGreaterThanOrEqual(4);
  });
});
