// Bot v2.0 — Perfect-Information Monte-Carlo (PIMC), the first bot that THINKS AHEAD.
//
// Idea (docs/04-bots/v2-search-design.md, ADR-0007): a bot only sees its own hand. To evaluate a
// move it samples plausible full deals ("determinizations") consistent with what it can see, plays
// each one out with a fast policy, and scores the result. The move with the best average outcome
// across the sampled worlds wins.
//
// This is the BASELINE rung. Per the prior art (docs/06-prior-art/pimc-uct-2020.md) naive PIMC was
// only "marginally better than random", so this is the floor to clear, not the destination — the
// next rungs are ISMCTS (over information sets, to fight strategy fusion) + belief-conditioned
// sampling + a cheaper/learned leaf evaluator. Kept deliberately simple and parameterised so we can
// measure each upgrade against it via `pnpm eval`.
//
// Leaf evaluation = a full rollout with `heuristicBot` driving ALL seats (single-player search with
// a greedy model of the other three — the GS2 trick, docs/06-prior-art/gs2.md §6). Common random
// numbers: the same K determinizations are reused for every candidate, so move comparisons aren't
// confounded by sampling noise (heuristic rollouts are deterministic, so this is exact).

import {
  determinize,
  applyMove,
  applyMoveTrusted,
  legalMoves,
  observe,
  isTerminal,
  result,
  teamOf,
  isBomb,
  type Observation,
  type Move,
  type Combo,
  type Player,
  type GameState,
  type Rng,
} from "@guandan/engine";
import type { Bot } from "./index";
import { heuristicBot } from "./heuristic";
import { staticDealValue } from "./static-eval";
import type { Sampler } from "./belief";

/** Scores a sampled world AFTER our candidate move, from our team's view (higher = better). */
export type LeafEvaluator = (state: GameState, myTeam: number, rng: Rng) => number;

export interface PimcOptions {
  /** Number of sampled worlds (determinizations) per decision. More = less noise, slower. */
  determinizations?: number;
  /** Cap on candidate moves actually searched (cheapest plays + forced/go-out + pass kept). */
  maxCandidates?: number;
  /** Policy used to roll each sampled world out to the deal's end. Default: the v1 heuristic. */
  rolloutBot?: Bot;
  /**
   * Leaf evaluator for a post-move world. Default: a full heuristic rollout (accurate, ~1ms). Pass
   * `staticLeaf` for a cheap static eval (~1µs) so you can afford far more determinizations and run
   * fast enough for the UI. (`rolloutBot` is ignored when `leaf` is set.)
   */
  leaf?: LeafEvaluator;
  /**
   * How sampled worlds are drawn. Default: uniform `determinize`. Pass a belief sampler
   * (`makeBeliefSampler`) to condition the hidden hands on observed passing behaviour.
   */
  sampler?: Sampler;
}

/** Value of a finished deal from `myTeam`'s view: +3/+2/+1 if we won (by partner finish), else −. */
function dealValue(finish: Player[], myTeam: number): number {
  const winTeam = teamOf(finish[0] as Player);
  const winSeats = [0, 1, 2, 3].filter((s) => teamOf(s) === winTeam);
  const winPos = winSeats.map((s) => finish.indexOf(s)).sort((a, b) => a - b);
  const partnerPos = winPos[1] as number; // 1, 2, or 3 (0 is the 1st-place winner)
  const mag = partnerPos === 1 ? 3 : partnerPos === 2 ? 2 : 1;
  return winTeam === myTeam ? mag : -mag;
}

/** Cheapest-first ordering key (mirrors the heuristic): low singles/pairs first, bombs last. */
function powerKey(c: Combo): number {
  if (!isBomb(c.type)) return c.rank; // 2..17
  if (c.type === "jokerBomb") return 100000;
  if (c.type === "straightFlush") return 10000 + c.rank;
  return 1000 + c.length * 100 + c.rank;
}

/** Trim the candidate set to `max`, always keeping pass and any hand-emptying (go-out) play. */
function prefilter(legal: Move[], obs: Observation, max: number): Move[] {
  if (legal.length <= max) return legal;
  const handSize = obs.hand.length;
  const must: Move[] = [];
  const plays: Extract<Move, { kind: "play" }>[] = [];
  for (const m of legal) {
    if (m.kind === "pass" || m.cards.length === handSize) must.push(m);
    else plays.push(m);
  }
  plays.sort((a, b) => powerKey(a.combo) - powerKey(b.combo));
  const room = Math.max(0, max - must.length);
  return [...must, ...plays.slice(0, room)];
}

/**
 * Play `s` to the end with `rolloutBot` for every seat; return the deal value for `myTeam`.
 * Fast-path: moves come from `legalMoves`, so `applyMoveTrusted` skips redundant re-validation; and
 * when the policy is the default `heuristicBot` (which never reads `outOfPlay`) we skip building that
 * O(108) array each ply. Both are pure (fresh state); equivalence is asserted in the engine tests.
 */
function rollout(s: GameState, myTeam: number, rolloutBot: Bot, rng: Rng): number {
  const lean = rolloutBot === heuristicBot; // heuristic provably ignores obs.outOfPlay
  let st = s;
  while (!isTerminal(st)) {
    const seat = st.toAct;
    const obs = lean ? observe(st, seat, { includeOutOfPlay: false }) : observe(st, seat);
    const mv = rolloutBot(obs, legalMoves(st, seat), rng);
    st = applyMoveTrusted(st, mv);
  }
  return dealValue(result(st), myTeam);
}

/** A cheap leaf: score the position statically, no rollout (see `static-eval.ts`). */
export const staticLeaf: LeafEvaluator = (state, myTeam) => staticDealValue(state, myTeam);

/** Build a PIMC bot with the given knobs. `pimcBot` (below) is the default configuration. */
export function makePimcBot(opts: PimcOptions = {}): Bot {
  const K = opts.determinizations ?? 20;
  const maxCandidates = opts.maxCandidates ?? 20;
  const rolloutBot = opts.rolloutBot ?? heuristicBot;
  const sample = opts.sampler ?? determinize;
  const leaf: LeafEvaluator =
    opts.leaf ?? ((s, myTeam, rng) => rollout(s, myTeam, rolloutBot, rng));

  return (obs: Observation, legal: Move[], rng: Rng): Move => {
    if (legal.length === 0) throw new Error("pimcBot got no legal moves");
    if (legal.length === 1) return legal[0] as Move; // forced — no search needed

    const myTeam = teamOf(obs.player);
    const candidates = prefilter(legal, obs, maxCandidates);

    // Sample K worlds once and reuse them for every candidate (common random numbers).
    const worlds: GameState[] = [];
    for (let k = 0; k < K; k++) worlds.push(sample(obs, rng));

    let best = candidates[0] as Move;
    let bestVal = -Infinity;
    for (const c of candidates) {
      let sum = 0;
      for (const w of worlds) {
        sum += leaf(applyMove(w, c), myTeam, rng);
      }
      const avg = sum / K;
      if (avg > bestVal) {
        bestVal = avg;
        best = c;
      }
    }
    return best;
  };
}

/** Default PIMC bot (bot v2.0), heuristic-rollout leaf. Accurate but slow (~seconds/move). */
export const pimcBot: Bot = makePimcBot();

/**
 * PIMC with the cheap static leaf (bot v2.1 candidate). Static eval is ~1000× faster than a
 * rollout, so we can afford many more determinizations and still move in ~milliseconds — fast
 * enough for the UI. Whether it's also *stronger* is an empirical question (see `pnpm eval`).
 */
export const pimcStaticBot: Bot = makePimcBot({
  leaf: staticLeaf,
  determinizations: 100,
  maxCandidates: 24,
});
