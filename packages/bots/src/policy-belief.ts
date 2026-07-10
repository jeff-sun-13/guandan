// Policy-likelihood belief (task 9, ADR-0016) — GIB/Skat-style world conditioning: weight
// determinized worlds by HOW LIKELY each hidden seat's OBSERVED actions are under the distilled
// policy net.
//
// Why this beats the hand-coded pass reweight (belief.ts lane 1): that lane scores one binary
// signal ("could a cross-team passer have cheaply followed?") over 6 candidate worlds — a weak
// vehicle for sharp per-player inference (the 2026-06-30 finding). Here EVERY past play and pass by
// a hidden seat becomes evidence, scored by a calibrated model of how the champion actually plays
// (the apprentice was distilled from the champion's root visit distributions, Gate 1 z=15.25). The
// partner runs literally this bot, so partner inference approaches exactness at ship time; the
// opponents in our gates are the champion the net imitates.
//
// The trick that makes it exact: likelihood factorizes per seat. The net conditions only on (own
// hand, public context), and a seat's hand at ANY past decision is its CURRENT hypothesized hand
// plus the cards it has since played (all public, attributed per seat since ADR-0014). So for a
// sampled world w: log L(w) = Σ_seat Σ_decision log P_net(observed move | reconstructed hand). The
// public part of each decision's observation is world-INDEPENDENT — computed once per root decision
// ("evidence contexts"), leaving only the 15 own-hand slots to fill per world (a first-layer delta
// pass, towerForwardFromPre1).
//
// Sampling: ISMCTS calls its Sampler EVERY iteration, but scoring a world costs ~1–3 ms — far too
// much per iteration. Instead we build a POOL of K base-sampled worlds once per root decision
// (cached by Observation identity — the orchestrator creates one obs object per real decision),
// weight them once, and let each iteration draw from the pool ∝ weight (importance resampling).
// Likelihoods are ε-mixed with uniform so a possible world is never hard-killed by an overconfident
// net, and weights are formed in log space (max-subtracted) for stability.
//
// Worlds are returned WITHOUT cloning: the engine's applyMove clones before mutating, so a pooled
// world can safely back many iterations (same invariant the engine relies on everywhere).

import {
  determinize,
  legalMoves,
  makeRng,
  nextFloat,
  type Card,
  type GameState,
  type Observation,
  type Player,
  type Rng,
  type Trick,
} from "@guandan/engine";
import {
  encodeAction,
  encodeObs,
  handRankCounts,
  towerForward,
  towerForwardFromPre1,
  towerPre1,
  type PolicyNet,
} from "@guandan/nn";
import { makeBeliefSampler, type Sampler } from "./belief";
import { moveKey, comboKey } from "./ismcts";

export interface PolicyBeliefOptions {
  /** Worlds in the per-decision pool. Default 64. */
  pool?: number;
  /** Rebuild the pool after this many draws (restores world diversity mid-search). 0 = never (default). */
  refresh?: number;
  /**
   * Per-decision uniform mixing ε: P'(a) = (1−ε)·P_net(a) + ε/k over the k legal moves. Bounds how
   * hard one decision can penalize a world (the net is a model, not an oracle). Default 0.15.
   */
  mix?: number;
  /** Exponent α on the pooled likelihood weights (w = L^α): <1 flattens a degenerate pool. Default 1. */
  power?: number;
  /**
   * Score only the most recent N hidden-seat decisions. Recent evidence is the sharpest (smaller
   * hands, more forced choices) and cost scales linearly with N. Default 40.
   */
  maxEvents?: number;
  /** Softmax temperature on the net's scores when forming likelihoods. Default 1 (trained calibration). */
  temperature?: number;
  /** Base-deal worlds with the HARD tribute/resist constraints (belief.ts lane 2). Default false. */
  useTributeInfo?: boolean;
  /** Diagnostics hook, called after each pool build (tests/calibration probes — not used in eval). */
  onPool?: (stats: PoolStats) => void;
}

export interface PoolStats {
  /** Evidence contexts scored per world. */
  contexts: number;
  /** Effective sample size of the weighted pool, (Σw)²/Σw² ∈ [1, pool]. */
  ess: number;
  /** Pool size. */
  pool: number;
}

/** One past decision by a hidden seat, with everything world-independent precomputed. */
interface EvidenceCtx {
  seat: Player;
  /** Obs-tower first-layer pre-activation of the PUBLIC template (own-hand slots empty). */
  pre1: Float32Array;
  /** The trick the seat faced (null = they led). */
  trick: Trick | null;
  /** What they did, as a public move signature ("pass" or type:rank:length). */
  observedKey: string;
  /** For plays: the exact cards (to add back when reconstructing this and earlier hands). */
  cards: Card[];
  /** The seat's hand size at the decision (public: 27 − cards they had shed). */
  handSize: number;
  /**
   * Act-tower embeddings cached by move signature — the action set is re-enumerated per world but
   * mostly overlaps. Same-key representatives can differ across worlds in wild usage (legalMoves
   * emits wild-minimal picks); the resulting one-slot rank-count drift is accepted noise.
   */
  actEmb: Map<string, Float32Array>;
}

interface Evidence {
  bySeat: Map<Player, EvidenceCtx[]>;
  contexts: number;
}

/** legalMoves never touches the rng; one shared dummy satisfies the GameState shape for probes. */
const PROBE_RNG = makeRng(0);

/**
 * Build the world-independent evidence for one root decision: replay the recorded public events in
 * `seq` order, and for every decision by a still-hidden seat (not the viewer, not finished — a
 * finished seat's whole timeline is public in hindsight, so its likelihood is constant across
 * worlds) snapshot the public observation and pre-encode it. Returns null when the history lacks
 * the exact-replay fields (seq/trick — older recorders), letting the sampler fall back cleanly.
 * Exported for tests.
 */
export function buildEvidence(obs: Observation, net: PolicyNet, maxEvents: number): Evidence | null {
  const h = obs.history;
  if (!h) return null;

  interface Ev {
    seq: number;
    seat: Player;
    trick: Trick | null;
    /** Play: the exact cards; pass: empty. */
    cards: Card[];
    observedKey: string;
  }
  const events: Ev[] = [];
  for (const p of h.plays) {
    if (p.seq === undefined || p.trick === undefined) return null;
    events.push({ seq: p.seq, seat: p.seat, trick: p.trick, cards: p.cards, observedKey: comboKey(p.combo) });
  }
  for (const p of h.passes) {
    if (p.seq === undefined || p.trick === undefined) return null;
    events.push({ seq: p.seq, seat: p.seat, trick: p.trick, cards: [], observedKey: "pass" });
  }
  if (events.length === 0) return null;
  events.sort((a, b) => a.seq - b.seq);

  // Score the LAST maxEvents qualifying decisions (a suffix, so a seat's later plays are always
  // included with any scored earlier one — the hand add-back walk relies on that).
  const qualifying: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as Ev;
    if (e.seat !== obs.player && (obs.handCounts[e.seat] as number) > 0) qualifying.push(i);
  }
  if (qualifying.length === 0) return null;
  const scored = new Set(qualifying.slice(Math.max(0, qualifying.length - maxEvents)));

  // Replay ALL events for the running public state; snapshot at scored ones (before applying).
  const counts = [27, 27, 27, 27];
  const outOfPlay: Card[] = [];
  const finished: Player[] = [];
  const bySeat = new Map<Player, EvidenceCtx[]>();
  let contexts = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i] as Ev;
    if (scored.has(i)) {
      const synth: Observation = {
        level: obs.level,
        player: e.seat,
        hand: [], // own-hand slots stay zero — filled per hypothesized world via first-layer deltas
        handCounts: counts.slice(),
        outOfPlay: outOfPlay.slice(),
        trick: e.trick ? { ...e.trick } : null,
        toAct: e.seat,
        finished: finished.slice(),
        phase: "playing",
        // No history on the synthetic obs: those feature blocks encode to zero, exactly matching
        // the nohist net's training distribution (--zero-history) — the net this sampler pairs with.
      };
      const ctx: EvidenceCtx = {
        seat: e.seat,
        pre1: towerPre1(net.obs, encodeObs(synth)),
        trick: e.trick,
        observedKey: e.observedKey,
        cards: e.cards,
        handSize: counts[e.seat] as number,
        actEmb: new Map(),
      };
      const arr = bySeat.get(e.seat);
      if (arr) arr.push(ctx);
      else bySeat.set(e.seat, [ctx]);
      contexts++;
    }
    if (e.cards.length > 0) {
      for (const c of e.cards) outOfPlay.push(c);
      counts[e.seat] = (counts[e.seat] as number) - e.cards.length;
      if (counts[e.seat] === 0) finished.push(e.seat);
    }
  }
  return contexts > 0 ? { bySeat, contexts } : null;
}

/** log of the ε-mixed net probability of the observed action, given the seat's hypothesized hand. */
function ctxLogLikelihood(
  net: PolicyNet,
  ctx: EvidenceCtx,
  hand: Card[],
  level: number,
  mix: number,
  temperature: number,
): number {
  // The legal moves this seat WOULD have had holding `hand` and facing ctx.trick.
  const hands: Card[][] = [[], [], [], []];
  hands[ctx.seat] = hand;
  const probe: GameState = {
    level,
    hands,
    toAct: ctx.seat,
    trick: ctx.trick ? { ...ctx.trick } : null,
    finished: [],
    rng: PROBE_RNG,
    phase: "playing",
  };
  const legal = legalMoves(probe, ctx.seat);
  const k = legal.length;
  if (k === 0) return Math.log(1e-12); // cannot happen for a consistent world; never fabricate certainty
  if (k === 1) return 0; // forced either way — no information

  // Obs embedding: public template pre-activation + own-hand columns (the only changed slots).
  const slots = handRankCounts(hand);
  const idx: number[] = [];
  const val: number[] = [];
  for (let s = 0; s < slots.length; s++) {
    if (slots[s] !== 0) {
      idx.push(s); // own-hand block sits at obs offset 0, so slot index == input column
      val.push(slots[s] as number);
    }
  }
  const oe = towerForwardFromPre1(net.obs, ctx.pre1, idx, val);

  const scores = new Float64Array(k);
  let obsIdx = -1;
  for (let i = 0; i < k; i++) {
    const m = legal[i]!;
    const key = moveKey(m);
    if (key === ctx.observedKey) obsIdx = i;
    let ae = ctx.actEmb.get(key);
    if (!ae) {
      ae = towerForward(net.act, encodeAction(m, ctx.handSize));
      ctx.actEmb.set(key, ae);
    }
    let s = 0;
    for (let e = 0; e < oe.length; e++) s += (oe[e] as number) * (ae[e] as number);
    scores[i] = s / temperature;
  }

  let pObs = 0;
  if (obsIdx >= 0) {
    let max = -Infinity;
    for (let i = 0; i < k; i++) if ((scores[i] as number) > max) max = scores[i] as number;
    let sum = 0;
    for (let i = 0; i < k; i++) sum += Math.exp((scores[i] as number) - max);
    pObs = Math.exp((scores[obsIdx] as number) - max) / sum;
  }
  // obsIdx === -1 (observed key unavailable under this hand) cannot happen when the world is
  // card-consistent — the played cards were added back — but the mixing floor keeps it finite.
  return Math.log((1 - mix) * pObs + mix / k);
}

/**
 * Σ log-likelihood of a sampled world over all evidence contexts. Per seat, walk its decisions
 * newest→oldest, growing the hand by each play's cards BEFORE scoring it (the cards were still
 * held at decision time). Exported for tests.
 */
export function worldLogLikelihood(
  net: PolicyNet,
  evidence: Evidence,
  world: GameState,
  level: number,
  mix: number,
  temperature: number,
): number {
  let logL = 0;
  for (const [seat, ctxs] of evidence.bySeat) {
    const hand = (world.hands[seat] as Card[]).slice();
    for (let i = ctxs.length - 1; i >= 0; i--) {
      const ctx = ctxs[i] as EvidenceCtx;
      for (const c of ctx.cards) hand.push(c);
      logL += ctxLogLikelihood(net, ctx, hand, level, mix, temperature);
    }
  }
  return logL;
}

interface Pool {
  worlds: GameState[];
  /** Cumulative weights (unnormalized); total = cum[K−1]. */
  cum: Float64Array;
  total: number;
  draws: number;
}

/**
 * Build a policy-likelihood belief sampler around `net` (pair it with the NOHIST apprentice —
 * synthetic observations carry no history, matching that net's training distribution). Falls back
 * to the base sampler (uniform, or tribute-constrained via `useTributeInfo`) whenever there is no
 * usable evidence: deal start, missing history, or a pre-seq recorder.
 */
export function makePolicyBeliefSampler(net: PolicyNet, opts: PolicyBeliefOptions = {}): Sampler {
  const K = Math.max(1, opts.pool ?? 64);
  const refresh = opts.refresh ?? 0;
  const mix = opts.mix ?? 0.15;
  const power = opts.power ?? 1;
  const maxEvents = opts.maxEvents ?? 40;
  const temperature = opts.temperature ?? 1;
  const base: Sampler = (opts.useTributeInfo ?? false)
    ? makeBeliefSampler({ candidates: 1, useTributeInfo: true })
    : determinize;
  // One pool per root decision: keyed by Observation identity (the orchestrators create a fresh obs
  // object per real move; every ISMCTS iteration passes that same object back in). null = this obs
  // has no usable evidence — remembered so the parse isn't repeated every iteration.
  const pools = new WeakMap<Observation, Pool | null>();

  const buildPool = (obs: Observation, rng: Rng): Pool | null => {
    const evidence = buildEvidence(obs, net, maxEvents);
    if (!evidence) return null;
    const worlds: GameState[] = [];
    const logs = new Float64Array(K);
    for (let i = 0; i < K; i++) {
      const w = base(obs, rng);
      worlds.push(w);
      logs[i] = worldLogLikelihood(net, evidence, w, obs.level, mix, temperature);
    }
    let max = -Infinity;
    for (let i = 0; i < K; i++) if ((logs[i] as number) > max) max = logs[i] as number;
    const cum = new Float64Array(K);
    let total = 0;
    let sumSq = 0;
    for (let i = 0; i < K; i++) {
      // max can only be -Infinity if every world scored 0 even after mixing (mix=0 misuse) — then
      // fall back to uniform weights rather than NaN.
      const w = Number.isFinite(max) ? Math.exp(power * ((logs[i] as number) - max)) : 1;
      total += w;
      sumSq += w * w;
      cum[i] = total;
    }
    opts.onPool?.({ contexts: evidence.contexts, ess: (total * total) / sumSq, pool: K });
    return { worlds, cum, total, draws: 0 };
  };

  return (obs: Observation, rng: Rng): GameState => {
    let pool = pools.get(obs);
    if (pool === undefined || (pool !== null && refresh > 0 && pool.draws >= refresh)) {
      pool = buildPool(obs, rng);
      pools.set(obs, pool);
    }
    if (pool === null) return base(obs, rng);
    pool.draws++;
    const r = nextFloat(rng) * pool.total;
    const cum = pool.cum;
    for (let i = 0; i < cum.length; i++) {
      if (r < (cum[i] as number)) return pool.worlds[i] as GameState;
    }
    return pool.worlds[cum.length - 1] as GameState;
  };
}
