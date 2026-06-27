// Rating ladder: play every registered bot against every other in a round-robin, fit a Bradley-
// Terry model to the full win matrix, and print an Elo-scaled leaderboard. This is the campaign
// scoreboard — instead of eyeballing pairwise win rates, every bot gets ONE number on a shared
// scale, so "is the new bot actually stronger, and by how much?" has a single answer.
//
// Results are cached to ladder.json keyed by the run config; re-running after adding a new bot only
// plays that bot's NEW pairings (the existing cells are reused), so the ladder grows cheaply.
//
// Usage (from repo root):
//   pnpm ladder                                  # all registered bots, 30 matches/pair
//   pnpm ladder 50                               # 50 matches/pair
//   pnpm ladder 50 heuristic pimc-static         # restrict to a subset
//   pnpm ladder 50 --fresh                        # ignore the cache and recompute every pair
//   pnpm ladder 50 --jobs=8 --seed=1

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fitBradleyTerry, formatLadder } from "@guandan/bots";
import { REGISTRY, resolveBot } from "./registry";
import { runParallelEval, defaultJobs } from "./parallel";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, "ladder.json");

interface Cell {
  first: string;
  second: string;
  winsFirst: number;
  winsSecond: number;
  draws: number;
  games: number;
}
interface Cache {
  updated: string;
  config: { matches: number; startSeed: number; mirror: boolean };
  cells: Record<string, Cell>;
}

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

const matches = positional[0] ? Number(positional[0]) : 30;
const subset = positional.slice(1);
const names = subset.length ? subset : Object.keys(REGISTRY);
names.forEach(resolveBot); // validate
if (!Number.isFinite(matches) || matches <= 0) {
  console.error("error: matches must be a positive number");
  process.exit(1);
}
const startSeed = Number(opts.get("seed") ?? spaced("seed") ?? 1);
const mirror = !flags.has("--no-mirror");
const jobs = Number(opts.get("jobs") ?? spaced("jobs") ?? defaultJobs());
const fresh = flags.has("--fresh");

const pairKey = (a: string, b: string) => [a, b].sort().join("__");

// Load the cache only if its config matches this run (else the cells aren't comparable).
let cells: Record<string, Cell> = {};
if (!fresh && existsSync(CACHE)) {
  try {
    const prev = JSON.parse(readFileSync(CACHE, "utf8")) as Cache;
    if (prev.config.matches === matches && prev.config.startSeed === startSeed && prev.config.mirror === mirror) {
      cells = prev.cells;
    } else {
      console.log("(cache config differs — recomputing all pairs)\n");
    }
  } catch {
    /* ignore a corrupt cache */
  }
}

// Build the list of pairs that still need playing.
const pairs: [string, string][] = [];
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = names[i]!;
    const b = names[j]!;
    if (!cells[pairKey(a, b)]) pairs.push([a, b]);
  }
}

const totalPairs = (names.length * (names.length - 1)) / 2;
console.log(
  `\nLadder: ${names.length} bots, ${matches} matches/pair${mirror ? " (mirrored)" : ""}, ${jobs} workers`,
);
console.log(`${totalPairs} pairings — ${pairs.length} to play, ${totalPairs - pairs.length} cached\n`);

const t0 = Date.now();
for (const [a, b] of pairs) {
  const sorted = [a, b].sort() as [string, string];
  process.stdout.write(`  ${sorted[0]} vs ${sorted[1]} … `);
  // Run with the FIRST (sorted) name as A so the cached cell is orientation-stable.
  const r = await runParallelEval(sorted[0], sorted[1], { matches, startSeed, mirror, jobs });
  cells[pairKey(a, b)] = {
    first: sorted[0],
    second: sorted[1],
    winsFirst: r.winsA,
    winsSecond: r.winsB,
    draws: r.draws,
    games: r.games,
  };
  console.log(`${r.winsA}–${r.winsB}${r.draws ? ` (${r.draws} draw)` : ""}`);
}

// Assemble the win matrix for the fit.
const idx = new Map(names.map((n, i) => [n, i]));
const wins: number[][] = Array.from({ length: names.length }, () => new Array(names.length).fill(0));
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const cell = cells[pairKey(names[i]!, names[j]!)];
    if (!cell) continue;
    const fi = idx.get(cell.first)!;
    const si = idx.get(cell.second)!;
    wins[fi]![si] = cell.winsFirst;
    wins[si]![fi] = cell.winsSecond;
  }
}

const ladder = fitBradleyTerry(names, wins);
console.log(`\n${formatLadder(ladder)}\n`);
console.log(`(${pairs.length} pairings played in ${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);

// Persist the full cache (all cells we have, not just this subset) for incremental reuse.
const out: Cache = { updated: new Date().toISOString(), config: { matches, startSeed, mirror }, cells };
writeFileSync(CACHE, JSON.stringify(out, null, 2));
console.log(`saved → ${CACHE}`);
