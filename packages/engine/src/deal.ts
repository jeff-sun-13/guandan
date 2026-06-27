// One deal's lifecycle: shuffle & deal, apply moves (trick resolution + going out), detect the
// end and report the finishing order. The transition function `applyMove` is total over LEGAL
// moves and throws on illegal ones, so an illegal state can never be constructed (per the
// engine's design principles, docs/03-engine/design.md).

import { type Card, makeDeck, singleValue, cardSuit, BIG_JOKER } from "./cards";
import { classify, beats } from "./combos";
import { shuffle, nextInt, type Rng } from "./rng";
import {
  type GameState,
  type Move,
  type Player,
  type Observation,
  cloneState,
  partnerOf,
} from "./state";

const CARDS_PER_HAND = 27;

/** Sort key for a hand: ascending by play value, suits grouped — purely cosmetic (UI/tests). */
function handSortKey(card: Card, level: number): number {
  const suit = cardSuit(card);
  return singleValue(card, level) * 4 + (suit === -1 ? 0 : suit);
}

/**
 * Shuffle a fresh 108-card deck with the seeded RNG and deal 27 to each seat. `leader` is the
 * seat that leads the first trick; if omitted it is chosen by the RNG (the rule for the very
 * first deal of a match — rules.md §6). The match layer passes an explicit leader for later
 * deals (set by tribute).
 */
export function createDeal(level: number, rng: Rng, leader?: Player): GameState {
  const deck = shuffle(rng, makeDeck());
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < deck.length; i++) {
    (hands[i % 4] as Card[]).push(deck[i] as Card);
  }
  for (const h of hands) h.sort((a, b) => handSortKey(a, level) - handSortKey(b, level));

  const firstLeader = leader ?? nextInt(rng, 4);
  return {
    level,
    hands,
    toAct: firstLeader,
    trick: null,
    finished: [],
    rng,
    phase: "playing",
  };
}

/** Next seat after `from` (increasing, mod 4) that still holds cards; -1 if none. */
function nextActivePlayer(hands: Card[][], from: Player): Player {
  for (let i = 1; i <= 4; i++) {
    const p = (from + i) % 4;
    if ((hands[p] as Card[]).length > 0) return p;
  }
  return -1;
}

/** Players (other than `topPlayer`) who still hold cards — the responders a trick waits on. */
function respondersRemaining(hands: Card[][], topPlayer: Player): number {
  let n = 0;
  for (let p = 0; p < 4; p++) {
    if (p !== topPlayer && (hands[p] as Card[]).length > 0) n++;
  }
  return n;
}

/** Remove the exact multiset `cards` from `hand`, returning a new array. Throws if any missing. */
function removeCards(hand: Card[], cards: Card[]): Card[] {
  const out = hand.slice();
  for (const c of cards) {
    const idx = out.indexOf(c);
    if (idx === -1) throw new Error(`card ${c} not in hand`);
    out.splice(idx, 1);
  }
  return out;
}

/** Verify a play move's cards are in hand and actually form the stated combo. */
function validatePlay(state: GameState, player: Player, cards: Card[], comboType: string, comboRank: number, comboLen: number): void {
  if (cards.length !== comboLen) throw new Error("combo length mismatch");
  const interps = classify(cards, state.level);
  const ok = interps.some(
    (c) => c.type === comboType && c.rank === comboRank && c.length === comboLen,
  );
  if (!ok) throw new Error("cards do not form the stated combo");
}

/**
 * Apply a legal move, returning the next state (the input is not mutated). Throws on any illegal
 * move (passing while leading, playing cards you don't have, a play that doesn't beat the trick).
 */
export function applyMove(state: GameState, move: Move): GameState {
  if (state.phase !== "playing") throw new Error("deal is over");
  const s = cloneState(state);
  const p = s.toAct;

  if (move.kind === "pass") {
    if (!s.trick) throw new Error("cannot pass when leading");
    s.trick.passes++;
    if (s.trick.passes >= respondersRemaining(s.hands, s.trick.topPlayer)) {
      // Trick won by topPlayer. Winner leads next; if they've gone out, their partner does
      // (rules.md §6); if the partner is also out, the next active seat.
      const winner = s.trick.topPlayer;
      let leader: Player;
      if ((s.hands[winner] as Card[]).length > 0) leader = winner;
      else {
        const partner = partnerOf(winner);
        leader = (s.hands[partner] as Card[]).length > 0
          ? partner
          : nextActivePlayer(s.hands, winner);
      }
      s.trick = null;
      s.toAct = leader;
    } else {
      s.toAct = nextActivePlayer(s.hands, p);
    }
    return s;
  }

  // --- play ---
  validatePlay(s, p, move.cards, move.combo.type, move.combo.rank, move.combo.length);
  if (s.trick && !beats(move.combo, s.trick.topCombo)) {
    throw new Error("play does not beat the current trick");
  }

  s.hands[p] = removeCards(s.hands[p] as Card[], move.cards);
  if (!s.trick) {
    s.trick = { leader: p, topCombo: move.combo, topPlayer: p, passes: 0 };
  } else {
    s.trick.topCombo = move.combo;
    s.trick.topPlayer = p;
    s.trick.passes = 0;
  }

  if ((s.hands[p] as Card[]).length === 0) {
    s.finished.push(p);
    if (s.finished.length === 3) {
      // Deal over: the one player with cards left finishes 4th.
      const last = [0, 1, 2, 3].find((x) => !s.finished.includes(x)) as Player;
      s.finished.push(last);
      s.phase = "done";
      s.toAct = -1;
      return s;
    }
  }

  s.toAct = nextActivePlayer(s.hands, p);
  return s;
}

export function isTerminal(state: GameState): boolean {
  return state.phase === "done";
}

/**
 * The finishing order (length 4: 1st, 2nd, 3rd, 4th seat) once the deal is done. Throws if the
 * deal is still in progress.
 */
export function result(state: GameState): Player[] {
  if (state.phase !== "done") throw new Error("deal not finished");
  return state.finished.slice();
}

/**
 * The cards no longer in any hand = the full 108-card deck minus every card currently held. These
 * have all been played and are public. Used by `observe` (and thus determinization). O(108).
 */
export function outOfPlayCards(hands: Card[][]): Card[] {
  const counts = new Array<number>(BIG_JOKER + 1).fill(2); // two copies of each id 0..53
  for (const h of hands) for (const c of h) (counts[c] as number)--;
  const out: Card[] = [];
  for (let id = 0; id <= BIG_JOKER; id++) {
    for (let k = 0; k < (counts[id] as number); k++) out.push(id);
  }
  return out;
}

/** A single player's legal view: their hand, everyone's card counts, and public trick info. */
export function observe(state: GameState, player: Player): Observation {
  return {
    level: state.level,
    player,
    hand: (state.hands[player] as Card[]).slice(),
    handCounts: state.hands.map((h) => h.length),
    outOfPlay: outOfPlayCards(state.hands),
    trick: state.trick ? { ...state.trick } : null,
    toAct: state.toAct,
    finished: state.finished.slice(),
    phase: state.phase,
  };
}
