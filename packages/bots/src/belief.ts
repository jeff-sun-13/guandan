// Belief-conditioned determinization (bot v2 step 4, docs/04-bots/v2-search-design.md §4).
//
// Plain `determinize` (engine) samples the hidden hands UNIFORMLY among all card-consistent
// assignments. That ignores what players' actions just told us. The cheapest, most reliable signal
// available from a single Observation (no history needed, so the engine stays pure): WITHIN THE
// CURRENT TRICK, a player who PASSED while an OPPONENT held the top probably couldn't cheaply beat it
// — otherwise they'd usually have played. So when we sample a world, we should disfavour giving such
// a passer a hand that trivially beats the top. (Passing to let your PARTNER win is normal, so those
// passers get no penalty; bombs are often conserved, so only NON-bomb follows count against a passer.)
//
// This matters because PIMC/ISMCTS evaluate moves by simulating these sampled worlds: if the sampled
// opponents magically hold the cards they just declined to play, the search misjudges how safe a play
// is. Belief sampling makes the simulated opponents behave consistently with what we've seen — the
// documented unblock for ISMCTS (which minimises over opponent worlds) and a boost to PIMC.
//
// Implementation: importance sampling with a tiny candidate pool. Draw `candidates` uniform worlds,
// score each by an implausibility penalty (how many cross-team passers could cheaply follow), and
// pick one with probability ∝ exp(−λ·penalty). λ=0 recovers uniform; λ→∞ is greedy-most-plausible.
// This lives in @guandan/bots — it's a bot's model of the opponents, not an engine rule.

import {
  determinize,
  legalMoves,
  isBomb,
  teamOf,
  nextFloat,
  type Observation,
  type GameState,
  type Player,
  type Rng,
} from "@guandan/engine";

/** A determinization strategy: turn an observation into a concrete sampled world. */
export type Sampler = (obs: Observation, rng: Rng) => GameState;

export interface BeliefOptions {
  /** Uniform worlds drawn per determinization; one is chosen by plausibility. Default 6. */
  candidates?: number;
  /** Softmax temperature on the implausibility penalty (0 = uniform, higher = stricter). Default 1.5. */
  lambda?: number;
}

/**
 * Seats that passed in the CURRENT trick — the `passes` active seats immediately before `toAct` in
 * turn order. Derived purely from the Observation (the engine tracks no history). `toAct` is us, so
 * we never include ourselves; the seat just before the first passer is the trick's `topPlayer`.
 */
export function currentTrickPassers(obs: Observation): Player[] {
  const trick = obs.trick;
  if (!trick) return [];
  const active = (p: number) => !obs.finished.includes(p);
  const passers: Player[] = [];
  let p = obs.toAct;
  for (let k = 0; k < trick.passes; k++) {
    do {
      p = (p + 3) % 4; // previous seat
    } while (!active(p));
    passers.push(p);
  }
  return passers;
}

/**
 * Does `seat` hold a NON-bomb play that beats the current top? If so, passing was less plausible.
 * Reuses the engine's own legal-move generator against the real trick — `legalMoves` facing a trick
 * returns exactly the follows that beat the top (plus bombs + pass), so a non-bomb play in that list
 * means a cheap follow was available. Only `hands[seat]` and the trick are read.
 */
function canFollowNonBomb(world: GameState, seat: Player, obs: Observation): boolean {
  const probe: GameState = {
    level: world.level,
    hands: world.hands,
    toAct: seat,
    trick: obs.trick,
    finished: world.finished,
    rng: world.rng,
    phase: "playing",
  };
  for (const m of legalMoves(probe, seat)) {
    if (m.kind === "play" && !isBomb(m.combo.type)) return true;
  }
  return false;
}

/** Implausibility of a sampled world: # of cross-team passers who could have cheaply followed. */
function penaltyOf(world: GameState, obs: Observation, passers: Player[], topTeam: number): number {
  let penalty = 0;
  for (const p of passers) {
    if (teamOf(p) === topTeam) continue; // passing to let your own side win is normal — no penalty
    if (canFollowNonBomb(world, p, obs)) penalty++;
  }
  return penalty;
}

/**
 * Build a belief-conditioned sampler. Falls back to plain uniform `determinize` when there's nothing
 * to condition on (leading, or no cross-team passers), so it's never worse-informed than uniform.
 */
export function makeBeliefSampler(opts: BeliefOptions = {}): Sampler {
  const M = Math.max(1, opts.candidates ?? 6);
  const lambda = opts.lambda ?? 1.5;

  return (obs: Observation, rng: Rng): GameState => {
    const passers = currentTrickPassers(obs);
    if (M === 1 || passers.length === 0 || !obs.trick) return determinize(obs, rng);
    const topTeam = teamOf(obs.trick.topPlayer);

    const worlds: GameState[] = [];
    const weights: number[] = [];
    let total = 0;
    for (let i = 0; i < M; i++) {
      const w = determinize(obs, rng);
      const wt = Math.exp(-lambda * penaltyOf(w, obs, passers, topTeam));
      worlds.push(w);
      weights.push(wt);
      total += wt;
    }
    // Sample one world ∝ its weight.
    let r = nextFloat(rng) * total;
    for (let i = 0; i < M; i++) {
      r -= weights[i] as number;
      if (r <= 0) return worlds[i] as GameState;
    }
    return worlds[M - 1] as GameState;
  };
}

/** Default belief sampler (6 candidates, λ=1.5). */
export const beliefSampler: Sampler = makeBeliefSampler();
