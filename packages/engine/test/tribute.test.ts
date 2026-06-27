import { describe, it, expect } from "vitest";
import { makeCard, Suit, BIG_JOKER, type Card } from "../src/cards";
import {
  highestTributeCard,
  planTribute,
  defaultReturnCard,
} from "../src/tribute";

const C = (rank: number, suit: Suit) => makeCard(rank, suit);
const { Clubs, Diamonds, Hearts, Spades } = Suit;

describe("highestTributeCard", () => {
  it("picks the highest single, excluding the wild", () => {
    const level = 2; // wild = 2 of Hearts
    const hand = [C(2, Hearts), C(5, Clubs), C(13, Diamonds), C(8, Spades)];
    expect(highestTributeCard(hand, level)).toBe(C(13, Diamonds)); // K, not the wild
  });
  it("a big joker can be the tribute card (it isn't wild)", () => {
    const hand = [C(5, Clubs), BIG_JOKER, C(9, Spades)];
    expect(highestTributeCard(hand, 7)).toBe(BIG_JOKER);
  });
});

describe("planTribute — single tribute (1-3 / 1-4)", () => {
  it("last place pays first place and leads", () => {
    const level = 5;
    const hands: Card[][] = [
      [C(3, Clubs)], // seat 0 (1st)
      [C(4, Clubs)], // seat 1
      [C(6, Clubs)], // seat 2
      [C(9, Diamonds), C(2, Clubs)], // seat 3 (last) -> pays its highest (9)
    ];
    const plan = planTribute([0, 1, 2, 3], hands, level); // team0 1-3
    expect(plan.cancelled).toBe(false);
    expect(plan.tributes).toEqual([{ payer: 3, receiver: 0, card: C(9, Diamonds) }]);
    expect(plan.leader).toBe(3);
  });

  it("anti-tribute: last place holding both big jokers cancels it; 1st leads", () => {
    const hands: Card[][] = [
      [C(3, Clubs)],
      [C(4, Clubs)],
      [C(6, Clubs)],
      [BIG_JOKER, BIG_JOKER],
    ];
    const plan = planTribute([0, 1, 2, 3], hands, 5);
    expect(plan.cancelled).toBe(true);
    expect(plan.tributes).toEqual([]);
    expect(plan.leader).toBe(0);
  });
});

describe("planTribute — double down (winners 1-2)", () => {
  it("both losers pay; higher card to 1st, the other to the partner; higher payer leads", () => {
    const level = 7;
    // finish [0,2,1,3]: team0 took 1st & 2nd; losers are seats 1 and 3.
    const hands: Card[][] = [
      [C(5, Clubs)], // 0 (1st)
      [C(13, Clubs), C(3, Clubs)], // 1 -> highest K
      [C(6, Clubs)], // 2 (2nd, partner of 0)
      [C(14, Diamonds), C(4, Clubs)], // 3 -> highest A (higher than K)
    ];
    const plan = planTribute([0, 2, 1, 3], hands, level);
    expect(plan.cancelled).toBe(false);
    expect(plan.tributes).toEqual([
      { payer: 3, receiver: 0, card: C(14, Diamonds) }, // higher (A) to 1st
      { payer: 1, receiver: 2, card: C(13, Clubs) }, // other (K) to the partner
    ]);
    expect(plan.leader).toBe(3); // payer of the higher card
  });

  it("anti-tribute: the two losers holding both big jokers cancels it", () => {
    const hands: Card[][] = [
      [C(5, Clubs)],
      [BIG_JOKER, C(3, Clubs)],
      [C(6, Clubs)],
      [BIG_JOKER, C(4, Clubs)],
    ];
    const plan = planTribute([0, 2, 1, 3], hands, 7);
    expect(plan.cancelled).toBe(true);
    expect(plan.leader).toBe(0);
  });
});

describe("defaultReturnCard", () => {
  it("returns the lowest-value card that isn't the received tribute card", () => {
    const level = 9;
    // received the K as tribute; should hand back the lowest other card (the 3).
    const hand = [C(13, Clubs), C(3, Clubs), C(8, Diamonds)];
    expect(defaultReturnCard(hand, C(13, Clubs), level)).toBe(C(3, Clubs));
  });

  it("does not return the exact tribute card even if it's the lowest", () => {
    const level = 9;
    // two 4s; one is the received tribute card -> must return something else.
    const hand = [C(4, Clubs), C(4, Diamonds), C(7, Spades)];
    const back = defaultReturnCard(hand, C(4, Clubs), level);
    expect(back).not.toBe(C(4, Clubs)); // skipped one copy of the tribute card
  });
});
