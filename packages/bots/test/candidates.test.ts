import { describe, it, expect } from "vitest";
import { makeCard, makeRng, isBomb, Suit, type GameState, type Card } from "@guandan/engine";
import { candidatesAt } from "../src/ismcts";

/**
 * A wide leading hand: a 4×5 bomb + every rank as singles/pairs, so `legalMoves` emits well over
 * 20 plays (13+ singles, pairs, straights, the bomb). This is the shape every 27-card hand has
 * early in a deal — exactly where the old cheapest-only cap silently pruned all bombs/top cards.
 */
function wideState(): GameState {
  const hand: Card[] = [];
  for (const suit of [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades]) hand.push(makeCard(5, suit));
  for (let rank = 2; rank <= 14; rank++) {
    hand.push(makeCard(rank, Suit.Clubs));
    if (rank !== 5) hand.push(makeCard(rank, Suit.Diamonds)); // pairs at every rank but the bomb's
  }
  // 4 + 13 + 12 = 29 cards — slightly over a real hand, fine for a move-generation test.
  return {
    level: 2,
    hands: [hand, [makeCard(3, Suit.Spades)], [makeCard(4, Suit.Spades)], [makeCard(6, Suit.Spades)]],
    toAct: 0,
    trick: null,
    finished: [],
    rng: makeRng(1),
    phase: "playing",
  };
}

describe("candidatesAt trimming schemes", () => {
  it("cheapest scheme drops every bomb at a wide leading node (the documented bias)", () => {
    // Not a desired behavior — this pins down WHY the perType scheme exists. If this ever fails,
    // the bias is gone and the perType A/B rationale should be re-examined.
    const moves = candidatesAt(wideState(), 0, 20, "cheapest");
    const bombs = moves.filter((m) => m.kind === "play" && isBomb(m.combo.type));
    expect(moves.length).toBeLessThanOrEqual(20);
    expect(bombs).toHaveLength(0);
  });

  it("perType scheme keeps the bomb AND the top single searchable under the same cap", () => {
    const moves = candidatesAt(wideState(), 0, 20, "perType");
    expect(moves.length).toBeLessThanOrEqual(20);
    const bombs = moves.filter((m) => m.kind === "play" && isBomb(m.combo.type));
    expect(bombs.length).toBeGreaterThan(0);
    // The control lead: the highest single (the ace, rank 14 at level 2) must be present.
    const singles = moves.filter((m) => m.kind === "play" && m.combo.type === "single");
    const topSingleRank = Math.max(...singles.map((m) => (m.kind === "play" ? m.combo.rank : 0)));
    expect(topSingleRank).toBeGreaterThanOrEqual(14);
  });

  it("perType still covers each combo type with at least its cheapest play under a tight cap", () => {
    const wide = candidatesAt(wideState(), 0, 40, "perType");
    const tight = candidatesAt(wideState(), 0, 12, "perType");
    const types = (ms: typeof wide) => new Set(ms.filter((m) => m.kind === "play").map((m) => (m.kind === "play" ? m.combo.type : "")));
    // Every type that survives ANY cap is exactly the full type set — coverage before depth.
    expect(types(tight)).toEqual(types(wide));
  });

  it("both schemes agree when the hand is narrow (no trimming needed)", () => {
    const s = wideState();
    (s.hands[0] as Card[]).length = 6; // keep just the first 6 cards — few moves
    const a = candidatesAt(s, 0, 20, "cheapest");
    const b = candidatesAt(s, 0, 20, "perType");
    expect(b).toEqual(a);
  });
});
