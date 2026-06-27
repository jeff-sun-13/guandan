// Card model for Guandan. See docs/01-rules/rules.md §1–§3.
//
// Design goals (docs/03-engine/design.md): compact, cheap to clone, no allocations in hot
// paths. A card is a small integer 0..53. A double deck is just two copies of each id, so a
// "hand" is a multiset of these ids.
//
//   ids  0..51  -> the 52 rank/suit combinations (rank 2..A x 4 suits)
//   id   52      -> small joker
//   id   53      -> big joker
//
// There are two physical copies of every id in a deal (108 cards total).

export type Card = number;

// NOTE: a regular `enum`, not `const enum`. esbuild/Vitest compile each file in isolation and
// do NOT inline const-enum members across modules, which would make Suit.Hearts `undefined` at
// runtime. A regular enum emits a real object, so it works everywhere. (See docs/gotchas.md.)
/** Suit codes. Only the Straight Flush cares about suit (and the wild = Hearts of level). */
export enum Suit {
  Clubs = 0,
  Diamonds = 1,
  Hearts = 2,
  Spades = 3,
}

// Natural rank values. 2..10 are themselves; J/Q/K/A = 11..14. Jokers get pseudo-ranks above
// Ace purely so single/pair comparisons have a number to use.
export const RANK_J = 11;
export const RANK_Q = 12;
export const RANK_K = 13;
export const RANK_A = 14;
export const RANK_SMALL_JOKER = 15;
export const RANK_BIG_JOKER = 16;

export const SMALL_JOKER: Card = 52;
export const BIG_JOKER: Card = 53;

/** Build the card id for a normal (non-joker) card. rank in 2..14, suit in 0..3. */
export function makeCard(rank: number, suit: Suit): Card {
  if (rank < 2 || rank > RANK_A) throw new Error(`bad rank ${rank}`);
  return (rank - 2) * 4 + suit;
}

export function isJoker(card: Card): boolean {
  return card >= SMALL_JOKER;
}

/**
 * Natural rank of a card: 2..14 for number cards, 15/16 for small/big joker. This is the face
 * value — what a card is "worth" structurally (e.g., its position in a straight). It is NOT
 * the level-adjusted comparison value; for that see `singleValue`.
 */
export function cardRank(card: Card): number {
  if (card === SMALL_JOKER) return RANK_SMALL_JOKER;
  if (card === BIG_JOKER) return RANK_BIG_JOKER;
  return 2 + (card >> 2); // (card / 4) floored
}

/** Suit of a number card; jokers return -1 (no suit). */
export function cardSuit(card: Card): Suit | -1 {
  if (isJoker(card)) return -1;
  return (card & 3) as Suit;
}

/**
 * Is this card the wild card for the given level? The wild is the Heart-suit card of the
 * current level rank; there are two copies in a deal. Jokers and the non-Heart level cards
 * are NOT wild. (rules.md §3)
 */
export function isWild(card: Card, level: number): boolean {
  return !isJoker(card) && cardRank(card) === level && cardSuit(card) === Suit.Hearts;
}

/**
 * Comparison value of a card when played as a SINGLE (and the basis for pair/triple/bomb rank
 * too): the level rank is elevated to just below the jokers. (rules.md §2)
 *   normal cards          -> 2..14
 *   any level-rank card   -> 15  (elevated; this includes the wild Hearts)
 *   small joker           -> 16
 *   big joker             -> 17
 * Note: this elevation does NOT apply inside straights/tubes/plates — those use cardRank.
 */
export function singleValue(card: Card, level: number): number {
  if (card === BIG_JOKER) return 17;
  if (card === SMALL_JOKER) return 16;
  if (cardRank(card) === level) return 15;
  return cardRank(card);
}

/**
 * The full 108-card deal: two copies of every one of the 54 distinct cards. The order is
 * deterministic (id 0..53, twice); callers shuffle with a seeded RNG.
 */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (let id = 0; id <= BIG_JOKER; id++) deck.push(id);
  }
  return deck;
}

const RANK_LABELS: Record<number, string> = {
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};
const SUIT_LABELS = ["C", "D", "H", "S"];

/** Human-readable label, for debugging/test output. e.g. "7H", "AD", "sJ", "BJ". */
export function cardLabel(card: Card): string {
  if (card === SMALL_JOKER) return "sJ";
  if (card === BIG_JOKER) return "BJ";
  const r = cardRank(card);
  const rankStr = RANK_LABELS[r] ?? String(r);
  return rankStr + SUIT_LABELS[cardSuit(card) as number];
}
