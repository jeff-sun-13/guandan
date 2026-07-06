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
  runoutBot,
  makePimcBot,
  pimcStaticBot,
  staticLeaf,
  makeIsmctsBot,
  makeBeliefSampler,
  makeLearnedLeaf,
  type NamedBot,
} from "@guandan/bots";
import { mlpFromJSON, FEATURE_SIZE, policyFromJSON, OBS_FEATURES } from "@guandan/nn";
import { makePolicyBot } from "@guandan/bots";

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
  // NOTE (2026-07-01): the default static leaf is now BOUNDED (3·tanh(raw/12) ∈ [-3,3]). The raw
  // unbounded leaf broke ISMCTS's (v+3)/6 normalisation — UCB exploration drowned + unfinished
  // positions outscored real wins — contaminating every static-leaf ISMCTS result before this date.
  ismcts: { name: "ismcts", bot: makeIsmctsBot() },
  "ismcts-fast": { name: "ismcts-fast", bot: makeIsmctsBot({ iterations: 600 }) },
  // The OLD broken config (raw unbounded static leaf), kept ONLY as the A/B control quantifying the
  // 2026-07-01 scale-bug fix. Do not build on it.
  "ismcts-rawleaf": { name: "ismcts-rawleaf", bot: makeIsmctsBot({ iterations: 600, leaf: staticLeaf }) },
  // Candidate-trimming A/B (2026-07-01): "perType" keeps bombs + the top single searchable at wide
  // nodes (the cheapest-only cap silently pruned them — see IsmctsOptions.candidates). Pairs differ
  // ONLY in the trimming scheme.
  "ismcts-pertype": { name: "ismcts-pertype", bot: makeIsmctsBot({ iterations: 600, candidates: "perType" }) },
  "ismcts-rollout-pertype": {
    name: "ismcts-rollout-pertype",
    bot: makeIsmctsBot({ iterations: 600, rollout: true, sampler: belief, candidates: "perType" }),
  },
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
  // 600 iters (~0.6s/move). Strong, but the budget-saturation curve (2026-06-29, Hetzner) shows
  // strength keeps climbing to ~1200 then PLATEAUS: Elo 150→1193, 300→1473, 600→1662, 1200→1842,
  // 1800→1877; 3600/7200 add nothing. So 600 is past the steep part but below the knee.
  "ismcts-rollout-big": {
    name: "ismcts-rollout-big",
    bot: makeIsmctsBot({ iterations: 600, rollout: true, sampler: belief }),
  },
  // Leaf/endgame A/B (run-out framework, 2026-06-30): IDENTICAL to -big (600 iters, same belief) except
  // the rollout policy bombs to start a winning RUN when ≤3 plays from out, not just defensively.
  // Isolates whether better in-rollout bomb timing lifts the champion. A/B: -v2 vs -big.
  "ismcts-rollout-v2": {
    name: "ismcts-rollout-v2",
    bot: makeIsmctsBot({ iterations: 600, rollout: true, rolloutBot: runoutBot, sampler: belief }),
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
  // *** SHIP TARGET *** — 1200 iters (~1s/move) is the strength/latency SWEET SPOT: the knee of the
  // saturation curve, statistically tied with 1800 (Elo 1842 vs 1877) at lower cost (changelog 2026-06-29).
  "ismcts-rollout-1200": {
    name: "ismcts-rollout-1200",
    bot: makeIsmctsBot({ iterations: 1200, rollout: true, sampler: belief }),
  },
  // --- Path A (ADR-0011): cross-trick history belief, A/B pairs (history ON vs OFF, else identical) ---
  // Fast static-leaf ISMCTS pair — cheap, high-n first read on whether cross-trick passing inference
  // helps. Belief is known to help static-leaf ISMCTS (gotchas 2026-06-26), so this isolates HISTORY.
  "ismcts-hist": {
    name: "ismcts-hist",
    bot: makeIsmctsBot({ iterations: 1200, sampler: makeBeliefSampler({ useHistory: true }) }),
  },
  "ismcts-nohist": {
    name: "ismcts-nohist",
    bot: makeIsmctsBot({ iterations: 1200, sampler: makeBeliefSampler({ useHistory: false }) }),
  },
  // Rollout-champion pair — confirms the effect on the actual champion config (slower).
  "ismcts-rollout-hist": {
    name: "ismcts-rollout-hist",
    bot: makeIsmctsBot({ iterations: 600, rollout: true, sampler: makeBeliefSampler({ useHistory: true }) }),
  },
  "ismcts-rollout-nohist": {
    name: "ismcts-rollout-nohist",
    bot: makeIsmctsBot({ iterations: 600, rollout: true, sampler: makeBeliefSampler({ useHistory: false }) }),
  },
  // --- Separated history lanes (2026-07-01) — A/B each against -nohist to find which lane pays ---
  // Lane 2 only: HARD tribute/resist constraints incl. the new exact-card pins (no passing memory).
  "ismcts-rollout-trib": {
    name: "ismcts-rollout-trib",
    bot: makeIsmctsBot({ iterations: 600, rollout: true, sampler: makeBeliefSampler({ useTributeInfo: true }) }),
  },
  // Lane 1 only: SOFT cross-trick passing reweight (the suspect half of Path A).
  "ismcts-rollout-pass": {
    name: "ismcts-rollout-pass",
    bot: makeIsmctsBot({ iterations: 600, rollout: true, sampler: makeBeliefSampler({ usePassHistory: true }) }),
  },
  // Exact-endgame rollout A/B (2026-07-01): rollouts stop at ≤8 cards and return the alpha-beta
  // solved value (endgame.ts) — every leaf gets an exact finish. Differs from -big ONLY in that.
  "ismcts-rollout-endgame": {
    name: "ismcts-rollout-endgame",
    bot: makeIsmctsBot({ iterations: 600, rollout: true, sampler: belief, endgameSolve: true }),
  },
  // The combined challenger (2026-07-01 overnight): exact-endgame rollouts + per-type candidates
  // together vs the plain champion config. If the singles A/Bs disagree with the combo, interactions
  // matter — measure, don't assume additivity.
  "ismcts-rollout-combo": {
    name: "ismcts-rollout-combo",
    bot: makeIsmctsBot({
      iterations: 600,
      rollout: true,
      sampler: belief,
      endgameSolve: true,
      candidates: "perType",
    }),
  },
  // Match-aware objective A/B (2026-07-01, value.ts dealValueCtx): at declarer-at-A deals 1-2/1-3
  // both = match win, 1-4 = a strike — the standard +3/+2/+1 is wrong there. Differs from
  // -nohist ONLY in useMatchContext. Gate with `pnpm evald ... --level=14 --score=match`.
  "ismcts-rollout-matchaware": {
    name: "ismcts-rollout-matchaware",
    bot: makeIsmctsBot({
      iterations: 600,
      rollout: true,
      sampler: makeBeliefSampler({ useHistory: false }),
      useMatchContext: true,
    }),
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
  const net = mlpFromJSON(readFileSync(WEIGHTS, "utf8"));
  if (net.sizes[0] !== FEATURE_SIZE) {
    // Stale net from an older encoding — registering it would score garbage silently (2026-07-01:
    // the encoding moved to v3/144 features and old data was ALSO level-2-only; regenerate).
    console.error(
      `[registry] skipping learned bots: value-weights.json expects ${net.sizes[0]} features, ` +
        `encoder now emits ${FEATURE_SIZE}. Regenerate: pnpm gen-data && pnpm train.`,
    );
  } else {
    const learnedLeaf = makeLearnedLeaf(net);
    REGISTRY["ismcts-learned"] = {
      name: "ismcts-learned",
      bot: makeIsmctsBot({ iterations: 600, sampler: belief, leaf: learnedLeaf }),
    };
    REGISTRY["pimc-learned"] = {
      name: "pimc-learned",
      bot: makePimcBot({ leaf: learnedLeaf, determinizations: 100, maxCandidates: 24, sampler: belief }),
    };
  }
}

// Policy bots (expert iteration, task 8) — registered when trained weights exist.
const POLICY_WEIGHTS = join(dirname(fileURLToPath(import.meta.url)), "data", "policy-weights.json");
if (existsSync(POLICY_WEIGHTS)) {
  const pnet = policyFromJSON(readFileSync(POLICY_WEIGHTS, "utf8"));
  if (pnet.obs.sizes[0] !== OBS_FEATURES) {
    console.error(
      `[registry] skipping policy bots: policy-weights.json expects ${pnet.obs.sizes[0]} obs features, ` +
        `encoder now emits ${OBS_FEATURES}. Re-run prep-policy-data + train-policy.`,
    );
  } else {
    const policyBot = makePolicyBot(pnet);
    // The raw apprentice — sanity gate: must crush `heuristic` (it distills a SEARCHED champion).
    REGISTRY["policy"] = { name: "policy", bot: policyBot };
    // THE expert-iteration challenger: champion config but rollouts played by the apprentice
    // instead of the v1 heuristic. Gate vs ismcts-rollout-big (identical but for rolloutBot).
    REGISTRY["ismcts-rollout-net"] = {
      name: "ismcts-rollout-net",
      bot: makeIsmctsBot({ iterations: 600, rollout: true, sampler: belief, rolloutBot: policyBot }),
    };
  }
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
