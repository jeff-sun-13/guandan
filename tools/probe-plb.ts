// Calibration probe for the policy-likelihood belief pool (task 9, ADR-0016).
//
// Plays a short plb-vs-champion match and reports, per root decision of the plb bot: evidence
// contexts scored, pool ESS (effective sample size — a degenerate pool collapses onto 1-2 worlds
// and loses the world diversity ISMCTS needs), pool build cost, and s/move vs the champion seat.
// Use it to pick pool/mix/power/maxEvents defaults BEFORE spending box hours on a gate:
//
//   pnpm --filter @guandan/tools exec tsx probe-plb.ts --deals=2 --iters=600
//   pnpm --filter @guandan/tools exec tsx probe-plb.ts --power=0.5 --mix=0.25   # flatter pool
//
// Local-machine note: single-core, a few minutes — fine on the dev machine (no pinned-core eval).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeRng, type Observation, type Rng, type GameState } from "@guandan/engine";
import { policyFromJSON } from "@guandan/nn";
import {
  playMatch,
  makeIsmctsBot,
  makeBeliefSampler,
  makePolicyBeliefSampler,
  type Bot,
  type PoolStats,
  type Sampler,
} from "@guandan/bots";

const argvNum = (k: string, d: number): number => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? Number(m.split("=")[1]) : d;
};
const iters = argvNum("iters", 600);
const deals = argvNum("deals", 2);
const pool = argvNum("pool", 64);
const mix = argvNum("mix", 0.15);
const power = argvNum("power", 1);
const maxEvents = argvNum("max-events", 40);
const seed = argvNum("seed", 4242);

const weightsPath = join(dirname(fileURLToPath(import.meta.url)), "data", "policy-weights-nohist.json");
const net = policyFromJSON(readFileSync(weightsPath, "utf8"));

const stats: PoolStats[] = [];
const inner = makePolicyBeliefSampler(net, { pool, mix, power, maxEvents, onPool: (s) => stats.push(s) });

// Wrap the sampler to time the pool build (the first draw for a given obs pays it).
const seen = new WeakSet<Observation>();
let buildMs = 0;
let builds = 0;
const sampler: Sampler = (obs: Observation, rng: Rng): GameState => {
  if (!seen.has(obs)) {
    seen.add(obs);
    builds++;
    const t = performance.now();
    const w = inner(obs, rng);
    buildMs += performance.now() - t;
    return w;
  }
  return inner(obs, rng);
};

const timeBot = (bot: Bot): { bot: Bot; ms: () => number; moves: () => number } => {
  let ms = 0;
  let moves = 0;
  const wrapped: Bot = (obs, legal, rng) => {
    const t = performance.now();
    const m = bot(obs, legal, rng);
    ms += performance.now() - t;
    moves++;
    return m;
  };
  return { bot: wrapped, ms: () => ms, moves: () => moves };
};

const plb = timeBot(makeIsmctsBot({ iterations: iters, rollout: true, sampler }));
const big = timeBot(makeIsmctsBot({ iterations: iters, rollout: true, sampler: makeBeliefSampler() }));

console.log(`probe: iters=${iters} deals≤${deals} pool=${pool} mix=${mix} power=${power} maxEvents=${maxEvents}`);
const out = playMatch([plb.bot, big.bot, plb.bot, big.bot], makeRng(seed), deals);
console.log(`played ${out.deals} deal(s)\n`);

const pct = (xs: number[], p: number): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN;
};
const essArr = stats.map((s) => s.ess);
const ctxArr = stats.map((s) => s.contexts);
console.log(`pools built: ${builds} (with evidence: ${stats.length})`);
if (stats.length > 0) {
  console.log(
    `contexts: p10=${pct(ctxArr, 10)} p50=${pct(ctxArr, 50)} p90=${pct(ctxArr, 90)} max=${Math.max(...ctxArr)}`,
  );
  console.log(
    `ESS/${pool}: p10=${pct(essArr, 10).toFixed(1)} p50=${pct(essArr, 50).toFixed(1)} ` +
      `p90=${pct(essArr, 90).toFixed(1)} min=${Math.min(...essArr).toFixed(1)}`,
  );
  console.log(`pool build: total ${(buildMs / 1000).toFixed(1)}s, mean ${(buildMs / builds).toFixed(1)}ms/decision`);
}
console.log(
  `s/move: plb ${(plb.ms() / plb.moves() / 1000).toFixed(2)} (${plb.moves()} moves) vs ` +
    `champion ${(big.ms() / big.moves() / 1000).toFixed(2)} (${big.moves()} moves)`,
);
