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
  /**
   * Optional PUBLIC play history for this deal (ADR-0011). The pure engine is memoryless and
   * `observe()` leaves this UNDEFINED; the orchestrator ABOVE the engine (the match runner) fills it
   * so bots can do cross-trick inference + tribute-as-deduction. Bots must treat it as optional.
   */
  history?: PublicHistory;
  /**
   * Optional MATCH context (public: levels/strikes are open information). Like `history`, the
   * single-deal engine leaves this UNDEFINED; the match runner fills it. Lets bots condition the
   * deal objective on the match — decisive at level A, where a declarer 1-4 is a STRIKE, not a
   * "+1 win", and 1-2 vs 1-3 both win the match outright (rules.md §7).
   */
  matchCtx?: MatchContext;
}

/** Public match situation for the deal being played (see Observation.matchCtx). */
export interface MatchContext {
  /** Current level of team 0 ({0,2}) and team 1 ({1,3}). */
  levels: [number, number];
  /** The team declaring this deal (whose level it's played at); -1 for the first deal of a match. */
  declarer: number;
  /** Failed declarer-at-A attempts per team (3rd strike demotes to level 2). */
  aStrikes: [number, number];
}

/** One pass event in the public record: `seat` declined to beat `top` (held by `topPlayer`). */
export interface PassEvent {
  seat: Player;
  top: Combo;
  topPlayer: Player;
}

/** One play event in the public record: `seat` faced everyone with `cards` (as `combo`). */
export interface PlayEvent {
  seat: Player;
  cards: Card[];
  combo: Combo;
}

/**
 * One tribute payment (all four fields are public — both cards change hands face up, rules.md §8):
 * `giver` paid `card` (by rule their highest non-wild single) to `receiver`, who gave `returnCard`
 * back. Exact-information gold for belief: the giver holds nothing non-wild above `card`, the
 * receiver is KNOWN to hold `card`, and the giver is KNOWN to hold `returnCard` — until each is
 * seen played (track via `PublicHistory.plays`).
 */
export interface TributeEvent {
  giver: Player;
  receiver: Player;
  card: Card;
  returnCard: Card;
}

/**
 * Tribute was resisted (抗贡, rules.md §8) — the highest-density free deduction in the game:
 * - kind "single" (after a 1-3/1-4 finish): the last-place player refused by holding BOTH big
 *   jokers → `holders` = [that seat], and both big-joker copies are pinned to them.
 * - kind "double" (after a 1-2 finish): the two losers jointly hold both big jokers (one each, or
 *   one holds both) → `holders` = the two losers; the WINNERS provably hold no big joker.
 */
export interface TributeResist {
  kind: "single" | "double";
  holders: Player[];
}

/**
 * The observable record of one deal — what the memoryless engine does NOT keep. Populated by the
 * match runner above the engine and attached to `Observation.history`. Enables the belief upgrades
 * in ADR-0011 (per-seat play attribution, cross-trick passing inference, tribute-as-deduction).
 * Pure serializable data.
 */
export interface PublicHistory {
  /** Every pass so far this deal, with the top the passer faced. */
  passes: PassEvent[];
  /** Every play so far this deal, attributed to its seat (per-opponent modeling needs WHO, not just what). */
  plays: PlayEvent[];
  /** Tribute exchange(s) before this deal began (payment + return, both public). */
  tribute: TributeEvent[];
  /** Present when tribute was cancelled by resist — pins/excludes big jokers (see TributeResist). */
  resist?: TributeResist;
}
