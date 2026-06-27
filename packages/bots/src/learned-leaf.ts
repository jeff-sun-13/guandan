// The learned value-net leaf (ADR-0010, step 4): a LeafEvaluator that scores a determinized world by
// running the trained net on its encoding — microseconds, vs ~0.6 ms for a heuristic rollout. Drop it
// into makeIsmctsBot/makePimcBot as `leaf` to get (hopefully) rollout-class strength at static-leaf
// speed. The net is produced by `pnpm gen-data` + `pnpm train`; load it with `mlpFromJSON`.

import { encodeState, predict, type MLP } from "@guandan/nn";
import type { LeafEvaluator } from "./pimc";

/** Build a leaf evaluator backed by a trained value net. */
export function makeLearnedLeaf(net: MLP): LeafEvaluator {
  return (state, team) => predict(net, encodeState(state, team));
}
