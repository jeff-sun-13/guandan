// Combo detection and comparison. This is the rules core — see docs/01-rules/rules.md §4–§5.
// The trickiest part (and where bugs hide) is WILD substitution; it is tested heavily.
//
// Approach: `classify` partitions the played cards into jokers, wilds (Heart-level cards),
// and naturals, then asks "can these form combo type X?" for every type. A combo type needs a
// specific multiset of ranks; naturals fill what they can and wilds (max 2) fill the gaps.
// Because wilds are flexible, a single set of cards can have MULTIPLE valid interpretations
// (e.g. two wilds alone are a pair of any rank), so `classify` returns all of them. The move
// layer (later) picks an interpretation that is legal against the current trick.

import {
  type Card,
  SMALL_JOKER,
  BIG_JOKER,
  cardRank,
  cardSuit,
  isWild,
  singleValue,
  RANK_A,
} from "./cards";

export type ComboType =
  | "single"
  | "pair"
  | "triple"
  | "fullHouse"
  | "straight"
  | "tube" // 3 consecutive pairs (三连对)
  | "plate" // 2 consecutive triples (钢板)
  | "bomb" // n-of-a-kind, n in 4..10
  | "straightFlush"
  | "jokerBomb";

export interface Combo {
  type: ComboType;
  /**
   * Comparison rank within the type. For single/pair/triple/fullHouse/bomb this is the
   * level-elevated value (level rank => 15, jokers 16/17). For straight/tube/plate/straightFlush
   * it is the NATURAL top value of the run (A-low run => 5). Not meaningful for jokerBomb.
   */
  rank: number;
  /** Number of cards in the play. */
  length: number;
  /** The actual cards played (a copy), for the UI / move record. */
  cards: Card[];
}

const BOMB_TYPES = new Set<ComboType>(["bomb", "straightFlush", "jokerBomb"]);
export function isBomb(type: ComboType): boolean {
  return BOMB_TYPES.has(type);
}

/** Ace sits at both ends so we can read off A-low and A-high runs; never wraps the seam. */
const STRAIGHT_SEQ = [RANK_A, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, RANK_A];

/** All consecutive rank-windows of a given length (no wrap-around). */
function windows(len: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + len <= STRAIGHT_SEQ.length; i++) {
    out.push(STRAIGHT_SEQ.slice(i, i + len));
  }
  return out;
}
// Exported so the move generator (moves.ts) enumerates the exact same runs the classifier
// recognizes — single source of truth for "what counts as consecutive".
export const STRAIGHT_WINDOWS = windows(5);
export const TUBE_WINDOWS = windows(3);
export const PLATE_WINDOWS = windows(2);

/** The level rank is elevated to 15 for grouped combos (pair/triple/bomb/full house). */
export function pointValue(rank: number, level: number): number {
  return rank === level ? 15 : rank;
}

interface Partition {
  nat: Map<number, number>; // natural rank -> count (non-joker, non-wild)
  naturalCards: Card[];
  wilds: number;
  small: number; // small jokers
  big: number; // big jokers
}

function partition(cards: Card[], level: number): Partition {
  const nat = new Map<number, number>();
  const naturalCards: Card[] = [];
  let wilds = 0;
  let small = 0;
  let big = 0;
  for (const c of cards) {
    if (isWild(c, level)) {
      wilds++;
    } else if (c === SMALL_JOKER) {
      small++;
    } else if (c === BIG_JOKER) {
      big++;
    } else {
      const r = cardRank(c);
      nat.set(r, (nat.get(r) ?? 0) + 1);
      naturalCards.push(c);
    }
  }
  return { nat, naturalCards, wilds, small, big };
}

/**
 * Can the naturals + wilds exactly realize `target` (a list of [rank, neededCount])? "Exactly"
 * means every natural is used, none left over, and the wilds fill precisely the deficit. These
 * combos never contain jokers, so any joker makes it impossible.
 */
function matchGroup(
  target: Array<[number, number]>,
  p: Partition,
): boolean {
  if (p.small > 0 || p.big > 0) return false;
  const targetRanks = new Set(target.map(([r]) => r));
  for (const r of p.nat.keys()) {
    if (!targetRanks.has(r)) return false; // a natural that doesn't belong
  }
  let deficit = 0;
  for (const [r, need] of target) {
    const have = p.nat.get(r) ?? 0;
    if (have > need) return false; // too many of this rank
    deficit += need - have;
  }
  return deficit === p.wilds;
}

/** All distinct suits present among the natural cards (jokers/wilds excluded). */
function naturalSuits(p: Partition): Set<number> {
  const s = new Set<number>();
  for (const c of p.naturalCards) s.add(cardSuit(c));
  return s;
}

/**
 * Every legal interpretation of `cards` at the given level. Empty if the cards form no legal
 * combo. Deduplicated by (type, rank) — different wild assignments that yield the same playable
 * combo are equivalent for the rules.
 */
export function classify(cards: Card[], level: number): Combo[] {
  const n = cards.length;
  if (n === 0) return [];
  const p = partition(cards, level);
  const seen = new Set<string>();
  const out: Combo[] = [];
  const sorted = cards.slice();
  const add = (type: ComboType, rank: number) => {
    const key = `${type}:${rank}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, rank, length: n, cards: sorted });
  };

  // --- Single ---
  if (n === 1) {
    add("single", singleValue(cards[0] as Card, level));
    return out; // a single card can be nothing else
  }

  // --- Joker bomb: exactly all four jokers ---
  if (n === 4 && p.small === 2 && p.big === 2) {
    add("jokerBomb", 100);
    // (no other interpretation of four jokers)
    return out;
  }

  // --- Pair ---
  if (n === 2) {
    if (p.small === 2) add("pair", 16);
    if (p.big === 2) add("pair", 17);
    for (let r = 2; r <= RANK_A; r++) {
      if (matchGroup([[r, 2]], p)) add("pair", pointValue(r, level));
    }
  }

  // --- Triple ---
  if (n === 3) {
    for (let r = 2; r <= RANK_A; r++) {
      if (matchGroup([[r, 3]], p)) add("triple", pointValue(r, level));
    }
  }

  // --- Full house (triple + distinct pair) ---
  if (n === 5) {
    for (let t = 2; t <= RANK_A; t++) {
      for (let q = 2; q <= RANK_A; q++) {
        if (t === q) continue;
        if (matchGroup([[t, 3], [q, 2]], p)) add("fullHouse", pointValue(t, level));
      }
    }
  }

  // --- Straight & straight flush (length 5) ---
  if (n === 5) {
    for (const win of STRAIGHT_WINDOWS) {
      const target = win.map((r) => [r, 1] as [number, number]);
      if (!matchGroup(target, p)) continue;
      const top = win[win.length - 1] as number;
      add("straight", top);
      // Straight flush: all naturals share one suit (wilds take whatever suit is needed).
      if (naturalSuits(p).size <= 1) add("straightFlush", top);
    }
  }

  // --- Tube: 3 consecutive pairs (length 6) ---
  if (n === 6) {
    for (const win of TUBE_WINDOWS) {
      const target = win.map((r) => [r, 2] as [number, number]);
      if (matchGroup(target, p)) add("tube", win[win.length - 1] as number);
    }
  }

  // --- Plate: 2 consecutive triples (length 6) ---
  if (n === 6) {
    for (const win of PLATE_WINDOWS) {
      const target = win.map((r) => [r, 3] as [number, number]);
      if (matchGroup(target, p)) add("plate", win[win.length - 1] as number);
    }
  }

  // --- Numeric bomb: n-of-a-kind, n in 4..10 ---
  if (n >= 4 && n <= 10) {
    for (let r = 2; r <= RANK_A; r++) {
      if (matchGroup([[r, n]], p)) add("bomb", pointValue(r, level));
    }
  }

  return out;
}

/**
 * True iff `cards` form at least one legal combo at this level.
 */
export function isLegalCombo(cards: Card[], level: number): boolean {
  return classify(cards, level).length > 0;
}

/**
 * Bomb tiers, weakest -> strongest (rules.md §5):
 *   4-bomb < 5-bomb < straight flush < 6-bomb < 7 < 8 < 9 < 10-bomb < joker bomb.
 * We place the straight flush at 5.5 so it slots between the 5- and 6-card bombs.
 */
function bombTier(c: Combo): number {
  if (c.type === "jokerBomb") return 100;
  if (c.type === "straightFlush") return 5.5;
  return c.length; // numeric bomb: 4..10
}

/**
 * Does combo `a` beat combo `b`? `b` is the combo currently on the table; `a` is the proposed
 * play. Bombs beat any non-bomb; among bombs, higher tier wins and ties break on rank. Two
 * non-bombs must share a type (and length) and `a` must out-rank `b`.
 */
export function beats(a: Combo, b: Combo): boolean {
  const aBomb = isBomb(a.type);
  const bBomb = isBomb(b.type);
  if (aBomb && !bBomb) return true;
  if (!aBomb && bBomb) return false;
  if (aBomb && bBomb) {
    const ta = bombTier(a);
    const tb = bombTier(b);
    if (ta !== tb) return ta > tb;
    return a.rank > b.rank; // same tier => compare rank (joker bomb ties => not beaten)
  }
  // both non-bombs: must be the same kind of play
  if (a.type !== b.type || a.length !== b.length) return false;
  return a.rank > b.rank;
}
