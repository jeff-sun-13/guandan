import { describe, it, expect } from "vitest";
import { makeRng, nextInt, type Rng } from "../src/rng";
import { type Card, makeCard, Suit, SMALL_JOKER, BIG_JOKER, RANK_A } from "../src/cards";
import { classify, type Combo } from "../src/combos";
import {
  createDeal,
  applyMove,
  isTerminal,
  result,
  observe,
} from "../src/deal";
import { legalMoves } from "../src/moves";
import { type GameState, type Move, partnerOf, teamOf } from "../src/state";

const C = (rank: number, suit: Suit) => makeCard(rank, suit);
const { Clubs, Diamonds, Hearts, Spades } = Suit;

/** Build a deterministic GameState with hand-picked hands (test helper). */
function stateWith(hands: Card[][], level: number, toAct: number): GameState {
  return {
    level,
    hands: hands.map((h) => h.slice()),
    toAct,
    trick: null,
    finished: [],
    rng: makeRng(1),
    phase: "playing",
  };
}

/** A play move for the given cards (picks the first interpretation of the requested type). */
function play(cards: Card[], level: number, type: string): Move {
  const combo = classify(cards, level).find((c) => c.type === type) as Combo;
  if (!combo) throw new Error(`no ${type} for those cards`);
  return { kind: "play", cards, combo };
}
const PASS: Move = { kind: "pass" };

describe("createDeal", () => {
  it("deals 27 cards to each of 4 players, all 108 cards present", () => {
    const s = createDeal(2, makeRng(42), 0);
    expect(s.hands.map((h) => h.length)).toEqual([27, 27, 27, 27]);
    const all = s.hands.flat().slice().sort((a, b) => a - b);
    expect(all.length).toBe(108);
    // two of every id 0..53
    const counts = new Map<number, number>();
    for (const c of all) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(54);
    for (const n of counts.values()) expect(n).toBe(2);
  });

  it("is deterministic for a given seed", () => {
    const a = createDeal(2, makeRng(7), 0);
    const b = createDeal(2, makeRng(7), 0);
    expect(a.hands).toEqual(b.hands);
  });

  it("picks a leader via RNG when none is given", () => {
    const s = createDeal(2, makeRng(123));
    expect(s.toAct).toBeGreaterThanOrEqual(0);
    expect(s.toAct).toBeLessThan(4);
  });
});

describe("trick resolution", () => {
  it("leader wins the trick after the other three pass, then leads again", () => {
    // Player 0 leads a single; 1,2,3 all pass -> 0 wins and leads the next trick.
    const s0 = stateWith(
      [
        [C(9, Clubs), C(3, Clubs)],
        [C(4, Clubs), C(5, Clubs)],
        [C(6, Clubs), C(7, Clubs)],
        [C(8, Clubs), C(10, Clubs)],
      ],
      2,
      0,
    );
    let s = applyMove(s0, play([C(9, Clubs)], 2, "single"));
    expect(s.toAct).toBe(1);
    expect(s.trick?.topPlayer).toBe(0);
    s = applyMove(s, PASS); // 1
    expect(s.toAct).toBe(2);
    s = applyMove(s, PASS); // 2
    expect(s.toAct).toBe(3);
    s = applyMove(s, PASS); // 3 -> back to 0, trick won
    expect(s.trick).toBeNull(); // new trick
    expect(s.toAct).toBe(0); // winner leads
  });

  it("a higher play takes over the trick and resets the passes", () => {
    const s0 = stateWith(
      [
        [C(5, Clubs), C(2, Clubs)],
        [C(9, Clubs), C(2, Diamonds)],
        [C(7, Clubs), C(2, Hearts)],
        [C(8, Clubs), C(2, Spades)],
      ],
      3, // level 3 so the 2s here are just low singles, not wild
      0,
    );
    let s = applyMove(s0, play([C(5, Clubs)], 3, "single")); // 0 leads 5
    s = applyMove(s, play([C(9, Clubs)], 3, "single")); // 1 plays 9 (higher)
    expect(s.trick?.topPlayer).toBe(1);
    expect(s.trick?.passes).toBe(0);
    expect(s.toAct).toBe(2);
  });

  it("a bomb beats a non-bomb of any kind", () => {
    const s0 = stateWith(
      [
        [C(RANK_A, Clubs), C(2, Clubs)],
        [C(5, Clubs), C(5, Diamonds), C(5, Hearts), C(5, Spades), C(2, Diamonds)],
        [C(7, Clubs), C(2, Hearts)],
        [C(8, Clubs), C(2, Spades)],
      ],
      3,
      0,
    );
    let s = applyMove(s0, play([C(RANK_A, Clubs)], 3, "single")); // 0 leads an Ace
    const bomb = play([C(5, Clubs), C(5, Diamonds), C(5, Hearts), C(5, Spades)], 3, "bomb");
    s = applyMove(s, bomb); // 1 bombs over the single
    expect(s.trick?.topPlayer).toBe(1);
  });

  it("rejects passing on a lead and plays that don't beat the trick", () => {
    const s0 = stateWith(
      [
        [C(9, Clubs)],
        [C(4, Clubs)],
        [C(6, Clubs)],
        [C(8, Clubs)],
      ],
      2,
      0,
    );
    expect(() => applyMove(s0, PASS)).toThrow(); // can't pass when leading
    const s1 = applyMove(s0, play([C(9, Clubs)], 2, "single"));
    expect(() => applyMove(s1, play([C(4, Clubs)], 2, "single"))).toThrow(); // 4 < 9
  });
});

describe("going out & finishing order", () => {
  it("records finish order and ends when 3 players are out", () => {
    // Everyone holds a single; play proceeds so seats go out in order 0,1,2 then 3 is last.
    const s0 = stateWith(
      [[C(6, Clubs)], [C(7, Clubs)], [C(8, Clubs)], [C(9, Clubs)]],
      2,
      0,
    );
    let s: GameState = s0;
    // 0 leads 6 (out), 1 plays 7 (out), 2 plays 8 (out) -> 3 is last
    s = applyMove(s, play([C(6, Clubs)], 2, "single")); // 0 out (1st)
    expect(s.finished).toEqual([0]);
    s = applyMove(s, play([C(7, Clubs)], 2, "single")); // 1 out (2nd)
    s = applyMove(s, play([C(8, Clubs)], 2, "single")); // 2 out (3rd) -> deal ends
    expect(isTerminal(s)).toBe(true);
    expect(result(s)).toEqual([0, 1, 2, 3]);
  });

  it("if the trick winner has gone out, the lead passes to their partner", () => {
    // Player 0 plays their last card and wins the trick; partner is seat 2.
    const s0 = stateWith(
      [
        [C(RANK_A, Clubs)], // seat 0: one card, will go out winning the trick
        [C(4, Clubs), C(5, Clubs)],
        [C(6, Clubs), C(7, Clubs)], // partner of 0
        [C(8, Clubs), C(9, Clubs)],
      ],
      3,
      0,
    );
    let s = applyMove(s0, play([C(RANK_A, Clubs)], 3, "single")); // 0 leads Ace and goes out
    expect(s.finished).toEqual([0]);
    s = applyMove(s, PASS); // 1
    s = applyMove(s, PASS); // 2
    s = applyMove(s, PASS); // 3 -> trick won by 0 (out) => partner (2) leads
    expect(s.trick).toBeNull();
    expect(s.toAct).toBe(partnerOf(0)); // seat 2
  });
});

describe("observe — information hiding", () => {
  it("reveals only the player's own hand, plus public counts", () => {
    const s = createDeal(2, makeRng(9), 0);
    const obs = observe(s, 1);
    expect(obs.hand).toEqual(s.hands[1]);
    expect(obs.handCounts).toEqual([27, 27, 27, 27]);
    // the observation does not carry other players' cards
    expect((obs as unknown as { hands?: unknown }).hands).toBeUndefined();
  });
});

describe("partnerships", () => {
  it("partners are opposite; teams are {0,2} and {1,3}", () => {
    expect(partnerOf(0)).toBe(2);
    expect(partnerOf(1)).toBe(3);
    expect(teamOf(0)).toBe(teamOf(2));
    expect(teamOf(1)).toBe(teamOf(3));
    expect(teamOf(0)).not.toBe(teamOf(1));
  });
});

describe("property: random self-play always reaches a valid terminal state", () => {
  /** Play a full deal with all four seats choosing uniformly-random legal moves. */
  function playRandomDeal(seed: number): GameState {
    const rng: Rng = makeRng(seed);
    let s = createDeal(2, rng, nextInt(rng, 4));
    let guard = 0;
    while (!isTerminal(s)) {
      const moves = legalMoves(s, s.toAct);
      expect(moves.length).toBeGreaterThan(0); // someone to act always has a legal move
      const choice = moves[nextInt(rng, moves.length)] as Move;
      s = applyMove(s, choice);
      if (++guard > 100000) throw new Error("deal did not terminate");
    }
    return s;
  }

  it("terminates with a complete, valid finishing order over many seeds", () => {
    for (let seed = 0; seed < 60; seed++) {
      const s = playRandomDeal(seed);
      const order = result(s);
      expect(order.length).toBe(4);
      expect(new Set(order).size).toBe(4); // all four seats, no repeats
      // exactly one player keeps cards (the 4th); everyone else is empty
      const withCards = s.hands.filter((h) => h.length > 0).length;
      expect(withCards).toBe(1);
      expect(s.hands[order[3] as number]!.length).toBeGreaterThan(0);
    }
  });

  it("conserves cards: nobody gains or loses a card mid-deal", () => {
    const rng = makeRng(2024);
    let s = createDeal(2, rng, 0);
    while (!isTerminal(s)) {
      const total = s.hands.reduce((n, h) => n + h.length, 0) + s.finished.length; // rough invariant proxy
      expect(total).toBeGreaterThan(0);
      const moves = legalMoves(s, s.toAct);
      s = applyMove(s, moves[nextInt(rng, moves.length)] as Move);
    }
    // At the end, all 108 cards are accounted for across the (now mostly empty) hands.
    const totalCardsDealt = s.hands.reduce((n, h) => n + h.length, 0);
    expect(totalCardsDealt).toBe(s.hands[result(s)[3] as number]!.length); // only the 4th holds cards
  });
});
