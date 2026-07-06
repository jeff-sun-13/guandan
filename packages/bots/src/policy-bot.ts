// The apprentice (expert iteration, 2026-07-06): a Bot driven by the two-tower policy net that was
// distilled from the champion's root search statistics. Two jobs:
//   1. A fast standalone bot (µs/move) that plays like the searched champion — the first sanity
//      gate is that it crushes the v1 heuristic it effectively replaces.
//   2. THE ROLLOUT POLICY inside ISMCTS (`makeIsmctsBot({rolloutBot: policyBot})`): leaf playouts
//      at near-champion quality instead of v1-heuristic quality — the leaf-fidelity upgrade that
//      re-opens the budget curve (better leaf → each iteration more informative).
//
// Known round-1 caveat: the net was trained on observations WITH the threaded public history
// (played-card attribution); inside simulated rollouts there is no history, so those feature
// blocks are zero and the net leans on the unattributed outOfPlay block instead (designed-in
// fallback). Round 2 of the loop can thread simulated history through rollouts if gates suggest
// the gap matters.

import {
  encodeObs,
  encodeAction,
  policyScores,
  type PolicyNet,
} from "@guandan/nn";
import type { Bot } from "./index";
import type { Move, Observation, Rng } from "@guandan/engine";

/** Build a bot that plays the policy net's argmax move (deterministic, like the heuristic). */
export function makePolicyBot(net: PolicyNet): Bot {
  return (obs: Observation, legal: Move[], _rng: Rng): Move => {
    if (legal.length === 0) throw new Error("policyBot got no legal moves");
    if (legal.length === 1) return legal[0] as Move;
    const obsVec = encodeObs(obs);
    const actVecs = legal.map((m) => encodeAction(m, obs.hand.length));
    const scores = policyScores(net, obsVec, actVecs);
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i;
    return legal[best] as Move;
  };
}
