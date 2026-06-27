// The bot registry: the single list of bots the eval CLI, parallel runner, and rating ladder all
// resolve names against. Extracted from eval.ts so worker processes (eval-worker.ts) can rebuild
// the exact same bots by name without inheriting the parent's closures.
//
// Add new bots here as the ladder grows (v2 MCTS, belief sampling, …); the ladder picks them up
// automatically and every new bot should beat the previous one (docs/04-bots/roadmap.md).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  randomBot,
  heuristicBot,
  makePimcBot,
  pimcStaticBot,
  staticLeaf,
  makeIsmctsBot,
  makeBeliefSampler,
  makeLearnedLeaf,
  type NamedBot,
} from "@guandan/bots";
import { mlpFromJSON } from "@guandan/nn";

// Belief-conditioned determinization (bot v2 step 4) — shared by the -belief variants below.
const belief = makeBeliefSampler();

export const REGISTRY: Record<string, NamedBot> = {
  random: { name: "random", bot: randomBot },
  heuristic: { name: "heuristic", bot: heuristicBot },
  // PIMC (bot v2.0), heuristic-rollout leaf. Default is playable; -fast is for quick eval sweeps.
  pimc: { name: "pimc", bot: makePimcBot({ determinizations: 20, maxCandidates: 16 }) },
  "pimc-fast": { name: "pimc-fast", bot: makePimcBot({ determinizations: 6, maxCandidates: 8 }) },
  // PIMC with the cheap static leaf (bot v2.1) — ~1000× faster leaf, many more worlds.
  "pimc-static": { name: "pimc-static", bot: pimcStaticBot },
  "pimc-static-big": {
    name: "pimc-static-big",
    bot: makePimcBot({ leaf: staticLeaf, determinizations: 400, maxCandidates: 32 }),
  },
  // ISMCTS (bot v2.2) — one infoset tree, static leaf. -fast/-big trade iterations for speed/strength.
  ismcts: { name: "ismcts", bot: makeIsmctsBot() },
  "ismcts-fast": { name: "ismcts-fast", bot: makeIsmctsBot({ iterations: 600 }) },
  "ismcts-big": { name: "ismcts-big", bot: makeIsmctsBot({ iterations: 4000, maxCandidates: 28 }) },
  // Belief-conditioned variants (bot v2 step 4): same search, hidden hands sampled from passing behaviour.
  "pimc-belief": {
    name: "pimc-belief",
    bot: makePimcBot({ leaf: staticLeaf, determinizations: 100, maxCandidates: 24, sampler: belief }),
  },
  "ismcts-belief": { name: "ismcts-belief", bot: makeIsmctsBot({ iterations: 600, sampler: belief }) },
  // *** CURRENT CHAMPION (bot v2.3) *** — ISMCTS + belief + heuristic ROLLOUT leaf. Beats pimc-static
  // ~82% (59–13/72, CI [71.5,89.1], 2026-06-26): the full "good search + belief + good leaf" combo.
  // Rollout is ~1000× the static leaf, so iterations stay low (informative per sample) → seconds/move
  // (too slow for UI, fine for the strength-first campaign). See changelog 2026-06-26.
  "ismcts-rollout": {
    name: "ismcts-rollout",
    bot: makeIsmctsBot({ iterations: 150, rollout: true, sampler: belief }),
  },
};

// Learned-leaf bots (bot v2.4, ADR-0010) — registered only if a trained net exists. The learned leaf
// is ~µs (vs the rollout's ~0.6ms), so ismcts-learned runs at static-leaf speed but, if the net is
// good, with rollout-class judgement. Train one with `pnpm gen-data` + `pnpm train`.
const WEIGHTS = join(dirname(fileURLToPath(import.meta.url)), "data", "value-weights.json");
if (existsSync(WEIGHTS)) {
  const learnedLeaf = makeLearnedLeaf(mlpFromJSON(readFileSync(WEIGHTS, "utf8")));
  REGISTRY["ismcts-learned"] = {
    name: "ismcts-learned",
    bot: makeIsmctsBot({ iterations: 600, sampler: belief, leaf: learnedLeaf }),
  };
  REGISTRY["pimc-learned"] = {
    name: "pimc-learned",
    bot: makePimcBot({ leaf: learnedLeaf, determinizations: 100, maxCandidates: 24, sampler: belief }),
  };
}

/** Resolve a bot name to its NamedBot, or exit with a helpful message. */
export function resolveBot(name: string): NamedBot {
  const b = REGISTRY[name];
  if (!b) {
    console.error(`error: unknown bot "${name}"`);
    console.error(`known bots: ${Object.keys(REGISTRY).join(", ")}`);
    process.exit(1);
  }
  return b;
}
