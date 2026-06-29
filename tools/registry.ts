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
  // ISMCTS + belief + heuristic ROLLOUT leaf (bot v2.3). Beat pimc-static ~82% (59–13/72, 2026-06-26).
  // SUPERSEDED as champion 2026-06-28: at only 150 iters it loses 1–31 to -big below. Kept as the
  // budget baseline (the "150 iters" rung). Rollout is ~1000× the static leaf → seconds/move.
  "ismcts-rollout": {
    name: "ismcts-rollout",
    bot: makeIsmctsBot({ iterations: 150, rollout: true, sampler: belief }),
  },
  // *** CURRENT CHAMPION (bot v2.3b) *** — same bot as ismcts-rollout but 600 iterations. The
  // budget-crank test (2026-06-28, Hetzner) showed search budget scales the rollout leaf HARD: -big
  // beats the 150-iter version 31–1 / 32 = 96.9% (CI [84.3,99.4]). ~0.6s/move. The rollout leaf does
  // NOT plateau like the static-leaf ISMCTS did — strength is compute-elastic. See changelog 2026-06-28.
  "ismcts-rollout-big": {
    name: "ismcts-rollout-big",
    bot: makeIsmctsBot({ iterations: 600, rollout: true, sampler: belief }),
  },
  // 1800 iters (~2s/move). Being ranked against -big/-mega to map where budget saturates.
  "ismcts-rollout-huge": {
    name: "ismcts-rollout-huge",
    bot: makeIsmctsBot({ iterations: 1800, rollout: true, sampler: belief }),
  },
  // 3600 iters (~3s/move) — the frontier probe: a clean 2× of -huge, to see if strength keeps
  // climbing past 1800 or hits the knee. Continues the budget ladder (150 → 600 → 1800 → 3600).
  "ismcts-rollout-mega": {
    name: "ismcts-rollout-mega",
    bot: makeIsmctsBot({ iterations: 3600, rollout: true, sampler: belief }),
  },
  // 7200 iters (~6s/move) — the next rung past -mega; extends the saturation curve (overnight only,
  // too slow for live play). Tests whether strength STILL climbs at 4× the -huge budget.
  "ismcts-rollout-mega2": {
    name: "ismcts-rollout-mega2",
    bot: makeIsmctsBot({ iterations: 7200, rollout: true, sampler: belief }),
  },
  // Intermediate budget points — fill in the strength-vs-budget curve between the milestones above,
  // so we can locate the knee (where extra thinking stops paying) precisely across the playable range.
  "ismcts-rollout-300": {
    name: "ismcts-rollout-300",
    bot: makeIsmctsBot({ iterations: 300, rollout: true, sampler: belief }),
  },
  "ismcts-rollout-1200": {
    name: "ismcts-rollout-1200",
    bot: makeIsmctsBot({ iterations: 1200, rollout: true, sampler: belief }),
  },
  "ismcts-rollout-2400": {
    name: "ismcts-rollout-2400",
    bot: makeIsmctsBot({ iterations: 2400, rollout: true, sampler: belief }),
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
