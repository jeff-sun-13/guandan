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
  type PublicHistory,
  type TributeEvent,
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

    // Public history for this deal (ADR-0011): the orchestrator records what the memoryless engine
    // doesn't, so bots can do cross-trick + tribute inference. Tribute first, then every pass below.
    const tribute: TributeEvent[] = [];
    if (prevFinish !== null) {
      const plan = planTribute(prevFinish, state.hands, level);
      if (!plan.cancelled) {
        for (const t of plan.tributes) {
          exchangeTribute(state, t, level);
          tribute.push({ giver: t.payer, card: t.card }); // the giver's highest single at tribute time
        }
      }
      state.toAct = plan.leader;
    }
    const history: PublicHistory = { passes: [], tribute };

    let s = state;
    while (!isTerminal(s)) {
      const seat = s.toAct;
      // Snapshot the history (cheap, once per real move — not in the hot search loop) so the bot sees
      // only events BEFORE its turn; record its pass AFTER it decides.
      const obs = { ...observe(s, seat), history: { passes: history.passes.slice(), tribute } };
      const move = (bots[seat] as Bot)(obs, legalMoves(s, seat), m.rng);
      if (move.kind === "pass" && s.trick) {
        history.passes.push({ seat, top: s.trick.topCombo, topPlayer: s.trick.topPlayer });
      }
      s = applyMove(s, move);
    }

    const finish = result(s);
    m = applyDealResult(m, finish);
    prevFinish = finish;
    deals++;
  }

  return { winner: m.winner, deals };
}
