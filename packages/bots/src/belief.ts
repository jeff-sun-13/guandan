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
  isWild,
  singleValue,
  shuffle,
  cloneRng,
  teamOf,
  nextFloat,
  BIG_JOKER,
  type Observation,
  type GameState,
  type Player,
  type Combo,
  type Card,
  type PassEvent,
  type Rng,
} from "@guandan/engine";

/** A determinization strategy: turn an observation into a concrete sampled world. */
export type Sampler = (obs: Observation, rng: Rng) => GameState;

export interface BeliefOptions {
  /** Uniform worlds drawn per determinization; one is chosen by plausibility. Default 6. */
  candidates?: number;
  /** Softmax temperature on the implausibility penalty (0 = uniform, higher = stricter). Default 1.5. */
  lambda?: number;
  /**
   * Legacy MASTER switch: when set, it is the default for BOTH granular lanes below. Default false
   * (history conditioning measured neutral-to-harmful as one bundle, 2026-06-30 — the lanes are now
   * separable precisely so we can find out WHICH part hurt).
   */
  useHistory?: boolean;
  /**
   * Lane 1 — SOFT cross-trick passing reweight over sampled worlds (Path A's suspect half: measured
   * ~neutral alone, and reweighting 6 worlds is a weak vehicle). Default: `useHistory`.
   */
  usePassHistory?: boolean;
  /**
   * Lane 2 — HARD tribute/resist constraints via constructive dealing (the lane that measured a win
   * in its ceiling-only form): giver rank ceilings + EXACT pins (2026-07-01) — the tribute card into
   * the receiver's hand, the return card into the giver's, resist pins/excludes the big jokers.
   * Pins are consumed as the pinned card is seen played (`history.plays`). Default: `useHistory`.
   */
  useTributeInfo?: boolean;
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
 * The pass constraints to score a world against. With the public history threaded (ADR-0011), use
 * EVERY pass this deal (cross-trick) — far more signal than one trick. Without it (web app, or an
 * internal simulated observation), fall back to the CURRENT trick only, derived from the snapshot —
 * so behaviour is unchanged where history isn't available.
 */
function passConstraints(obs: Observation, usePassHistory: boolean): PassEvent[] {
  if (usePassHistory && obs.history) return obs.history.passes;
  const trick = obs.trick;
  if (!trick) return [];
  return currentTrickPassers(obs).map((seat) => ({
    seat,
    top: trick.topCombo,
    topPlayer: trick.topPlayer,
  }));
}

/**
 * Does `seat` hold a NON-bomb play that beats `top` (held by `topPlayer`) in this world? If so,
 * passing it was less plausible. Reuses the engine's legal-move generator against a probe trick —
 * `legalMoves` facing a trick returns exactly the follows that beat the top (plus bombs + pass), so
 * a non-bomb play in that list means a cheap follow was available. Only `hands[seat]` is read.
 */
function canFollowNonBomb(world: GameState, seat: Player, top: Combo, topPlayer: Player): boolean {
  const probe: GameState = {
    level: world.level,
    hands: world.hands,
    toAct: seat,
    trick: { leader: topPlayer, topCombo: top, topPlayer, passes: 0 },
    finished: world.finished,
    rng: world.rng,
    phase: "playing",
  };
  for (const m of legalMoves(probe, seat)) {
    if (m.kind === "play" && !isBomb(m.combo.type)) return true;
  }
  return false;
}

/**
 * Implausibility of a sampled world: # of pass events where the passer was NOT on the top-holder's
 * team (so not just cooperatively yielding) yet could have cheaply followed in this world.
 */
function penaltyOf(world: GameState, constraints: PassEvent[]): number {
  let penalty = 0;
  for (const ev of constraints) {
    if (teamOf(ev.seat) === teamOf(ev.topPlayer)) continue; // letting your own side win — normal
    if (canFollowNonBomb(world, ev.seat, ev.top, ev.topPlayer)) penalty++;
  }
  return penalty;
}

/** Count how many copies of card id `card` seat `s` has already played this deal (consumes pins). */
function playedCount(obs: Observation, s: Player, card: Card): number {
  const plays = obs.history?.plays;
  if (!plays) return 0;
  let n = 0;
  for (const ev of plays) {
    if (ev.seat !== s) continue;
    for (const c of ev.cards) if (c === card) n++;
  }
  return n;
}

/**
 * Tribute/resist-constrained determinization (ADR-0011 Path A, generalized 2026-07-01): like the
 * engine's uniform `determinize`, but honoring every HARD deduction the tribute phase gives away:
 *  - CEILING: a giver paid their highest NON-WILD single, so their dealt hand holds nothing
 *    non-wild above it (jokers included — a non-joker tribute proves a jokerless giver).
 *  - PINS (exact cards): the tribute card is IN the receiver's hand and the return card is IN the
 *    giver's hand — until the pinned copy is seen played (`history.plays` consumes pins). Pinned
 *    cards bypass the ceiling (the return card may legally out-rank the giver's tribute).
 *  - RESIST: a "single" resist pins BOTH big jokers to the resister; a "double" resist proves the
 *    previous winners hold NO big joker (excluded from their sampled hands).
 * Deals pinned cards first, then the rest highest-first (most constrained) weighted by remaining
 * need; falls back to uniform `determinize` when there is nothing to constrain or no feasible deal.
 */
function determinizeWithTribute(obs: Observation, rng: Rng): GameState {
  const h = obs.history;
  if (!h || (h.tribute.length === 0 && !h.resist)) return determinize(obs, rng);
  const me = obs.player;
  const level = obs.level;

  // Per-seat ceiling on non-wild singleValue (givers only; `me` keeps its exact hand, never sampled).
  const ceiling = [Infinity, Infinity, Infinity, Infinity];
  for (const t of h.tribute) {
    if (t.giver === me) continue;
    ceiling[t.giver] = Math.min(ceiling[t.giver] as number, singleValue(t.card, level));
  }

  // Exact pins: pinned[seat] = card ids that MUST be in that seat's sampled hand (multiset), each
  // reduced by copies the seat has since played. Resist exclusions: seats that cannot hold a big joker.
  const pinned: Card[][] = [[], [], [], []];
  const pin = (seat: Player, card: Card, copies: number) => {
    if (seat === me) return;
    const remaining = copies - playedCount(obs, seat, card);
    for (let k = 0; k < remaining; k++) (pinned[seat] as Card[]).push(card);
  };
  for (const t of h.tribute) {
    pin(t.receiver, t.card, 1);
    pin(t.giver, t.returnCard, 1);
  }
  const noBigJoker = [false, false, false, false];
  if (h.resist) {
    if (h.resist.kind === "single") {
      pin(h.resist.holders[0] as Player, BIG_JOKER, 2);
    } else {
      for (let p = 0; p < 4; p++) {
        if (!h.resist.holders.includes(p)) noBigJoker[p] = true;
      }
    }
  }

  const constrained =
    ceiling.some((c) => c !== Infinity) || pinned.some((p) => p.length > 0) || noBigJoker.some(Boolean);
  if (!constrained) return determinize(obs, rng); // only `me` was involved — nothing to constrain

  // Live-card pool — mirror of engine `determinize`: full deck (2 of each id) − my hand − out of play.
  const counts = new Array<number>(BIG_JOKER + 1).fill(2);
  for (const c of obs.hand) (counts[c] as number)--;
  for (const c of obs.outOfPlay) (counts[c] as number)--;

  const need: number[] = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) if (p !== me) need[p] = obs.handCounts[p] as number;

  const hands: Card[][] = [[], [], [], []];
  hands[me] = obs.hand.slice();

  // 1. Place the pins (exempt from ceiling — see docstring). A pin that can't be honored (copy no
  //    longer in the pool, or the seat is already full) is silently skipped: it was consumed by an
  //    imprecisely-attributed play or the obs is mid-trick — never fabricate cards.
  for (let p = 0; p < 4; p++) {
    for (const card of pinned[p] as Card[]) {
      if ((counts[card] as number) > 0 && (need[p] as number) > 0) {
        (hands[p] as Card[]).push(card);
        (counts[card] as number)--;
        need[p] = (need[p] as number) - 1;
      }
    }
  }

  // 2. Deal the remaining pool, highest non-wild first (most constrained), weighted by need.
  const pool: Card[] = [];
  for (let id = 0; id <= BIG_JOKER; id++) {
    const n = counts[id] as number;
    if (n < 0) return determinize(obs, rng); // corrupt obs — let the engine path throw consistently
    for (let k = 0; k < n; k++) pool.push(id);
  }
  shuffle(rng, pool);
  const key = (c: Card) => (isWild(c, level) ? -1 : singleValue(c, level));
  pool.sort((a, b) => key(b) - key(a));

  for (const c of pool) {
    const wild = isWild(c, level);
    const cv = singleValue(c, level);
    // eligible hidden seats: still need cards, and can hold c (wild is exempt from the ceiling).
    let total = 0;
    for (let p = 0; p < 4; p++) {
      if (p === me || need[p] === 0) continue;
      if (!wild && cv > (ceiling[p] as number)) continue;
      if (c === BIG_JOKER && noBigJoker[p]) continue;
      total += need[p] as number;
    }
    if (total === 0) return determinize(obs, rng); // no feasible placement — fall back to uniform
    let r = Math.floor(nextFloat(rng) * total);
    let chosen = -1;
    for (let p = 0; p < 4; p++) {
      if (p === me || need[p] === 0) continue;
      if (!wild && cv > (ceiling[p] as number)) continue;
      if (c === BIG_JOKER && noBigJoker[p]) continue;
      r -= need[p] as number;
      if (r < 0) {
        chosen = p;
        break;
      }
    }
    (hands[chosen] as Card[]).push(c);
    need[chosen] = (need[chosen] as number) - 1;
  }

  return {
    level: obs.level,
    hands,
    toAct: obs.toAct,
    trick: obs.trick ? { ...obs.trick } : null,
    finished: obs.finished.slice(),
    rng: cloneRng(rng),
    phase: obs.phase,
  };
}

/** Base world sampler: tribute/resist-constrained when that info is present + enabled, else uniform. */
function baseDeterminize(obs: Observation, rng: Rng, useTributeInfo: boolean): GameState {
  if (useTributeInfo && obs.history && (obs.history.tribute.length > 0 || obs.history.resist)) {
    return determinizeWithTribute(obs, rng);
  }
  return determinize(obs, rng);
}

/**
 * Build a belief-conditioned sampler. Two SEPARABLE layers of inference (ADR-0011): HARD tribute/
 * resist constraints baked into the base determinization (lane 2), then SOFT importance-weighting
 * by passing plausibility (lane 1 — cross-trick when enabled, else current-trick only). Falls back
 * to plain uniform `determinize` when there's nothing to condition on, so it's never worse-informed
 * than uniform.
 */
export function makeBeliefSampler(opts: BeliefOptions = {}): Sampler {
  const M = Math.max(1, opts.candidates ?? 6);
  const lambda = opts.lambda ?? 1.5;
  // Master default OFF: the BUNDLED history conditioning measured ~neutral-to-HARMFUL on the rollout
  // champion (hist 33.3%, n=48, 2026-06-30 — but note that A/B ran on the then-broken unbounded
  // static leaf for the 1200-iter pair, and bundled BOTH lanes). The lanes are now separable and
  // individually gated on the paired-deal harness before any default flips.
  const master = opts.useHistory ?? false;
  const usePassHistory = opts.usePassHistory ?? master;
  const useTributeInfo = opts.useTributeInfo ?? master;

  return (obs: Observation, rng: Rng): GameState => {
    const constraints = passConstraints(obs, usePassHistory);
    // No passing signal → still apply the hard tribute/resist constraints (if any) via the base sampler.
    if (M === 1 || constraints.length === 0) return baseDeterminize(obs, rng, useTributeInfo);

    const worlds: GameState[] = [];
    const weights: number[] = [];
    let total = 0;
    for (let i = 0; i < M; i++) {
      const w = baseDeterminize(obs, rng, useTributeInfo);
      const wt = Math.exp(-lambda * penaltyOf(w, constraints));
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
