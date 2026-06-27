// Evaluation harness core: measure one bot lineup against another over many seeded matches and
// report a win rate with a confidence interval. This is the gate for ALL bot-strength work —
// "every new bot must beat the previous one to ship" (docs/04-bots/roadmap.md). The thin CLI in
// tools/ wraps this; the stats live here so they're unit-tested like the rest of the package.
//
// Fairness: Guandan has a first-leader/deal-luck element, so by default we MIRROR each match —
// play the same seeded deal sequence twice with the lineups swapped (A on team {0,2}, then A on
// team {1,3}). That cancels seat/deal advantage so the win rate reflects skill, not luck.

import { makeRng } from "@guandan/engine";
import type { Bot } from "./index";
import { playMatch } from "./arena";

/** A bot paired with a display name, for reporting. */
export interface NamedBot {
  name: string;
  bot: Bot;
}

export interface H2HOptions {
  /** Number of base matches (doubled when `mirror` is on). Default 100. */
  matches?: number;
  /** First RNG seed; matches use startSeed, startSeed+1, … Default 1. */
  startSeed?: number;
  /** Mirror each match with swapped seats to cancel deal luck. Default true. */
  mirror?: boolean;
  /** Per-match deal cap passed through to `playMatch`. Default 5000. */
  maxDeals?: number;
}

export interface H2HResult {
  botA: string;
  botB: string;
  /** Total games played (= matches, or 2×matches when mirrored). */
  games: number;
  winsA: number;
  winsB: number;
  /** Games that hit the deal cap with no winner (excluded from the win rate). */
  draws: number;
  /** winsA / (winsA + winsB) — A's share of decisive games. */
  winRateA: number;
  /** 95% Wilson score interval for `winRateA` over decisive games. */
  ci95: [number, number];
  /** Mean deals per game (a rough match-length signal). */
  avgDeals: number;
}

/**
 * Wilson score interval for a binomial proportion — better than the normal approximation at the
 * extremes (e.g. 60/60 wins), where it stays inside [0, 1] and doesn't collapse to zero width.
 */
export function wilsonInterval(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

/**
 * Play bot A's lineup against bot B's over `matches` seeded matches (mirrored by default), and
 * report A's win rate with a 95% CI. Deterministic for a given (bots, options). A's lineup sits at
 * team {0,2} in the first match of each mirrored pair and team {1,3} in the second.
 */
export function evaluateHeadToHead(a: NamedBot, b: NamedBot, opts: H2HOptions = {}): H2HResult {
  const matches = opts.matches ?? 100;
  const startSeed = opts.startSeed ?? 1;
  const mirror = opts.mirror ?? true;
  const maxDeals = opts.maxDeals ?? 5000;

  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let totalDeals = 0;
  let games = 0;

  const tally = (winner: number | null, aTeam: number, deals: number) => {
    games++;
    totalDeals += deals;
    if (winner === null) draws++;
    else if (winner === aTeam) winsA++;
    else winsB++;
  };

  for (let i = 0; i < matches; i++) {
    const seed = startSeed + i;
    // A on team {0,2}, B on team {1,3}.
    const o1 = playMatch([a.bot, b.bot, a.bot, b.bot], makeRng(seed), maxDeals);
    tally(o1.winner, 0, o1.deals);
    if (mirror) {
      // Same seeded deals, seats swapped: A now on team {1,3}.
      const o2 = playMatch([b.bot, a.bot, b.bot, a.bot], makeRng(seed), maxDeals);
      tally(o2.winner, 1, o2.deals);
    }
  }

  const decisive = winsA + winsB;
  return {
    botA: a.name,
    botB: b.name,
    games,
    winsA,
    winsB,
    draws,
    winRateA: decisive ? winsA / decisive : 0,
    ci95: wilsonInterval(winsA, decisive),
    avgDeals: games ? totalDeals / games : 0,
  };
}

/**
 * Combine several head-to-head results over DISJOINT seed ranges into one pooled result. Win/loss/
 * draw counts are additive, so a long run can be split across worker processes (each evaluating a
 * seed sub-range) and recombined here — the win rate and 95% CI are recomputed on the pooled totals,
 * giving the exact same numbers a single-threaded run would. All parts must share the same lineups.
 */
export function poolResults(parts: H2HResult[]): H2HResult {
  if (parts.length === 0) throw new Error("poolResults: nothing to pool");
  const { botA, botB } = parts[0] as H2HResult;
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let games = 0;
  let totalDeals = 0;
  for (const r of parts) {
    if (r.botA !== botA || r.botB !== botB) {
      throw new Error(`poolResults: mismatched lineups (${r.botA} vs ${r.botB}) ≠ (${botA} vs ${botB})`);
    }
    winsA += r.winsA;
    winsB += r.winsB;
    draws += r.draws;
    games += r.games;
    totalDeals += r.avgDeals * r.games; // avgDeals×games reconstructs that part's deal total
  }
  const decisive = winsA + winsB;
  return {
    botA,
    botB,
    games,
    winsA,
    winsB,
    draws,
    winRateA: decisive ? winsA / decisive : 0,
    ci95: wilsonInterval(winsA, decisive),
    avgDeals: games ? totalDeals / games : 0,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** A human-readable report block for a head-to-head result. */
export function formatReport(r: H2HResult): string {
  const [lo, hi] = r.ci95;
  const decisive = r.winsA + r.winsB;
  // The result is "significant" at 95% when the CI for A's win rate excludes 50%.
  let verdict: string;
  if (lo > 0.5) verdict = `${r.botA} is stronger (95% CI excludes 50%)`;
  else if (hi < 0.5) verdict = `${r.botB} is stronger (95% CI excludes 50%)`;
  else verdict = `inconclusive at 95% (CI straddles 50% — run more matches)`;

  return [
    `${r.botA}  vs  ${r.botB}`,
    `  games:    ${r.games}${r.draws ? ` (${r.draws} draw/cap)` : ""}`,
    `  ${r.botA} wins: ${r.winsA}   ${r.botB} wins: ${r.winsB}`,
    `  win rate (${r.botA}): ${pct(r.winRateA)}  [95% CI ${pct(lo)}–${pct(hi)}, n=${decisive}]`,
    `  avg deals/match: ${r.avgDeals.toFixed(1)}`,
    `  → ${verdict}`,
  ].join("\n");
}
