// Worker process for the parallel eval runner (parallel.ts). It evaluates ONE bot pair over a
// contiguous seed sub-range and prints the H2HResult as a single JSON line on stdout. Because
// win/loss counts are additive across disjoint seed ranges (see poolResults), the parent can split
// a long run across many of these and recombine into the exact numbers a single run would produce.
//
// Spawned as:  node --import tsx eval-worker.ts --a=NAME --b=NAME --start=N --count=N [--maxDeals=N] [--no-mirror]

import { evaluateHeadToHead } from "@guandan/bots";
import { resolveBot } from "./registry";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => !a.includes("=")));
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
const matches = Number(opts.get("count"));
const mirror = !flags.has("--no-mirror");
const maxDeals = opts.has("maxDeals") ? Number(opts.get("maxDeals")) : undefined;

const result = evaluateHeadToHead(a, b, { matches, startSeed, mirror, maxDeals });
// A single, machine-parseable line; the parent reads the last JSON line of stdout.
process.stdout.write(JSON.stringify(result) + "\n");
