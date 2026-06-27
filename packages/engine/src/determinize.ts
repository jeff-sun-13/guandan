// Determinization: turn a single player's Observation into a full, concrete GameState by sampling
// the hidden hands. This is the foundation for decision-time search bots (PIMC / ISMCTS, bot v2 —
// see docs/04-bots/v2-search-design.md and ADR-0007).
//
// A bot only ever sees an Observation (its own hand + public info). To simulate forward with the
// engine it needs a full GameState with all four hands. `determinize` fills in the OTHER three
// seats by randomly distributing the pool of still-live cards (everything not in your hand and not
// already played) according to the known per-seat card counts.
//
// This version samples UNIFORMLY among card-consistent assignments. It does NOT yet use behavioural
// information (e.g. a seat that passed probably can't beat the current top) — belief-conditioned
// sampling is a later step in the v2 plan. Pure & deterministic given the RNG.

import { type Card, BIG_JOKER } from "./cards";
import { shuffle, cloneRng, type Rng } from "./rng";
import { type GameState, type Observation } from "./state";

/**
 * Sample a full GameState consistent with `obs`. Your own hand is kept exactly; the other seats'
 * hands are drawn uniformly at random (via `rng`) from the live-card pool and sized to match the
 * observed `handCounts`. Throws if the observation is internally inconsistent (the pool size must
 * equal the number of cards the other seats are known to hold).
 */
export function determinize(obs: Observation, rng: Rng): GameState {
  const me = obs.player;

  // pool = full deck (2 of each id) − my hand − cards already out of play.
  const counts = new Array<number>(BIG_JOKER + 1).fill(2);
  for (const c of obs.hand) (counts[c] as number)--;
  for (const c of obs.outOfPlay) (counts[c] as number)--;

  const pool: Card[] = [];
  for (let id = 0; id <= BIG_JOKER; id++) {
    const n = counts[id] as number;
    if (n < 0) throw new Error(`determinize: card ${id} over-counted (corrupt observation)`);
    for (let k = 0; k < n; k++) pool.push(id);
  }

  let need = 0;
  for (let p = 0; p < 4; p++) if (p !== me) need += obs.handCounts[p] as number;
  if (pool.length !== need) {
    throw new Error(`determinize: pool has ${pool.length} cards but other seats need ${need}`);
  }

  shuffle(rng, pool); // in place, deterministic
  const hands: Card[][] = [[], [], [], []];
  hands[me] = obs.hand.slice();
  let i = 0;
  for (let p = 0; p < 4; p++) {
    if (p === me) continue;
    const n = obs.handCounts[p] as number;
    const h = hands[p] as Card[];
    for (let k = 0; k < n; k++) h.push(pool[i++] as Card);
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
