// Paired per-deal evaluation — the high-power A/B instrument (2026-07-01).
//
// Why this exists: the match-level harness (eval.ts) yields ONE bit per ~6-deal match, so its 95%
// CI at a realistic n=48–96 games is ±10–14 percentage points — far too blunt to see the 1–3%
// improvements mature bots gain per change. Three "neutral" results were read as "hand-coded
// ceiling reached" when the instrument simply couldn't resolve them (docs/progress/changelog.md
// 2026-06-30). This harness fixes the power problem with the duplicate-bridge trick:
//
//   Play the SAME deal twice — lineup A on team {0,2} vs B on {1,3}, then swapped — with identical
//   RNG streams (common random numbers). Per paired deal record d = x − y, where x is team {0,2}'s
//   deal value with A seated there and y is the same with B seated there. Deal luck (the dominant
//   variance term) cancels EXACTLY in the pairing: if A and B are the same bot, both replays are
//   identical games and d = 0 — zero variance, not just zero mean. A's per-deal edge is mean(d)/2,
//   tested with a paired z on the d samples. Each paired deal contributes a full ±6-range paired
//   sample instead of 1/6th of a binary match outcome.
//
// Deal contexts are sampled to look like real match play (the match harness only ever *starts*
// matches at level 2): the level is drawn uniformly from a range (default 2..A — the wild card
// moves with the level, so bots must be measured across levels), and most deals get a simulated
// previous-deal finish so tribute/return + leadership apply (mirroring arena.ts, including the
// PublicHistory threading, so belief/history bots behave exactly as they do in matches).
//
// Sums (Σd, Σd²) and the d-histogram are additive over disjoint seed ranges, so runs pool across
// worker processes to the exact single-thread numbers — same guarantee as poolResults (eval.ts).

import {
  makeRng,
  createDeal,
  applyMove,
  observe,
  legalMoves,
  isTerminal,
  result,
  planTribute,
  shuffle,
  nextInt,
  nextFloat,
  MAX_LEVEL,
  type GameState,
  type Player,
  type Rng,
  type PublicHistory,
  type MatchContext,
} from "@guandan/engine";
import type { Bot } from "./index";
import type { NamedBot } from "./eval";
import { applyTributePlan, recordMove } from "./arena";
import { dealValue, dealValueCtx } from "./value";

export interface DealEvalOptions {
  /** Paired deals to play (each is TWO games — lineups swapped on the identical deal). Default 200. */
  deals?: number;
  /** First RNG seed; paired deals use startSeed, startSeed+1, … Default 1. */
  startSeed?: number;
  /** Deal level range to sample uniformly (wild card moves with level). Default 2..14 (A). */
  levelMin?: number;
  levelMax?: number;
  /**
   * Probability a deal gets a simulated previous-deal finish → tribute/return + payer leads, as in
   * real match play (every deal after the first has this unless resisted). Default 0.8.
   */
  tributeProb?: number;
  /** Safety cap on moves per deal (a legal deal ends far earlier). Default 4000. */
  maxMoves?: number;
  /**
   * How the differential d is scored (2026-07-01). "points" (default): the standard ±3/±2/±1
   * deal value. "match": `dealValueCtx` under the deal's synthesized match context — use this when
   * A/B-ing match-aware objectives (at a declarer-at-A deal, raw points UNDERVALUE the correct
   * play: gambling for 1-2/1-3 instead of banking a worthless 1-4).
   */
  scoreBy?: "points" | "match";
}

export interface DealEvalResult {
  botA: string;
  botB: string;
  /** Paired deals played (each = 2 games on the identical deal). */
  deals: number;
  /** Σ d and Σ d² over paired deals, d = valueTeam02(A seated) − valueTeam02(B seated) ∈ [−6, 6]. */
  sumD: number;
  sumD2: number;
  /** Count of paired deals per integer differential d (keys "-6".."6") — shape diagnostic. */
  histogram: Record<string, number>;
  /** Paired deals where the two replays diverged at all (d ≠ 0 or any move differed is NOT tracked; this is d ≠ 0). */
  decisive: number;
  /** A's estimated deal-value edge per deal: mean(d)/2, in points (deal values are ±1/±2/±3). */
  meanEdge: number;
  /** Standard error of meanEdge (sd(d) / (2√n)). */
  se: number;
  /** meanEdge / se — the paired z statistic (0 when se is 0). */
  z: number;
}

/**
 * Set up one deal's full context from `seed` alone — level, hands, leader, simulated tribute, and
 * a synthesized MATCH context consistent with the sampled level — and return the ready-to-play
 * state + this deal's public records. Everything is derived from the seed BEFORE any bot acts, so
 * both arms of a paired deal get byte-identical contexts.
 */
function setupDeal(seed: number, opts: Required<Pick<DealEvalOptions, "levelMin" | "levelMax" | "tributeProb">>): {
  state: GameState;
  history: PublicHistory;
  matchCtx: MatchContext;
  rng: Rng;
} {
  const rng = makeRng(seed);
  const level = opts.levelMin + nextInt(rng, opts.levelMax - opts.levelMin + 1);
  const state = createDeal(level, rng, nextInt(rng, 4) as Player);

  // Match context consistent with the deal: the declarer's level IS the deal level; the other
  // team's level and the declarer's strike count are free — sample them so match-aware bots see
  // realistic variety (strikes only matter at A).
  const declarer = nextInt(rng, 2);
  const otherLevel = 2 + nextInt(rng, 13);
  const levels: [number, number] = declarer === 0 ? [level, otherLevel] : [otherLevel, level];
  const aStrikes: [number, number] = [0, 0];
  if (level === MAX_LEVEL) aStrikes[declarer as 0 | 1] = nextInt(rng, 3);
  const matchCtx: MatchContext = { levels, declarer, aStrikes };

  const history: PublicHistory = { passes: [], plays: [], tribute: [] };
  if (nextFloat(rng) < opts.tributeProb) {
    // Simulate the previous deal's finish order and apply tribute exactly as the match runner does
    // (shared arena.ts helper): payment + return, payer leads; resist recorded. The 1st finisher
    // must be on the DECLARER's team (the declarer is, by rule, the previous deal's winner).
    const declSeats: Player[] = declarer === 0 ? [0, 2] : [1, 3];
    const first = declSeats[nextInt(rng, 2)] as Player;
    const rest = shuffle(rng, ([0, 1, 2, 3] as Player[]).filter((p) => p !== first));
    const prevFinish: Player[] = [first, ...rest];
    const plan = planTribute(prevFinish, state.hands, level);
    const rec = applyTributePlan(state, plan, prevFinish, level);
    history.tribute = rec.tribute;
    if (rec.resist) history.resist = rec.resist;
  }
  return { state, history, matchCtx, rng };
}

/** Play one deal to the end with the given seat lineup; returns team {0,2}'s score (see scoreBy). */
function playDealOnce(lineup: Bot[], seed: number, opts: Required<DealEvalOptions>): number {
  const { state, history, matchCtx, rng } = setupDeal(seed, opts);

  let s = state;
  let moves = 0;
  while (!isTerminal(s)) {
    const seat = s.toAct;
    const obs = {
      ...observe(s, seat),
      matchCtx,
      history: {
        passes: history.passes.slice(),
        plays: history.plays.slice(),
        tribute: history.tribute,
        ...(history.resist ? { resist: history.resist } : {}),
      },
    };
    const move = (lineup[seat] as Bot)(obs, legalMoves(s, seat), rng);
    recordMove(history, s, seat, move);
    s = applyMove(s, move);
    if (++moves > opts.maxMoves) throw new Error(`deal exceeded ${opts.maxMoves} moves (seed ${seed})`);
  }
  const finish = result(s);
  return opts.scoreBy === "match" ? dealValueCtx(finish, 0, matchCtx) : dealValue(finish, 0);
}

/** Fill in every option default (single source of truth for the defaults). */
function withDefaults(opts: DealEvalOptions): Required<DealEvalOptions> {
  return {
    deals: opts.deals ?? 200,
    startSeed: opts.startSeed ?? 1,
    levelMin: opts.levelMin ?? 2,
    levelMax: opts.levelMax ?? 14,
    tributeProb: opts.tributeProb ?? 0.8,
    maxMoves: opts.maxMoves ?? 4000,
    scoreBy: opts.scoreBy ?? "points",
  };
}

/** Derive the summary statistics (meanEdge/se/z) from the additive sums. */
function finalize(
  botA: string,
  botB: string,
  deals: number,
  sumD: number,
  sumD2: number,
  histogram: Record<string, number>,
  decisive: number,
): DealEvalResult {
  const meanD = deals > 0 ? sumD / deals : 0;
  // Sample variance of d; guard n<2. sd(d)=0 happens legitimately (identical bots → every d=0).
  const varD = deals > 1 ? Math.max(0, (sumD2 - deals * meanD * meanD) / (deals - 1)) : 0;
  const se = deals > 0 ? Math.sqrt(varD) / (2 * Math.sqrt(deals)) : 0;
  const meanEdge = meanD / 2;
  return {
    botA,
    botB,
    deals,
    sumD,
    sumD2,
    histogram,
    decisive,
    meanEdge,
    se,
    z: se > 0 ? meanEdge / se : 0,
  };
}

/**
 * Paired per-deal evaluation of lineup A vs lineup B (see file header). Deterministic for a given
 * (bots, options); results over disjoint seed ranges pool exactly via `poolDealResults`.
 */
export function evaluateDealsPaired(a: NamedBot, b: NamedBot, options: DealEvalOptions = {}): DealEvalResult {
  const opts = withDefaults(options);
  let sumD = 0;
  let sumD2 = 0;
  let decisive = 0;
  const histogram: Record<string, number> = {};

  for (let i = 0; i < opts.deals; i++) {
    const seed = opts.startSeed + i;
    // Arm 1: A at {0,2}, B at {1,3}. Arm 2: swapped — the IDENTICAL deal + rng stream.
    const x = playDealOnce([a.bot, b.bot, a.bot, b.bot], seed, opts);
    const y = playDealOnce([b.bot, a.bot, b.bot, a.bot], seed, opts);
    const d = x - y;
    sumD += d;
    sumD2 += d * d;
    if (d !== 0) decisive++;
    const key = String(d);
    histogram[key] = (histogram[key] ?? 0) + 1;
  }

  return finalize(a.name, b.name, opts.deals, sumD, sumD2, histogram, decisive);
}

/**
 * Pool paired-deal results from DISJOINT seed ranges into one — Σd/Σd²/counts are additive, so the
 * pooled statistics equal a single run over the union (the parallel-worker guarantee, cf. poolResults).
 */
export function poolDealResults(parts: DealEvalResult[]): DealEvalResult {
  if (parts.length === 0) throw new Error("poolDealResults: nothing to pool");
  const { botA, botB } = parts[0] as DealEvalResult;
  let deals = 0;
  let sumD = 0;
  let sumD2 = 0;
  let decisive = 0;
  const histogram: Record<string, number> = {};
  for (const r of parts) {
    if (r.botA !== botA || r.botB !== botB) {
      throw new Error(`poolDealResults: mismatched lineups (${r.botA} vs ${r.botB}) ≠ (${botA} vs ${botB})`);
    }
    deals += r.deals;
    sumD += r.sumD;
    sumD2 += r.sumD2;
    decisive += r.decisive;
    for (const [k, v] of Object.entries(r.histogram)) histogram[k] = (histogram[k] ?? 0) + v;
  }
  return finalize(botA, botB, deals, sumD, sumD2, histogram, decisive);
}

/**
 * Human-readable report. Verdict thresholds: |z| ≥ 1.96 is the classic one-look 95% bar; for
 * SEQUENTIAL runs (peeking at a growing pool) demand |z| ≥ 3 before stopping on a positive — that
 * keeps the overall false-positive rate near 1% despite repeated looks.
 */
export function formatDealReport(r: DealEvalResult): string {
  let verdict: string;
  if (r.z >= 3) verdict = `${r.botA} is stronger (z ≥ 3 — safe even as a sequential stop)`;
  else if (r.z <= -3) verdict = `${r.botB} is stronger (z ≤ −3 — safe even as a sequential stop)`;
  else if (r.z >= 1.96) verdict = `${r.botA} likely stronger (z ≥ 1.96, single-look 95%; keep running if sequential)`;
  else if (r.z <= -1.96) verdict = `${r.botB} likely stronger (z ≤ −1.96, single-look 95%; keep running if sequential)`;
  else verdict = `inconclusive so far (|z| < 1.96)`;

  const hist = Object.entries(r.histogram)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .sort((p, q) => p[0] - q[0])
    .map(([k, v]) => `${k > 0 ? "+" : ""}${k}:${v}`)
    .join("  ");

  return [
    `${r.botA}  vs  ${r.botB}   (paired deals — same deal, seats swapped, common random numbers)`,
    `  paired deals: ${r.deals}   diverging (d≠0): ${r.decisive}`,
    `  edge (${r.botA}): ${r.meanEdge >= 0 ? "+" : ""}${r.meanEdge.toFixed(4)} deal-value pts/deal  (SE ${r.se.toFixed(4)}, z=${r.z.toFixed(2)})`,
    `  d histogram: ${hist}`,
    `  → ${verdict}`,
  ].join("\n");
}
