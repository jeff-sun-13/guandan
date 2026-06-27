// A fast STATIC position evaluator — scores a (determinized) game state without rolling it out.
// Used as a cheap leaf for the PIMC bot (docs/04-bots/v2-search-design.md §5): a full heuristic
// rollout costs ~1ms, a static eval costs ~1µs, so this lets search afford 10-100× more
// determinizations AND run fast enough for the UI.
//
// The signal is the Guandan race: whoever empties their hand first (and helps their partner do so)
// wins. We estimate, per still-playing seat, how many PLAYS it would take to shed the hand (fewer
// = closer to winning), credit bombs as control, and fold in who has already finished. Crude but
// monotone in the things that matter; its real job is to RANK candidate moves, not be exact.
//
// This lives in @guandan/bots (it's a bot's judgement, not an engine rule — the engine stays pure).

import {
  cardRank,
  SMALL_JOKER,
  BIG_JOKER,
  teamOf,
  type Card,
  type GameState,
} from "@guandan/engine";

// Weights (tunable). HAND dominates; FINISH captures locked-in outcomes; BOMB is control.
const W_FINISH = 6; // swing per finished seat, scaled by how early they went out
const W_PLAYS = 1.0; // per estimated play needed to empty a hand
const W_CARDS = 0.05; // small raw-card-count tiebreak (25 cards worse than 5 at equal grouping)
const W_BOMB = 0.6; // per bomb held (seizes/holds the lead)

/**
 * Rough number of plays needed to empty a hand: count distinct natural ranks (all copies of a rank
 * can be dumped together as a pair/triple/bomb in one play) plus a play for each joker kind held.
 * Ignores straights/tubes (which would reduce it further) and following constraints — a cheap,
 * monotone proxy: fewer distinct ranks ⇒ closer to out.
 */
export function playsToEmpty(hand: Card[], level: number): number {
  const ranks = new Set<number>();
  let small = 0;
  let big = 0;
  for (const c of hand) {
    if (c === SMALL_JOKER) small++;
    else if (c === BIG_JOKER) big++;
    else ranks.add(cardRank(c)); // wild Hearts-of-level counts as its own rank — fine for a proxy
  }
  let plays = ranks.size;
  if (small > 0) plays++;
  if (big > 0) plays++;
  return plays;
}

/** Cheap bomb count: any natural rank with ≥4 copies, plus the four-joker bomb if held. */
export function bombCount(hand: Card[], level: number): number {
  const byRank = new Map<number, number>();
  let small = 0;
  let big = 0;
  for (const c of hand) {
    if (c === SMALL_JOKER) small++;
    else if (c === BIG_JOKER) big++;
    else {
      // wilds can complete bombs; count them toward their rank bucket loosely via natural rank.
      const r = cardRank(c);
      byRank.set(r, (byRank.get(r) ?? 0) + 1);
    }
  }
  let n = 0;
  for (const c of byRank.values()) if (c >= 4) n++;
  if (small >= 2 && big >= 2) n++;
  return n;
}

/**
 * Static value of `state` from `team`'s perspective (higher = better). Reads all four hands, so it
 * is meant for a DETERMINIZED full state (a sampled world), not a hidden one.
 */
export function staticDealValue(state: GameState, team: number): number {
  let v = 0;
  const finished = state.finished;
  // Locked-in finishes: the earlier a seat went out, the better for its team.
  for (let i = 0; i < finished.length; i++) {
    const seat = finished[i] as number;
    const sign = teamOf(seat) === team ? 1 : -1;
    v += sign * W_FINISH * (4 - i);
  }
  // Still-playing seats: lower cost-to-empty is better; bombs are a plus.
  for (let p = 0; p < 4; p++) {
    if (finished.includes(p)) continue;
    const hand = state.hands[p] as Card[];
    const sign = teamOf(p) === team ? 1 : -1;
    const cost = W_PLAYS * playsToEmpty(hand, state.level) + W_CARDS * hand.length;
    v -= sign * cost;
    v += sign * W_BOMB * bombCount(hand, state.level);
  }
  return v;
}
