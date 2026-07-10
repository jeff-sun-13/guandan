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
  teamOf,
  type Rng,
  type Card,
  type Player,
  type GameState,
  type Tribute,
  type PublicHistory,
  type TributeEvent,
  type TributeResist,
  type TributePlan,
  type MatchContext,
  type Move,
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

/** Apply one tribute + its return on the freshly dealt hands (mutates `state.hands`); returns the return card. */
function exchangeTribute(state: GameState, t: Tribute, level: number): Card {
  const payerHand = state.hands[t.payer] as Card[];
  const receiverHand = state.hands[t.receiver] as Card[];
  takeCard(payerHand, t.card);
  receiverHand.push(t.card);
  const back = defaultReturnCard(receiverHand, t.card, level);
  takeCard(receiverHand, back);
  payerHand.push(back);
  return back;
}

/**
 * Execute a tribute plan on a freshly dealt state (mutates hands + toAct) and return the public
 * record: the full exchange (payment + return — both public, rules.md §8) and, when the plan was
 * CANCELLED by resist, which seats provably hold the big jokers (TributeResist). Shared by the
 * match runner and the paired-deal eval harness so history stays identical between them.
 */
export function applyTributePlan(
  state: GameState,
  plan: TributePlan,
  prevFinish: Player[],
  level: number,
): { tribute: TributeEvent[]; resist?: TributeResist } {
  state.toAct = plan.leader;
  if (plan.cancelled) {
    // Who resisted? After a 1-2 finish (winners took 1st+2nd) BOTH losers were payers; otherwise
    // only the last-place player pays — and a single resister holds BOTH big jokers.
    const doubleDown = teamOf(prevFinish[0] as Player) === teamOf(prevFinish[1] as Player);
    const resist: TributeResist = doubleDown
      ? { kind: "double", holders: [prevFinish[2] as Player, prevFinish[3] as Player] }
      : { kind: "single", holders: [prevFinish[3] as Player] };
    return { tribute: [], resist };
  }
  const tribute: TributeEvent[] = [];
  for (const t of plan.tributes) {
    const returnCard = exchangeTribute(state, t, level);
    tribute.push({ giver: t.payer, receiver: t.receiver, card: t.card, returnCard });
  }
  return { tribute };
}

/**
 * Record one decided move into the public history (plays and passes are both attributed). Also
 * stamps the global event order (`seq`) and the pre-move trick — recorded here, where the true
 * state is in hand, so a bot can later reconstruct the exact public context of ANY past decision
 * without re-deriving trick-close rules (policy-likelihood belief, task 9).
 */
export function recordMove(history: PublicHistory, s: GameState, seat: Player, move: Move): void {
  const seq = history.passes.length + history.plays.length;
  if (move.kind === "pass") {
    if (s.trick) {
      history.passes.push({ seat, top: s.trick.topCombo, topPlayer: s.trick.topPlayer, seq, trick: { ...s.trick } });
    }
  } else {
    history.plays.push({ seat, cards: move.cards, combo: move.combo, seq, trick: s.trick ? { ...s.trick } : null });
  }
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
    // doesn't — the tribute exchange (incl. return + resist), then every play AND pass, attributed
    // to its seat — so bots can do per-opponent inference + tribute-as-deduction.
    const history: PublicHistory = { passes: [], plays: [], tribute: [] };
    if (prevFinish !== null) {
      const plan = planTribute(prevFinish, state.hands, level);
      const rec = applyTributePlan(state, plan, prevFinish, level);
      history.tribute = rec.tribute;
      if (rec.resist) history.resist = rec.resist;
    }
    // Public match situation (levels/strikes/declarer are open information) — lets bots condition
    // the objective on the match, which matters at declarer-at-A deals (value.ts dealValueCtx).
    const matchCtx: MatchContext = {
      levels: [m.levels[0], m.levels[1]],
      declarer: m.declarer ?? -1,
      aStrikes: [m.aStrikes[0], m.aStrikes[1]],
    };

    let s = state;
    while (!isTerminal(s)) {
      const seat = s.toAct;
      // Snapshot the history (cheap, once per real move — not in the hot search loop) so the bot sees
      // only events BEFORE its turn; record its move AFTER it decides.
      const obs = {
        ...observe(s, seat),
        matchCtx,
        history: {
          passes: history.passes.slice(),
          plays: history.plays.slice(),
          tribute: history.tribute,
          ...(history.resist ? { resist: history.resist } : {}),
        },
      };
      const move = (bots[seat] as Bot)(obs, legalMoves(s, seat), m.rng);
      recordMove(history, s, seat, move);
      s = applyMove(s, move);
    }

    const finish = result(s);
    m = applyDealResult(m, finish);
    prevFinish = finish;
    deals++;
  }

  return { winner: m.winner, deals };
}
