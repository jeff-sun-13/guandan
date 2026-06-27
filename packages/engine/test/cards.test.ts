import { describe, it, expect } from "vitest";
import {
  Suit,
  SMALL_JOKER,
  BIG_JOKER,
  makeCard,
  isJoker,
  cardRank,
  cardSuit,
  isWild,
  singleValue,
  makeDeck,
  cardLabel,
  RANK_A,
} from "../src/cards";

describe("cards — encoding round trips", () => {
  it("makeCard / cardRank / cardSuit are consistent for every normal card", () => {
    for (let rank = 2; rank <= RANK_A; rank++) {
      for (let suit = 0; suit < 4; suit++) {
        const c = makeCard(rank, suit as Suit);
        expect(cardRank(c)).toBe(rank);
        expect(cardSuit(c)).toBe(suit);
        expect(isJoker(c)).toBe(false);
      }
    }
  });

  it("distinct cards have distinct ids (0..51 for normals)", () => {
    const ids = new Set<number>();
    for (let rank = 2; rank <= RANK_A; rank++)
      for (let suit = 0; suit < 4; suit++) ids.add(makeCard(rank, suit as Suit));
    expect(ids.size).toBe(52);
    expect(Math.min(...ids)).toBe(0);
    expect(Math.max(...ids)).toBe(51);
  });

  it("jokers are recognized and have no suit", () => {
    expect(isJoker(SMALL_JOKER)).toBe(true);
    expect(isJoker(BIG_JOKER)).toBe(true);
    expect(cardSuit(SMALL_JOKER)).toBe(-1);
    expect(cardSuit(BIG_JOKER)).toBe(-1);
    expect(cardRank(SMALL_JOKER)).toBe(15);
    expect(cardRank(BIG_JOKER)).toBe(16);
  });

  it("makeCard rejects out-of-range ranks", () => {
    expect(() => makeCard(1, Suit.Clubs)).toThrow();
    expect(() => makeCard(15, Suit.Clubs)).toThrow();
  });
});

describe("cards — wild card (Heart of the level rank)", () => {
  it("only the Heart level card is wild, in both copies", () => {
    const level = 7;
    expect(isWild(makeCard(7, Suit.Hearts), level)).toBe(true);
    // other suits of the level rank are not wild
    expect(isWild(makeCard(7, Suit.Spades), level)).toBe(false);
    expect(isWild(makeCard(7, Suit.Clubs), level)).toBe(false);
    // a heart of a different rank is not wild
    expect(isWild(makeCard(8, Suit.Hearts), level)).toBe(false);
    // jokers are never wild
    expect(isWild(SMALL_JOKER, level)).toBe(false);
    expect(isWild(BIG_JOKER, level)).toBe(false);
  });

  it("the wild moves with the level", () => {
    expect(isWild(makeCard(2, Suit.Hearts), 2)).toBe(true);
    expect(isWild(makeCard(2, Suit.Hearts), 3)).toBe(false);
    expect(isWild(makeCard(RANK_A, Suit.Hearts), RANK_A)).toBe(true);
  });
});

describe("cards — singleValue (level elevation, rules.md §2)", () => {
  it("orders normal cards by face value", () => {
    const level = 9; // pick a level not under test here
    expect(singleValue(makeCard(2, Suit.Clubs), level)).toBe(2);
    expect(singleValue(makeCard(RANK_A, Suit.Clubs), level)).toBe(14);
  });

  it("elevates every copy of the level rank above the Ace, below the jokers", () => {
    const level = 5;
    const fiveValue = singleValue(makeCard(5, Suit.Clubs), level);
    expect(fiveValue).toBe(15);
    expect(fiveValue).toBeGreaterThan(singleValue(makeCard(RANK_A, Suit.Clubs), level));
    // the wild Heart-five is also elevated
    expect(singleValue(makeCard(5, Suit.Hearts), level)).toBe(15);
    // jokers still outrank the level card
    expect(singleValue(SMALL_JOKER, level)).toBe(16);
    expect(singleValue(BIG_JOKER, level)).toBe(17);
    expect(singleValue(BIG_JOKER, level)).toBeGreaterThan(fiveValue);
  });
});

describe("cards — deck", () => {
  it("makeDeck has 108 cards: exactly two of every distinct id", () => {
    const deck = makeDeck();
    expect(deck.length).toBe(108);
    const counts = new Map<number, number>();
    for (const c of deck) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(54); // 52 normals + 2 jokers
    for (const n of counts.values()) expect(n).toBe(2);
  });

  it("has exactly 4 jokers (2 small + 2 big)", () => {
    const deck = makeDeck();
    expect(deck.filter((c) => c === SMALL_JOKER).length).toBe(2);
    expect(deck.filter((c) => c === BIG_JOKER).length).toBe(2);
  });
});

describe("cards — labels", () => {
  it("renders readable labels", () => {
    expect(cardLabel(makeCard(7, Suit.Hearts))).toBe("7H");
    expect(cardLabel(makeCard(RANK_A, Suit.Diamonds))).toBe("AD");
    expect(cardLabel(makeCard(10, Suit.Spades))).toBe("10S");
    expect(cardLabel(SMALL_JOKER)).toBe("sJ");
    expect(cardLabel(BIG_JOKER)).toBe("BJ");
  });
});
