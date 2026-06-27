// Rating model for the bot ladder. Pairwise win counts from a round-robin go in; an Elo-scaled
// strength for every bot comes out. We use the Bradley-Terry model (the principled choice for a
// round-robin: it fits one strength per player from the full win matrix at once, order-independent,
// unlike sequential Elo whose result depends on match order). Fitted by Zermelo/MM iteration
// (Hunter 2004) — a few lines, guaranteed to converge for a connected win graph.
//
// Pure and deterministic so it lives in @guandan/bots under vitest, alongside the rest of the
// strength-measurement core (eval.ts). The CLI in tools/ladder.ts feeds it a real round-robin.

export interface LadderEntry {
  name: string;
  /** Elo-scaled rating (mean across bots anchored to `base`). Higher = stronger. */
  elo: number;
  /** Bradley-Terry strength parameter (relative; geometric mean across bots = 1). */
  strength: number;
  wins: number;
  losses: number;
  /** Decisive games this bot played (wins + losses; draws excluded). */
  games: number;
}

export interface BradleyTerryOptions {
  /** Max MM iterations. Default 10000 (converges far sooner in practice). */
  iterations?: number;
  /** Convergence tolerance on the max relative strength change per sweep. Default 1e-10. */
  tol?: number;
  /**
   * Symmetric pseudo-count added to every ordered pair (a weak prior toward equality). Keeps
   * ratings finite when a bot wins or loses all its games. Negligible against hundreds of real
   * games. Default 0.5.
   */
  smoothing?: number;
  /** Elo anchor: the mean rating across bots. Default 1500. */
  base?: number;
  /** Elo points per decade of strength ratio. Default 400 (classic Elo scale). */
  scale?: number;
}

/**
 * Fit Bradley-Terry strengths from a pairwise win matrix and return Elo-scaled ladder entries,
 * sorted strongest first. `wins[i][j]` = number of decisive games player i won against player j.
 * The diagonal is ignored. Output Elo is centred so the geometric-mean strength maps to `base`.
 */
export function fitBradleyTerry(
  names: string[],
  wins: number[][],
  opts: BradleyTerryOptions = {},
): LadderEntry[] {
  const n = names.length;
  const iterations = opts.iterations ?? 10000;
  const tol = opts.tol ?? 1e-10;
  const s = opts.smoothing ?? 0.5;
  const base = opts.base ?? 1500;
  const scale = opts.scale ?? 400;

  if (n === 0) return [];

  // Smoothed win counts w[i][j] and total wins W[i]. Indices come from loops over 0..n, so they're
  // always in range — the `!` assertions are safe and just satisfy noUncheckedIndexedAccess.
  const w: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const W = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const wi = w[i]!;
    const winsI = wins[i];
    let total = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = (winsI?.[j] ?? 0) + s;
      wi[j] = v;
      total += v;
    }
    W[i] = total;
  }
  const games = (i: number, j: number) => w[i]![j]! + w[j]![i]!;

  // MM / Zermelo fixed-point: p_i ← W_i / Σ_{j≠i} n_ij / (p_i + p_j). Jacobi sweeps for determinism.
  let p: number[] = new Array<number>(n).fill(1);
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let denom = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        denom += games(i, j) / (p[i]! + p[j]!);
      }
      next[i] = denom > 0 ? W[i]! / denom : p[i]!;
    }
    // Normalize to geometric mean 1 so the scale is fixed (Elo is shift-invariant in log space).
    let logSum = 0;
    for (let i = 0; i < n; i++) logSum += Math.log(next[i]!);
    const g = Math.exp(logSum / n);
    let maxRel = 0;
    for (let i = 0; i < n; i++) {
      const ni = next[i]! / g;
      next[i] = ni;
      maxRel = Math.max(maxRel, Math.abs(ni - p[i]!) / p[i]!);
    }
    p = next;
    if (maxRel < tol) break;
  }

  const entries: LadderEntry[] = names.map((name, i) => {
    let wi = 0;
    let li = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      wi += wins[i]?.[j] ?? 0;
      li += wins[j]?.[i] ?? 0;
    }
    const pi = p[i]!;
    return {
      name,
      strength: pi,
      elo: base + scale * Math.log10(pi),
      wins: wi,
      losses: li,
      games: wi + li,
    };
  });

  entries.sort((a, b) => b.elo - a.elo);
  return entries;
}

/** Render a ladder as an aligned text table, strongest first. */
export function formatLadder(entries: LadderEntry[]): string {
  const nameW = Math.max(4, ...entries.map((e) => e.name.length));
  const header = `${"bot".padEnd(nameW)}   elo    W    L   games   win%`;
  const rows = entries.map((e) => {
    const wr = e.games ? ((100 * e.wins) / e.games).toFixed(1) : "  -";
    return [
      e.name.padEnd(nameW),
      String(Math.round(e.elo)).padStart(5),
      String(e.wins).padStart(4),
      String(e.losses).padStart(4),
      String(e.games).padStart(6),
      `${wr}%`.padStart(7),
    ].join(" ");
  });
  return [header, "-".repeat(header.length), ...rows].join("\n");
}
