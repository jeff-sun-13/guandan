// Worker process for the parallel PAIRED-DEAL eval runner (parallel.ts runParallelDealEval).
// Evaluates one bot pair over a contiguous seed sub-range of paired deals and prints the
// DealEvalResult as a single JSON line. Σd/Σd²/histogram are additive over disjoint seed ranges,
// so the parent pools chunks into the exact single-thread numbers (poolDealResults).
//
// Spawned as:  node --import tsx evald-worker.ts --a=NAME --b=NAME --start=N --count=N
//              [--levelMin=N] [--levelMax=N] [--tributeProb=X]

import { evaluateDealsPaired } from "@guandan/bots";
import { resolveBot } from "./registry";

const args = process.argv.slice(2);
const opts = new Map(
  args
    .filter((a) => a.includes("="))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v] as [string, string];
    }),
);

const a = resolveBot(opts.get("a") ?? "");
const b = resolveBot(opts.get("b") ?? "");
const startSeed = Number(opts.get("start"));
const deals = Number(opts.get("count"));

const result = evaluateDealsPaired(a, b, {
  deals,
  startSeed,
  levelMin: opts.has("levelMin") ? Number(opts.get("levelMin")) : undefined,
  levelMax: opts.has("levelMax") ? Number(opts.get("levelMax")) : undefined,
  tributeProb: opts.has("tributeProb") ? Number(opts.get("tributeProb")) : undefined,
  scoreBy: opts.get("scoreBy") === "match" ? "match" : undefined,
});
process.stdout.write(JSON.stringify(result) + "\n");
