// Bot v1 — heuristic. Hand-crafted rules, no search. Clearly stronger than v0 (random):
//   - Go out whenever a play empties the hand.
//   - Cooperate with your partner: don't beat a trick your partner is already winning.
//   - Conserve bombs: only bomb when an opponent is dangerously low (or to go out).
//   - When you must beat an opponent, use the cheapest sufficient non-bomb.
//   - When leading, shed cheap: lead your lowest cards, and don't fracture a pair to lead a
//     lone single.
// See docs/04-bots/roadmap.md (v1). Sees only the Observation — never the hidden full state.

import {
  type Move,
  type Observation,
  type Combo,
  type Card,
  isBomb,
  cardRank,
  partnerOf,
  teamOf,
} from "@guandan/engine";
import type { Bot } from "./index";
import { playsToEmpty } from "./static-eval";

type PlayMove = Extract<Move, { kind: "play" }>;
const PASS: Move = { kind: "pass" };

const isPlay = (m: Move): m is PlayMove => m.kind === "play";
const notBomb = (m: PlayMove): boolean => !isBomb(m.combo.type);

/** A "strength" key: bigger = stronger. Used to find the cheapest sufficient play. */
function powerKey(c: Combo): number {
  if (!isBomb(c.type)) return c.rank; // 2..17
  if (c.type === "jokerBomb") return 100000;
  if (c.type === "straightFlush") return 10000 + c.rank;
  return 1000 + c.length * 100 + c.rank;
}

function cheapest(plays: PlayMove[]): PlayMove {
  return plays.reduce((a, b) => (powerKey(b.combo) < powerKey(a.combo) ? b : a));
}

/** Fewest cards held by any opponent still in the deal (Infinity if none). */
function opponentMinCount(obs: Observation): number {
  let min = Infinity;
  for (let p = 0; p < 4; p++) {
    if (teamOf(p) !== teamOf(obs.player) && (obs.handCounts[p] ?? 0) > 0) {
      min = Math.min(min, obs.handCounts[p] as number);
    }
  }
  return min;
}

/** Choose a lead: lowest cards first; penalize breaking a pair to lead a lone single. */
function pickLead(plays: PlayMove[], obs: Observation): PlayMove {
  const rankCount = new Map<number, number>();
  for (const c of obs.hand) rankCount.set(cardRank(c), (rankCount.get(cardRank(c)) ?? 0) + 1);

  const cost = (m: PlayMove): number => {
    let c = m.combo.rank; // prefer low rank
    if (m.combo.type === "single") {
      const r = cardRank(m.cards[0] as Card);
      if ((rankCount.get(r) ?? 0) >= 2) c += 8; // don't fracture a pair for a single
    }
    c -= m.cards.length * 0.1; // mild preference to shed more cards at equal rank
    return c;
  };
  return plays.reduce((a, b) => (cost(b) < cost(a) ? b : a));
}

export interface HeuristicOptions {
  /**
   * "Run-out" bomb trigger (human's framework, `docs/04-bots/strategy-and-gaps.md`): when only a bomb
   * can beat the trick and we're CLOSE TO OUT (`playsToEmpty(hand) <= this`), spend the bomb to seize
   * tempo and run the rest of the hand out, instead of conserving it. 0 = off (the baseline). Default 0.
   */
  runOutBombPlays?: number;
}

/** Build a v1 heuristic bot. `heuristicBot` is the baseline (run-out trigger off). */
export function makeHeuristicBot(opts: HeuristicOptions = {}): Bot {
  const runK = opts.runOutBombPlays ?? 0;
  return (obs: Observation, legal: Move[]): Move => {
    const plays = legal.filter(isPlay);
    const handSize = obs.hand.length;

    // 1. Go out if any play empties the hand.
    const goOut = plays.find((m) => m.cards.length === handSize);
    if (goOut) return goOut;

    // 2. Leading: must play. Shed cheaply; avoid leading bombs.
    if (!obs.trick) {
      const nonBombs = plays.filter(notBomb);
      return pickLead(nonBombs.length > 0 ? nonBombs : plays, obs);
    }

    // 3. Following: legal plays already beat the trick.
    if (plays.length === 0) return PASS;

    // Cooperate: if a partner is already winning the trick, let them have it.
    if (obs.trick.topPlayer === partnerOf(obs.player)) return PASS;

    // Beat an opponent with the cheapest non-bomb if we have one.
    const nonBombBeats = plays.filter(notBomb);
    if (nonBombBeats.length > 0) return cheapest(nonBombBeats);

    // Only bombs can beat it. Spend one to DEFEND (an opponent is dangerously low), or to seize tempo
    // for a RUN when we're close to out (run-out framework); otherwise CONSERVE the bomb for late game.
    if (opponentMinCount(obs) <= 4) return cheapest(plays);
    if (runK > 0 && playsToEmpty(obs.hand, obs.level) <= runK) return cheapest(plays);
    return PASS;
  };
}

/** v1 heuristic — the baseline rollout policy (bombs only defensively). */
export const heuristicBot: Bot = makeHeuristicBot();

/** v1 heuristic + the run-out bomb trigger: also bombs to start a winning run when ≤3 plays from out. */
export const runoutBot: Bot = makeHeuristicBot({ runOutBombPlays: 3 });
