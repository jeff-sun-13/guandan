// GameState for a single Guandan deal, plus the small pure helpers over it. The match layer
// (levels, scoring, tribute) sits ABOVE this and is added later — this file is one deal only.
//
// Everything here is plain, serializable data (no classes, no closures) so a state can be
// cloned cheaply and simulated by bots millions of times. See docs/03-engine/design.md.

import { type Card } from "./cards";
import { type Combo } from "./combos";
import { type Rng, cloneRng } from "./rng";

/** Seats 0..3. Partners sit opposite: team A = {0,2}, team B = {1,3}. */
export type Player = number;

/** The partner of a seat (directly across the table). */
export function partnerOf(p: Player): Player {
  return (p + 2) % 4;
}

/** Which team a seat belongs to: 0 for {0,2}, 1 for {1,3}. */
export function teamOf(p: Player): number {
  return p % 2;
}

/** The live trick. `null` in GameState means the player to act must LEAD (cannot pass). */
export interface Trick {
  /** Who led this trick. */
  leader: Player;
  /** The combo currently winning the trick. */
  topCombo: Combo;
  /** Who played `topCombo`. The trick is won by them once everyone else passes. */
  topPlayer: Player;
  /** Consecutive passes since `topCombo` was played. */
  passes: number;
}

/** A legal action: play a specific combo (with the exact cards) or pass. */
export type Move =
  | { kind: "play"; cards: Card[]; combo: Combo }
  | { kind: "pass" };

export type Phase = "playing" | "done";

export interface GameState {
  /** The level being played this deal (sets the elevated/wild rank). */
  level: number;
  /** hands[seat] = that player's remaining cards. */
  hands: Card[][];
  /** Seat to act next. `-1` once the deal is done. */
  toAct: Player;
  /** Current trick, or null when the player to act must lead. */
  trick: Trick | null;
  /** Seats in the order they emptied their hands (finishing order). */
  finished: Player[];
  /** Seeded RNG — lives in the state so a deal is fully reproducible & serializable. */
  rng: Rng;
  phase: Phase;
}

/** Deep clone a state. Cheap relative to a full simulation; safe to mutate the copy. */
export function cloneState(s: GameState): GameState {
  return {
    level: s.level,
    hands: s.hands.map((h) => h.slice()),
    toAct: s.toAct,
    trick: s.trick ? { ...s.trick } : null,
    finished: s.finished.slice(),
    rng: cloneRng(s.rng),
    phase: s.phase,
  };
}

/** A single player's legal view of the world (what a bot may use). */
export interface Observation {
  level: number;
  /** Whose view this is. */
  player: Player;
  /** Your own cards (the only hand you can see). */
  hand: Card[];
  /** Number of cards each seat holds (public information). */
  handCounts: number[];
  /**
   * Cards no longer in ANY hand — already played/discarded, including the current trick on the
   * table. Public info (everyone watched them get played). Derived in `observe()`, not stored, so
   * the engine stays pure. The pool of cards a hidden hand could hold is `fullDeck − hand −
   * outOfPlay`; this is what makes determinization possible (see `determinize`, ADR-0007).
   */
  outOfPlay: Card[];
  trick: Trick | null;
  toAct: Player;
  finished: Player[];
  phase: Phase;
}
