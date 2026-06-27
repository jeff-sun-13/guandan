// Match orchestrator: runs a full Guandan match (many deals) between four bots, wiring together
// the engine's deal flow, tribute, and match scoring. This is the end-to-end "play a whole
// game vs bots" loop the web app and eval harness will both build on.
//
// Return-tribute currently uses the engine's `defaultReturnCard` policy (give back your lowest
// card). When a bot wants to choose its return card, that becomes a decision point here.

import {
  createMatch,
  dealLevel,
  isMatchOver,
  applyDealResult,
  createDeal,
  applyMove,
  isTerminal,
  result,
  observe,
  legalMoves,
  planTribute,
  defaultReturnCard,
  type Rng,
  type Card,
  type Player,
  type GameState,
  type Tribute,
} from "@guandan/engine";
import type { Bot } from "./index";

export interface MatchOutcome {
  /** Winning team (0 = seats {0,2}, 1 = seats {1,3}), or null if the deal cap was hit. */
  winner: number | null;
  /** How many deals were played. */
  deals: number;
}

/** Move one card out of a hand in place (it must be present). */
function takeCard(hand: Card[], card: Card): void {
  const i = hand.indexOf(card);
  if (i === -1) throw new Error(`tribute card ${card} not in hand`);
  hand.splice(i, 1);
}

/** Apply one tribute + its return on the freshly dealt hands (mutates `state.hands`). */
function exchangeTribute(state: GameState, t: Tribute, level: number): void {
  const payerHand = state.hands[t.payer] as Card[];
  const receiverHand = state.hands[t.receiver] as Card[];
  takeCard(payerHand, t.card);
  receiverHand.push(t.card);
  const back = defaultReturnCard(receiverHand, t.card, level);
  takeCard(receiverHand, back);
  payerHand.push(back);
}

/**
 * Play a complete match between four bots (seat-indexed). Deterministic given `rng`. `maxDeals`
 * guards against a pathological non-terminating run (returns winner: null if hit).
 */
export function playMatch(bots: Bot[], rng: Rng, maxDeals = 5000): MatchOutcome {
  let m = createMatch(rng);
  let prevFinish: Player[] | null = null;
  let deals = 0;

  while (!isMatchOver(m) && deals < maxDeals) {
    const level = dealLevel(m);
    const state = createDeal(level, m.rng); // first deal: RNG leader; later: overridden below

    if (prevFinish !== null) {
      const plan = planTribute(prevFinish, state.hands, level);
      if (!plan.cancelled) {
        for (const t of plan.tributes) exchangeTribute(state, t, level);
      }
      state.toAct = plan.leader;
    }

    let s = state;
    while (!isTerminal(s)) {
      const seat = s.toAct;
      const move = (bots[seat] as Bot)(observe(s, seat), legalMoves(s, seat), m.rng);
      s = applyMove(s, move);
    }

    const finish = result(s);
    m = applyDealResult(m, finish);
    prevFinish = finish;
    deals++;
  }

  return { winner: m.winner, deals };
}
