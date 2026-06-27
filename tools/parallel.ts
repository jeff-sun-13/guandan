// Parallel eval runner: split a head-to-head over N matches into one contiguous seed-range chunk
// per CPU, run each chunk in its own worker process (eval-worker.ts), and pool the counts back into
// a single H2HResult. The pooled numbers are IDENTICAL to a single-threaded run (counts are additive
// over disjoint seeds — see poolResults + its test), we just get them ~cores× faster. This is the
// workhorse behind both `pnpm eval` and the rating ladder, since strong bots are seconds/move and a
// single thread caps a meaningful sweep at a handful of games (docs/gotchas.md, 2026-06-25).

import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { poolResults, type H2HResult } from "@guandan/bots";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, "eval-worker.ts");

export interface ParallelOptions {
  matches?: number; // base matches (doubled when mirror is on). Default 100.
  startSeed?: number; // first seed. Default 1.
  mirror?: boolean; // mirror each match with swapped seats. Default true.
  maxDeals?: number; // per-match deal cap. Default = core default.
  jobs?: number; // worker processes. Default = availableParallelism()-1, clamped to [1, matches].
}

/** Default worker count: leave one core for the OS/parent. */
export function defaultJobs(): number {
  return Math.max(1, availableParallelism() - 1);
}

/** Split `matches` base matches into `jobs` contiguous seed chunks: [{ startSeed, count }]. */
function chunkSeeds(matches: number, startSeed: number, jobs: number): { startSeed: number; count: number }[] {
  const n = Math.max(1, Math.min(jobs, matches));
  const base = Math.floor(matches / n);
  const rem = matches % n;
  const chunks: { startSeed: number; count: number }[] = [];
  let seed = startSeed;
  for (let i = 0; i < n; i++) {
    const count = base + (i < rem ? 1 : 0);
    if (count === 0) continue;
    chunks.push({ startSeed: seed, count });
    seed += count;
  }
  return chunks;
}

/** Run one worker chunk; resolve with its parsed H2HResult or reject with diagnostics. */
function runChunk(
  aName: string,
  bName: string,
  chunk: { startSeed: number; count: number },
  opts: ParallelOptions,
): Promise<H2HResult> {
  const args = [
    "--import",
    "tsx",
    WORKER,
    `--a=${aName}`,
    `--b=${bName}`,
    `--start=${chunk.startSeed}`,
    `--count=${chunk.count}`,
  ];
  if (opts.mirror === false) args.push("--no-mirror");
  if (opts.maxDeals != null) args.push(`--maxDeals=${opts.maxDeals}`);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: HERE });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`eval worker exited ${code}\n${err}`));
        return;
      }
      // Parse the last non-empty stdout line as JSON (ignore any incidental output).
      const line = out.trim().split("\n").filter(Boolean).pop();
      if (!line) {
        reject(new Error(`eval worker produced no output\n${err}`));
        return;
      }
      try {
        resolve(JSON.parse(line) as H2HResult);
      } catch (e) {
        reject(new Error(`eval worker output not JSON: ${line}\n${(e as Error).message}`));
      }
    });
  });
}

/**
 * Evaluate bot A vs bot B over many seeded matches, fanned out across worker processes, and return
 * the pooled H2HResult. `aName`/`bName` must exist in the registry (workers resolve them by name).
 */
export async function runParallelEval(aName: string, bName: string, opts: ParallelOptions = {}): Promise<H2HResult> {
  const matches = opts.matches ?? 100;
  const startSeed = opts.startSeed ?? 1;
  const jobs = Math.max(1, Math.min(opts.jobs ?? defaultJobs(), matches));
  const chunks = chunkSeeds(matches, startSeed, jobs);
  const parts = await Promise.all(chunks.map((c) => runChunk(aName, bName, c, opts)));
  return poolResults(parts);
}
