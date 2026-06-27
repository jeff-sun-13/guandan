import { describe, it, expect } from "vitest";
import {
  Suit,
  makeCard,
  SMALL_JOKER,
  BIG_JOKER,
  type Card,
  RANK_A,
} from "../src/cards";
import {
  classify,
  beats,
  isLegalCombo,
  isBomb,
  type Combo,
  type ComboType,
} from "../src/combos";

// --- tiny builders to keep tests readable ---
const C = (rank: number, suit: Suit): Card => makeCard(rank, suit);
const { Clubs, Diamonds, Hearts, Spades } = Suit;

/** classify and return the (first) interpretation of a given type, or undefined. */
function as(cards: Card[], level: number, type: ComboType): Combo | undefined {
  return classify(cards, level).find((c) => c.type === type);
}
/** the set of types classify produced */
function types(cards: Card[], level: number): Set<ComboType> {
  return new Set(classify(cards, level).map((c) => c.type));
}

describe("combos — basic families", () => {
  it("single", () => {
    const c = as([C(7, Clubs)], 2, "single")!;
    expect(c).toBeDefined();
    expect(c.rank).toBe(7);
    expect(c.length).toBe(1);
  });

  it("pair / triple / full house", () => {
    expect(as([C(9, Clubs), C(9, Spades)], 2, "pair")?.rank).toBe(9);
    expect(as([C(9, Clubs), C(9, Spades), C(9, Hearts)], 2, "triple")?.rank).toBe(9);
    const fh = as(
      [C(9, Clubs), C(9, Spades), C(9, Hearts), C(4, Clubs), C(4, Diamonds)],
      2,
      "fullHouse",
    )!;
    expect(fh.rank).toBe(9); // compared by the triple
  });

  it("rejects non-combos", () => {
    expect(isLegalCombo([C(2, Clubs), C(3, Clubs), C(5, Clubs)], 7)).toBe(false);
    expect(classify([C(9, Clubs), C(8, Spades)], 2)).toEqual([]); // mismatched pair
  });
});

describe("combos — straights (Ace high or low, no wrap)", () => {
  it("A-low straight ranks as 5 (the weakest straight)", () => {
    const lo = as(
      [C(RANK_A, Clubs), C(2, Clubs), C(3, Clubs), C(4, Clubs), C(5, Diamonds)],
      7,
      "straight",
    )!;
    expect(lo.rank).toBe(5);
  });

  it("A-high straight (10-J-Q-K-A) ranks as A", () => {
    const hi = as(
      [C(10, Clubs), C(11, Clubs), C(12, Clubs), C(13, Clubs), C(RANK_A, Diamonds)],
      7,
      "straight",
    )!;
    expect(hi.rank).toBe(RANK_A);
  });

  it("does NOT wrap around the ace (Q-K-A-2-3 is illegal)", () => {
    const cards = [C(12, Clubs), C(13, Clubs), C(RANK_A, Clubs), C(2, Diamonds), C(3, Diamonds)];
    expect(types(cards, 7).has("straight")).toBe(false);
    expect(isLegalCombo(cards, 7)).toBe(false);
  });

  it("higher straight beats lower; A-2-3-4-5 < 2-3-4-5-6", () => {
    const aLow = as(
      [C(RANK_A, Clubs), C(2, Clubs), C(3, Clubs), C(4, Clubs), C(5, Clubs)],
      7,
      "straight",
    )!;
    const twoSix = as(
      [C(2, Spades), C(3, Spades), C(4, Spades), C(5, Spades), C(6, Spades)],
      7,
      "straight",
    )!;
    expect(beats(twoSix, aLow)).toBe(true);
    expect(beats(aLow, twoSix)).toBe(false);
  });

  it("tube (3 consecutive pairs) and plate (2 consecutive triples)", () => {
    const tube = as(
      [C(7, Clubs), C(7, Spades), C(8, Clubs), C(8, Spades), C(9, Clubs), C(9, Spades)],
      2,
      "tube",
    )!;
    expect(tube.rank).toBe(9);
    const plate = as(
      [C(8, Clubs), C(8, Spades), C(8, Hearts), C(9, Clubs), C(9, Spades), C(9, Hearts)],
      2,
      "plate",
    )!;
    expect(plate.rank).toBe(9);
  });
});

describe("combos — level elevation (rules.md §2)", () => {
  it("a pair of the level rank beats a pair of aces", () => {
    const level = 5;
    const pairFives = as([C(5, Clubs), C(5, Spades)], level, "pair")!;
    const pairAces = as([C(RANK_A, Clubs), C(RANK_A, Spades)], level, "pair")!;
    expect(pairFives.rank).toBe(15);
    expect(beats(pairFives, pairAces)).toBe(true);
    expect(beats(pairAces, pairFives)).toBe(false);
  });

  it("inside a straight the level card keeps its natural value (not elevated)", () => {
    // level 5; the run 3-4-5-6-7 uses the 5 at natural value and ranks as a 7-straight.
    const s = as(
      [C(3, Clubs), C(4, Clubs), C(5, Clubs), C(6, Clubs), C(7, Diamonds)],
      5,
      "straight",
    )!;
    expect(s.rank).toBe(7);
  });

  it("jokers outrank the level card as singles", () => {
    const level = 5;
    const five = as([C(5, Clubs)], level, "single")!;
    const sj = as([SMALL_JOKER], level, "single")!;
    const bj = as([BIG_JOKER], level, "single")!;
    expect(five.rank).toBe(15);
    expect(sj.rank).toBe(16);
    expect(bj.rank).toBe(17);
    expect(beats(bj, sj)).toBe(true);
    expect(beats(sj, five)).toBe(true);
  });
});

describe("combos — wild card substitution (rules.md §3)", () => {
  const level = 2; // wild = 2 of Hearts
  const WILD = C(2, Hearts);

  it("wild completes a pair / triple", () => {
    expect(as([C(8, Clubs), WILD], level, "pair")?.rank).toBe(8);
    expect(as([C(8, Clubs), C(8, Spades), WILD], level, "triple")?.rank).toBe(8);
  });

  it("two wilds form a pair of ANY rank (including the elevated level)", () => {
    const ranks = new Set(
      classify([WILD, WILD], level).filter((c) => c.type === "pair").map((c) => c.rank),
    );
    expect(ranks.has(14)).toBe(true); // pair of aces
    expect(ranks.has(15)).toBe(true); // pair of the level rank (elevated)
    expect(ranks.has(7)).toBe(true); // pair of sevens
  });

  it("wild fills a straight gap", () => {
    // 3,4,_,6,7 with the wild standing in for the 5
    const s = as(
      [C(3, Clubs), C(4, Clubs), WILD, C(6, Clubs), C(7, Diamonds)],
      level,
      "straight",
    )!;
    expect(s.rank).toBe(7);
  });

  it("wild completes a bomb", () => {
    const b = as([C(8, Clubs), C(8, Spades), C(8, Hearts), WILD], level, "bomb")!;
    expect(b.length).toBe(4);
    expect(b.rank).toBe(8);
    expect(isBomb(b.type)).toBe(true);
  });

  it("wild can take a suit to complete a straight flush", () => {
    // four hearts + wild -> straight flush in hearts
    const sf = as(
      [C(3, Hearts), C(4, Hearts), C(6, Hearts), C(7, Hearts), WILD],
      level,
      "straightFlush",
    )!;
    expect(sf).toBeDefined();
    expect(sf.rank).toBe(7);
  });

  it("a wild is NOT a joker — four jokers, not 'two jokers + two wilds', make the joker bomb", () => {
    // two big jokers + two wilds is NOT a joker bomb
    expect(types([BIG_JOKER, BIG_JOKER, WILD, WILD], level).has("jokerBomb")).toBe(false);
  });
});

describe("combos — bombs and the full ordering (rules.md §5)", () => {
  const level = 2;
  const fourOfAKind = as([C(5, Clubs), C(5, Diamonds), C(5, Hearts), C(5, Spades)], level, "bomb")!;
  const fiveOfAKind = as(
    [C(5, Clubs), C(5, Diamonds), C(5, Hearts), C(5, Spades), C(5, Clubs)],
    level,
    "bomb",
  )!;
  const sixOfAKind = as(
    [C(6, Clubs), C(6, Diamonds), C(6, Hearts), C(6, Spades), C(6, Clubs), C(6, Diamonds)],
    level,
    "bomb",
  )!;
  const straightFlush = as(
    [C(3, Hearts), C(4, Hearts), C(5, Hearts), C(6, Hearts), C(7, Hearts)],
    level,
    "straightFlush",
  )!;
  const jokerBomb = as([SMALL_JOKER, SMALL_JOKER, BIG_JOKER, BIG_JOKER], level, "jokerBomb")!;

  it("every bomb beats any non-bomb", () => {
    const pairAces = as([C(RANK_A, Clubs), C(RANK_A, Spades)], level, "pair")!;
    expect(beats(fourOfAKind, pairAces)).toBe(true);
    expect(beats(pairAces, fourOfAKind)).toBe(false);
  });

  it("ordering: 4-bomb < 5-bomb < straight flush < 6-bomb < joker bomb", () => {
    expect(beats(fiveOfAKind, fourOfAKind)).toBe(true);
    expect(beats(straightFlush, fiveOfAKind)).toBe(true); // SF above 5-bomb
    expect(beats(sixOfAKind, straightFlush)).toBe(true); // SF below 6-bomb
    expect(beats(jokerBomb, sixOfAKind)).toBe(true);

    // and the reverse never holds
    expect(beats(fiveOfAKind, straightFlush)).toBe(false);
    expect(beats(straightFlush, sixOfAKind)).toBe(false);
    expect(beats(sixOfAKind, jokerBomb)).toBe(false);
  });

  it("same-size numeric bombs compare by rank", () => {
    const fourFives = fourOfAKind;
    const fourEights = as(
      [C(8, Clubs), C(8, Diamonds), C(8, Hearts), C(8, Spades)],
      level,
      "bomb",
    )!;
    expect(beats(fourEights, fourFives)).toBe(true);
    expect(beats(fourFives, fourEights)).toBe(false);
  });

  it("joker bomb is unbeatable (cannot be beaten by another joker bomb)", () => {
    const otherJoker = as([SMALL_JOKER, SMALL_JOKER, BIG_JOKER, BIG_JOKER], level, "jokerBomb")!;
    expect(beats(otherJoker, jokerBomb)).toBe(false);
  });

  it("a 10-card bomb is the largest numeric bomb; an 11-of-a-kind is not a bomb", () => {
    const ten = Array.from({ length: 10 }, (_, i) => C(9, (i % 4) as Suit));
    expect(as(ten, level, "bomb")?.length).toBe(10);
    const eleven = Array.from({ length: 11 }, (_, i) => C(9, (i % 4) as Suit));
    expect(isLegalCombo(eleven, level)).toBe(false);
  });
});

describe("combos — same type required for non-bomb beats", () => {
  it("a pair does not beat a single and vice versa", () => {
    const level = 2;
    const single = as([C(9, Clubs)], level, "single")!;
    const pair = as([C(3, Clubs), C(3, Spades)], level, "pair")!;
    expect(beats(pair, single)).toBe(false);
    expect(beats(single, pair)).toBe(false);
  });
});
