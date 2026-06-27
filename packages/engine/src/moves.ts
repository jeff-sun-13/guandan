// Legal-move generation. Given a hand, enumerate every combo it can play; given a trick,
// filter to the plays that beat it (plus pass). This is the engine's busiest function — bots
// call it at every node of a search — so it enumerates by combo TYPE rather than over the
// 2^27 subsets of a hand.
//
// WILD POLICY (documented limitation): each distinct (type, rank, length) play is emitted once,
// using the FEWEST wild cards necessary (naturals first). So we offer "pair of 8s" using two
// natural 8s rather than spending a wild, when possible. We do NOT currently also emit the
// wild-spending variant of a play that's already formable without wilds. That keeps the move
// list compact and is fine for the v0/v1 bots; a later pass can surface wild-spend variants if
// a stronger bot benefits. See docs/03-engine/design.md.

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
import {
  type Combo,
  type ComboType,
  beats,
  pointValue,
  STRAIGHT_WINDOWS,
  TUBE_WINDOWS,
  PLATE_WINDOWS,
} from "./combos";
import { type GameState, type Move, type Player } from "./state";

interface HandInfo {
  /** rank 2..14 -> natural cards of that rank (excludes wilds & jokers). */
  cardsByRank: Map<number, Card[]>;
  /** rank -> suit -> natural cards (for straight flush enumeration). */
  bySuit: Map<number, Map<number, Card[]>>;
  wilds: Card[];
  small: Card[]; // small jokers
  big: Card[]; // big jokers
}

function analyze(hand: Card[], level: number): HandInfo {
  const cardsByRank = new Map<number, Card[]>();
  const bySuit = new Map<number, Map<number, Card[]>>();
  const wilds: Card[] = [];
  const small: Card[] = [];
  const big: Card[] = [];
  for (const c of hand) {
    if (isWild(c, level)) {
      wilds.push(c);
    } else if (c === SMALL_JOKER) {
      small.push(c);
    } else if (c === BIG_JOKER) {
      big.push(c);
    } else {
      const r = cardRank(c);
      const byRank = cardsByRank.get(r);
      if (byRank) byRank.push(c);
      else cardsByRank.set(r, [c]);

      const s = cardSuit(c);
      let suits = bySuit.get(r);
      if (!suits) {
        suits = new Map<number, Card[]>();
        bySuit.set(r, suits);
      }
      const bucket = suits.get(s);
      if (bucket) bucket.push(c);
      else suits.set(s, [c]);
    }
  }
  return { cardsByRank, bySuit, wilds, small, big };
}

/**
 * Assemble the concrete cards for a requirement list (each rank appears at most once across
 * the list, which holds for every combo type). Naturals first, then wilds to fill the deficit.
 * Returns null if the hand can't cover it. Wild-minimal.
 */
function assemble(reqs: Array<[number, number]>, info: HandInfo): Card[] | null {
  const out: Card[] = [];
  let wi = 0;
  for (const [rank, count] of reqs) {
    const nat = info.cardsByRank.get(rank) ?? [];
    const useNat = Math.min(nat.length, count);
    for (let i = 0; i < useNat; i++) out.push(nat[i] as Card);
    let deficit = count - useNat;
    while (deficit > 0) {
      if (wi >= info.wilds.length) return null;
      out.push(info.wilds[wi++] as Card);
      deficit--;
    }
  }
  return out;
}

/** Like `assemble` but every card of a run must share `suit` (wilds take that suit). */
function assembleFlush(window: number[], suit: number, info: HandInfo): Card[] | null {
  const out: Card[] = [];
  let wi = 0;
  for (const rank of window) {
    const bucket = info.bySuit.get(rank)?.get(suit);
    if (bucket && bucket.length > 0) {
      out.push(bucket[0] as Card);
    } else {
      if (wi >= info.wilds.length) return null;
      out.push(info.wilds[wi++] as Card);
    }
  }
  return out;
}

function makeCombo(type: ComboType, rank: number, cards: Card[]): Combo {
  return { type, rank, length: cards.length, cards };
}

/**
 * Every distinct combo playable from `hand` at `level`, one per (type, rank, length).
 */
export function enumerateCombos(hand: Card[], level: number): Move[] {
  const info = analyze(hand, level);
  const moves: Move[] = [];
  const seen = new Set<string>();
  const push = (combo: Combo) => {
    const key = `${combo.type}:${combo.rank}:${combo.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    moves.push({ kind: "play", cards: combo.cards, combo });
  };

  // Singles — one per distinct card present.
  for (const id of new Set(hand)) {
    push(makeCombo("single", singleValue(id, level), [id]));
  }

  // Pairs (incl. joker pairs).
  if (info.small.length >= 2) push(makeCombo("pair", 16, info.small.slice(0, 2)));
  if (info.big.length >= 2) push(makeCombo("pair", 17, info.big.slice(0, 2)));
  for (let r = 2; r <= RANK_A; r++) {
    const cards = assemble([[r, 2]], info);
    if (cards) push(makeCombo("pair", pointValue(r, level), cards));
  }

  // Triples.
  for (let r = 2; r <= RANK_A; r++) {
    const cards = assemble([[r, 3]], info);
    if (cards) push(makeCombo("triple", pointValue(r, level), cards));
  }

  // Full houses — one per triple rank (first valid attached pair, wild-minimal).
  for (let t = 2; t <= RANK_A; t++) {
    if (!assemble([[t, 3]], info)) continue;
    for (let q = 2; q <= RANK_A; q++) {
      if (q === t) continue;
      const cards = assemble([[t, 3], [q, 2]], info);
      if (cards) {
        push(makeCombo("fullHouse", pointValue(t, level), cards));
        break;
      }
    }
  }

  // Straights & straight flushes (length 5).
  for (const win of STRAIGHT_WINDOWS) {
    const reqs = win.map((r) => [r, 1] as [number, number]);
    const cards = assemble(reqs, info);
    const top = win[win.length - 1] as number;
    if (cards) push(makeCombo("straight", top, cards));
    for (let suit = 0; suit < 4; suit++) {
      const sf = assembleFlush(win, suit, info);
      if (sf) push(makeCombo("straightFlush", top, sf));
    }
  }

  // Tubes (3 consecutive pairs) and plates (2 consecutive triples).
  for (const win of TUBE_WINDOWS) {
    const cards = assemble(win.map((r) => [r, 2] as [number, number]), info);
    if (cards) push(makeCombo("tube", win[win.length - 1] as number, cards));
  }
  for (const win of PLATE_WINDOWS) {
    const cards = assemble(win.map((r) => [r, 3] as [number, number]), info);
    if (cards) push(makeCombo("plate", win[win.length - 1] as number, cards));
  }

  // Numeric bombs (4..10 of a kind) and the joker bomb.
  for (let n = 4; n <= 10; n++) {
    for (let r = 2; r <= RANK_A; r++) {
      const cards = assemble([[r, n]], info);
      if (cards) push(makeCombo("bomb", pointValue(r, level), cards));
    }
  }
  if (info.small.length >= 2 && info.big.length >= 2) {
    push(makeCombo("jokerBomb", 100, [...info.small.slice(0, 2), ...info.big.slice(0, 2)]));
  }

  return moves;
}

/**
 * The legal moves for `player` (normally `state.toAct`). When leading, every combo in hand and
 * NO pass. When following, `pass` plus every combo that beats the current trick.
 */
export function legalMoves(state: GameState, player: Player): Move[] {
  if (state.phase !== "playing") return [];
  const hand = state.hands[player] ?? [];
  const all = enumerateCombos(hand, state.level);
  if (!state.trick) return all; // leading: must play, cannot pass

  const top = state.trick.topCombo;
  const out: Move[] = [{ kind: "pass" }];
  for (const m of all) {
    if (m.kind === "play" && beats(m.combo, top)) out.push(m);
  }
  return out;
}
