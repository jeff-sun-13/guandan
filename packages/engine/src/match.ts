// The match layer: the multi-deal wrapper above a single deal. Tracks each team's level, who
// is "declaring" (the previous winner, whose level the next deal is played at), scoring, the
// A-level win condition, and the three-strikes-at-A demotion. Pure rules — see rules.md §7.
//
// Tribute between deals lives in tribute.ts; orchestrating actual play (deal -> tribute ->
// play -> score, with bots) lives above the engine (e.g. packages/bots arena).

import { type Rng } from "./rng";
import { type Player, teamOf, partnerOf } from "./state";

export const START_LEVEL = 2;
export const MAX_LEVEL = 14; // Ace
export const A_STRIKES_LIMIT = 3;

export interface MatchState {
  /** Current level of team 0 ({0,2}) and team 1 ({1,3}). */
  levels: [number, number];
  /** The declaring team (winner of the previous deal); null before the first deal. */
  declarer: number | null;
  /** Failed attempts to win while declarers at level A, per team. */
  aStrikes: [number, number];
  /** The winning team once the match is over, else null. */
  winner: number | null;
  rng: Rng;
}

export function createMatch(rng: Rng): MatchState {
  return {
    levels: [START_LEVEL, START_LEVEL],
    declarer: null,
    aStrikes: [0, 0],
    winner: null,
    rng,
  };
}

/** The level rank the next deal is played at: the declarers' level (2 for the first deal). */
export function dealLevel(m: MatchState): number {
  return m.declarer === null ? START_LEVEL : (m.levels[m.declarer] as number);
}

export type FinishPattern = "1-2" | "1-3" | "1-4";

export interface DealScore {
  winningTeam: number;
  pattern: FinishPattern;
  /** Levels the winning team advances: +3 / +2 / +1 for 1-2 / 1-3 / 1-4. */
  advance: number;
}

/**
 * Score a finished deal from its finishing order ([1st, 2nd, 3rd, 4th] seats). The winning team
 * is whoever took 1st; the bonus depends on where their partner finished.
 */
export function scoreDeal(finishOrder: Player[]): DealScore {
  const first = finishOrder[0] as Player;
  const winningTeam = teamOf(first);
  const partnerPos = finishOrder.indexOf(partnerOf(first));
  if (partnerPos === 1) return { winningTeam, pattern: "1-2", advance: 3 };
  if (partnerPos === 2) return { winningTeam, pattern: "1-3", advance: 2 };
  return { winningTeam, pattern: "1-4", advance: 1 };
}

/**
 * Advance the match by one completed deal. Applies the winners' promotion (capped at A), the
 * A-level win condition (declarers at A finishing 1-2/1-3), and the three-strikes demotion.
 * Returns a new MatchState; the input is not mutated (the RNG reference is carried through).
 */
export function applyDealResult(m: MatchState, finishOrder: Player[]): MatchState {
  if (m.winner !== null) throw new Error("match already won");
  const { winningTeam, pattern, advance } = scoreDeal(finishOrder);

  const levels: [number, number] = [m.levels[0], m.levels[1]];
  const aStrikes: [number, number] = [m.aStrikes[0], m.aStrikes[1]];

  // Was the team that set this deal's level (the declarers) sitting on A?
  const declarerAtA = m.declarer !== null && (levels[m.declarer] as number) === MAX_LEVEL;

  // The match is won only by the DECLARERS, on A, with a 1-2 or 1-3 finish (rules.md §7).
  const matchWon =
    declarerAtA &&
    winningTeam === m.declarer &&
    (pattern === "1-2" || pattern === "1-3");

  // Winners always promote (the losers stay put); promotion caps at A — you can't pass it.
  levels[winningTeam] = Math.min(MAX_LEVEL, (levels[winningTeam] as number) + advance);

  let winner: number | null = null;
  if (matchWon) {
    winner = winningTeam;
  } else if (declarerAtA) {
    // Declarers were on A and did not win the match -> a strike. Third strike demotes them.
    const d = m.declarer as number;
    const strikes = (aStrikes[d] as number) + 1;
    if (strikes >= A_STRIKES_LIMIT) {
      levels[d] = START_LEVEL; // demote to the lowest level
      aStrikes[d] = 0; // and reset the count
    } else {
      aStrikes[d] = strikes;
    }
  }

  return {
    levels,
    declarer: winningTeam, // the winners declare the next deal
    aStrikes,
    winner,
    rng: m.rng,
  };
}

export function isMatchOver(m: MatchState): boolean {
  return m.winner !== null;
}
