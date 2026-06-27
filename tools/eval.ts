// Head-to-head bot evaluation CLI. Thin wrapper over the tested core in @guandan/bots/eval, fanned
// out across CPU cores via the parallel runner (so a strong-bot sweep finishes in a reasonable time).
//
// Usage (from repo root):
//   pnpm eval                          # heuristic vs random, 100 mirrored matches
//   pnpm eval heuristic random 200     # pick lineups + match count
//   pnpm eval pimc-static heuristic 60 --seed 1000
//   pnpm eval pimc-static heuristic 60 --jobs=4      # cap worker processes
//   pnpm eval heuristic random 50 --no-mirror --no-parallel
//
// Bots live in registry.ts (shared with the workers + the ladder). Every new bot should beat the
// previous one here before it ships (docs/04-bots/roadmap.md).

import { evaluateHeadToHead, formatReport } from "@guandan/bots";
import { resolveBot } from "./registry";
import { runParallelEval, defaultJobs } from "./parallel";

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
// also accept "--seed 1000" / "--jobs 4" (spaced) forms
const spaced = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i !== -1 ? argv[i + 1] : undefined;
};

const aName = positional[0] ?? "heuristic";
const bName = positional[1] ?? "random";
const matches = positional[2] ? Number(positional[2]) : 100;
const mirror = !flags.has("--no-mirror");
const startSeed = Number(opts.get("seed") ?? spaced("seed") ?? 1);
const parallel = !flags.has("--no-parallel");
const jobs = Number(opts.get("jobs") ?? spaced("jobs") ?? defaultJobs());

// Resolve here too, for a clean error message before doing any work.
resolveBot(aName);
resolveBot(bName);
if (!Number.isFinite(matches) || matches <= 0) {
  console.error("error: matches must be a positive number");
  process.exit(1);
}

const useJobs = parallel ? Math.max(1, Math.min(jobs, matches)) : 1;
const label = `${matches} match${matches === 1 ? "" : "es"}${mirror ? " (mirrored → 2× games)" : ""}`;
console.log(`\nEvaluating: ${label}, seeds from ${startSeed}${useJobs > 1 ? `, ${useJobs} workers` : ""}\n`);

const t0 = Date.now();
const result =
  useJobs > 1
    ? await runParallelEval(aName, bName, { matches, startSeed, mirror, jobs: useJobs })
    : evaluateHeadToHead(resolveBot(aName), resolveBot(bName), { matches, startSeed, mirror });
const ms = Date.now() - t0;

console.log(formatReport(result));
console.log(`\n(${result.games} games in ${(ms / 1000).toFixed(1)}s — ${(result.games / (ms / 1000)).toFixed(1)} games/s)\n`);
