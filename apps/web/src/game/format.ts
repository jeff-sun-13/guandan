// Pure presentation helpers: turn engine values (cards, combos) into display strings/classes.
// No game logic here — the engine owns truth; this just renders it.

import {
  type Card,
  type Combo,
  type ComboType,
  Suit,
  cardRank,
  cardSuit,
  isJoker,
  isWild,
  SMALL_JOKER,
  BIG_JOKER,
} from "@guandan/engine";

const RANK_SYMBOLS: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const SUIT_SYMBOLS = ["♣", "♦", "♥", "♠"];

export function rankSymbol(rank: number): string {
  return RANK_SYMBOLS[rank] ?? String(rank);
}

export interface CardFace {
  /** Big glyph, e.g. "A", "10", "★". */
  label: string;
  /** Suit glyph or "" for jokers. */
  suit: string;
  /** "red" (hearts/diamonds), "black" (clubs/spades), or "joker". */
  tone: "red" | "black" | "joker";
  /** True if this card is the wild (Heart of the level rank) this deal. */
  wild: boolean;
}

export function cardFace(card: Card, level: number): CardFace {
  if (card === SMALL_JOKER) return { label: "★", suit: "Jr", tone: "joker", wild: false };
  if (card === BIG_JOKER) return { label: "★", suit: "JR", tone: "joker", wild: false };
  const r = cardRank(card);
  const s = cardSuit(card) as Suit;
  const tone = s === Suit.Hearts || s === Suit.Diamonds ? "red" : "black";
  return {
    label: rankSymbol(r),
    suit: SUIT_SYMBOLS[s] as string,
    tone,
    wild: isWild(card, level),
  };
}

const COMBO_NAMES: Record<ComboType, string> = {
  single: "Single",
  pair: "Pair",
  triple: "Triple",
  fullHouse: "Full house",
  straight: "Straight",
  tube: "Tube",
  plate: "Plate",
  bomb: "Bomb",
  straightFlush: "Straight flush",
  jokerBomb: "Joker bomb",
};

export function comboName(type: ComboType): string {
  return COMBO_NAMES[type];
}

/** Human rank token for a combo's comparison rank (handles level/jokers). */
function comboRankText(rank: number): string {
  if (rank === 15) return "level";
  if (rank === 16) return "Jr";
  if (rank === 17) return "JR";
  if (rank === 100) return "";
  return rankSymbol(rank);
}

/** A short label for one combo reading, used by the ambiguity chooser, e.g. "Straight flush → 9". */
export function comboLabel(combo: Combo): string {
  const name = comboName(combo.type);
  if (combo.type === "jokerBomb") return name;
  if (
    combo.type === "straight" ||
    combo.type === "straightFlush" ||
    combo.type === "tube" ||
    combo.type === "plate"
  ) {
    return `${name} → ${comboRankText(combo.rank)}`;
  }
  if (combo.type === "bomb") return `${name} ×${combo.length} (${comboRankText(combo.rank)})`;
  return `${name} (${comboRankText(combo.rank)})`;
}

/** Sort a hand for display: ascending value, jokers last; just visual. */
export function sortHandForDisplay(hand: Card[]): Card[] {
  return hand.slice().sort((a, b) => {
    const ja = isJoker(a) ? 1 : 0;
    const jb = isJoker(b) ? 1 : 0;
    if (ja !== jb) return ja - jb;
    if (a !== b) return a - b;
    return 0;
  });
}

const LEVEL_LABEL: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
export function levelLabel(level: number): string {
  return LEVEL_LABEL[level] ?? String(level);
}
