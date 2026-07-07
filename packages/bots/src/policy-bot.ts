// The apprentice (expert iteration, 2026-07-06): a Bot driven by the two-tower policy net that was
// distilled from the champion's root search statistics. Two jobs:
//   1. A fast standalone bot (µs/move) that plays like the searched champion — the first sanity
//      gate is that it crushes the v1 heuristic it effectively replaces.
//   2. THE ROLLOUT POLICY inside ISMCTS (`makeIsmctsBot({rolloutBot: policyBot})`): leaf playouts
//      at near-champion quality instead of v1-heuristic quality — the leaf-fidelity upgrade that
//      re-opens the budget curve (better leaf → each iteration more informative).
//
// Round-1 Gate 2 FAILED (2026-07-06, z=−8.64): the argmax apprentice as rollout policy made the
// champion WORSE. The two options below are the round-1b diagnosis levers:
//   - `temperature`: sample from softmax(scores/T) instead of argmax — restores the visit-like
//     move DIVERSITY the targets were trained on (argmax may collapse rollouts onto one biased line).
//   - `zeroHistory`: zero the history-derived obs features at inference. Pair with a net TRAINED
//     with the same zeroing (`train-policy.ts --zero-history 1`) so train and rollout distributions
//     match — inside simulated rollouts there is no threaded history, so those blocks are all-zero
//     while the round-1 net learned to rely on them (the distribution-shift suspect).

import {
  encodeObs,
  encodeAction,
  policyScores,
  OBS_HISTORY_RANGES,
  type PolicyNet,
} from "@guandan/nn";
import type { Bot } from "./index";
import { nextFloat, type Move, type Observation, type Rng } from "@guandan/engine";

export interface PolicyBotOptions {
  /** >0: sample from softmax(scores/temperature) instead of playing the argmax. */
  temperature?: number;
  /** Zero the history-derived obs features (use with a net trained via --zero-history). */
  zeroHistory?: boolean;
}

/** Build a bot from the policy net. Default: deterministic argmax on the full observation. */
export function makePolicyBot(net: PolicyNet, opts: PolicyBotOptions = {}): Bot {
  const T = opts.temperature ?? 0;
  const zeroHistory = opts.zeroHistory ?? false;
  return (obs: Observation, legal: Move[], rng: Rng): Move => {
    if (legal.length === 0) throw new Error("policyBot got no legal moves");
    if (legal.length === 1) return legal[0] as Move;
    const obsVec = encodeObs(obs);
    if (zeroHistory) for (const [s, e] of OBS_HISTORY_RANGES) obsVec.fill(0, s, e);
    const actVecs = legal.map((m) => encodeAction(m, obs.hand.length));
    const scores = policyScores(net, obsVec, actVecs);
    if (T > 0) {
      // Softmax with temperature, then one categorical draw from the injected rng.
      let max = -Infinity;
      for (let i = 0; i < scores.length; i++) if (scores[i]! > max) max = scores[i]!;
      let sum = 0;
      for (let i = 0; i < scores.length; i++) {
        const e = Math.exp((scores[i]! - max) / T);
        scores[i] = e;
        sum += e;
      }
      let u = nextFloat(rng) * sum;
      for (let i = 0; i < scores.length; i++) {
        u -= scores[i]!;
        if (u <= 0) return legal[i] as Move;
      }
      return legal[scores.length - 1] as Move; // float underflow fallback
    }
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i;
    return legal[best] as Move;
  };
}
