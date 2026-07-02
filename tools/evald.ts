// Paired per-deal A/B evaluation CLI — the high-power instrument for gating bot changes.
// Thin wrapper over the tested core in @guandan/bots/eval-deal, fanned out across CPU cores.
//
// Why use this instead of `pnpm eval`: the match harness resolves ~±10pp at realistic n; this one
// plays the SAME deal with seats swapped under common random numbers, so deal luck cancels exactly
// and 1–3% edges become measurable. See eval-deal.ts for the design.
//
// Usage (from repo root):
//   pnpm evald A B                      # 200 paired deals, levels 2..A, tribute contexts
//   pnpm evald A B 500 --seed 1000      # more deals, custom seed range
//   pnpm evald A B --auto               # sequential: run batches until |z| ≥ 3 or --max-deals
//   pnpm evald A B 200 --level=2        # pin the level (e.g. reproduce old level-2-only evals)
//   pnpm evald A B 200 --tribute-prob=0 # no tribute contexts
//   pnpm evald A B 200 --jobs=4 --no-parallel
//
// Verdict discipline: for a single fixed-n look, |z| ≥ 1.96 is the 95% bar. In --auto mode the
// runner peeks after every batch, so it demands |z| ≥ 3 before stopping — repeated looks at 1.96
// would inflate false positives well past 5%.

import { evaluateDealsPaired, poolDealResults, formatDealReport, type DealEvalResult } from "@guandan/bots";
import { resolveBot } from "./registry";
import { runParallelDealEval, defaultJobs } from "./parallel";

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
const opts = new Map(
  argv
    .filter((a) => a.startsWith("--") && a.includes("="))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v] as [string, string];
    }),
);
const spaced = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i !== -1 ? argv[i + 1] : undefined;
};
const num = (k: string, d: number): number => Number(opts.get(k) ?? spaced(k) ?? d);

const aName = positional[0] ?? "heuristic";
const bName = positional[1] ?? "random";
const batch = positional[2] ? Number(positional[2]) : 200;
const startSeed = num("seed", 1);
const jobs = num("jobs", defaultJobs());
const parallel = !flags.has("--no-parallel");
const auto = flags.has("--auto");
const maxDeals = num("max-deals", auto ? 4000 : batch);
const tributeProb = opts.has("tribute-prob") || spaced("tribute-prob") ? num("tribute-prob", 0.8) : undefined;
const level = opts.has("level") || spaced("level") ? num("level", 2) : undefined;
const levelMin = level ?? (opts.has("level-min") ? num("level-min", 2) : undefined);
const levelMax = level ?? (opts.has("level-max") ? num("level-max", 14) : undefined);
const scoreBy = (opts.get("score") ?? spaced("score")) === "match" ? ("match" as const) : undefined;

resolveBot(aName);
resolveBot(bName);
if (!Number.isFinite(batch) || batch <= 0) {
  console.error("error: deals must be a positive number");
  process.exit(1);
}

const dealOpts = { levelMin, levelMax, tributeProb, scoreBy };

async function runBatch(seed: number, deals: number): Promise<DealEvalResult> {
  const useJobs = parallel ? Math.max(1, Math.min(jobs, deals)) : 1;
  return useJobs > 1
    ? runParallelDealEval(aName, bName, { deals, startSeed: seed, jobs: useJobs, ...dealOpts })
    : evaluateDealsPaired(resolveBot(aName), resolveBot(bName), { deals, startSeed: seed, ...dealOpts });
}

const t0 = Date.now();
console.log(
  `\nPaired-deal eval: ${aName} vs ${bName} — batch ${batch}, seeds from ${startSeed}` +
    `${auto ? `, sequential until |z|≥3 or ${maxDeals} deals` : ""}` +
    `${level != null ? `, level pinned to ${level}` : ""}\n`,
);

const parts: DealEvalResult[] = [];
let seed = startSeed;
let played = 0;
let pooled: DealEvalResult | null = null;

while (played < maxDeals) {
  const deals = Math.min(batch, maxDeals - played);
  parts.push(await runBatch(seed, deals));
  seed += deals;
  played += deals;
  pooled = poolDealResults(parts);
  if (auto) {
    console.log(
      `  [${played} deals] edge ${pooled.meanEdge >= 0 ? "+" : ""}${pooled.meanEdge.toFixed(4)} pts/deal, z=${pooled.z.toFixed(2)}`,
    );
    if (Math.abs(pooled.z) >= 3) break;
  } else {
    break;
  }
}

const ms = Date.now() - t0;
console.log("\n" + formatDealReport(pooled as DealEvalResult));
console.log(
  `\n(${(pooled as DealEvalResult).deals} paired deals = ${2 * (pooled as DealEvalResult).deals} games in ${(ms / 1000).toFixed(1)}s)\n`,
);
