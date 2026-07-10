// Policy-net encoders (expert iteration, 2026-07-06). Unlike encode.ts (which encodes a
// DETERMINIZED full state for the value leaf — it sees all four hands), these encode what ONE seat
// actually observes: its own hand + all public information, INCLUDING the per-seat play attribution
// from the threaded history (ADR-0014) — the "who has shed what" model that is most of what a
// strong human tracks and that no previous component of this bot consumed.
//
// Two encoders because the policy net is a TWO-TOWER model (policy.ts): the observation is encoded
// once per decision (expensive tower), each legal action once (tiny tower), score = dot product —
// that is what makes a learned rollout policy affordable inside search (~140 plies × ~10 moves).
//
// Seats are encoded in RELATIVE turn order from the viewer: [me, next (right opponent), partner,
// previous (left opponent)] — team structure is then positional (slots 0/2 vs 1/3) for free.

import {
  cardRank,
  singleValue,
  isBomb,
  SMALL_JOKER,
  BIG_JOKER,
  type Card,
  type Move,
  type Observation,
  type ComboType,
} from "@guandan/engine";

const COMBO_TYPES: ComboType[] = [
  "single",
  "pair",
  "triple",
  "fullHouse",
  "straight",
  "tube",
  "plate",
  "bomb",
  "straightFlush",
  "jokerBomb",
];

const RANK_SLOTS = 15; // ranks 2..14 + small joker + big joker

/** Write a card multiset into 15 rank-count slots at `off`; returns the slot count. */
function addRankCounts(f: Float32Array, off: number, cards: Card[]): void {
  for (const c of cards) {
    const slot = c === SMALL_JOKER ? 13 : c === BIG_JOKER ? 14 : cardRank(c) - 2;
    const i = off + slot;
    f[i] = (f[i] as number) + 1;
  }
}

/**
 * Rank-slot counts (RANK_SLOTS entries: ranks 2..A, small joker, big joker) of a card multiset.
 * The obs layout's OWN-HAND block is exactly these counts at offset 0 — the ONLY obs features that
 * depend on hidden cards. A belief scorer exploits that: encode the public context once with an
 * empty hand (`encodeObs`), then treat these counts as first-layer column deltas per hypothesized
 * hand (`towerForwardFromPre1` in policy.ts) instead of re-encoding per world (task 9).
 */
export function handRankCounts(cards: Card[]): Float32Array {
  const f = new Float32Array(RANK_SLOTS);
  addRankCounts(f, 0, cards);
  return f;
}

// Observation layout (keep OBS_FEATURES in sync):
//   15 own-hand rank counts
//    1 level
//    4 hand counts (relative seats, /27)
//    4 finished flags
//   60 per-seat PLAYED rank counts (relative seats × 15 — the attribution model)
//   15 outOfPlay rank counts
//   21 trick: has + type(10) + rank/17 + passes/3 + topPlayer rel(4) + leader rel(4)
//   12 tribute per relative seat: [gave ceiling /17, received-card pinned flag, returned /17]
//    6 resist: kind onehot(2) + holders rel(4)
//    4 per-seat pass counts (/12, crude passing-history summary)
export const OBS_FEATURES = 15 + 1 + 4 + 4 + 60 + 15 + 21 + 12 + 6 + 4; // 142

// The obs-feature ranges [start, end) that are derived from `obs.history` and therefore ALL-ZERO
// inside simulated rollouts (no history is threaded there). Used to train/play "nohist" nets whose
// input distribution matches what rollouts actually see (the round-1 Gate-2 distribution-shift
// suspect): per-seat played counts (24–84) and tribute+resist+pass-counts (120–142).
export const OBS_HISTORY_RANGES: ReadonlyArray<readonly [number, number]> = [
  [15 + 1 + 4 + 4, 15 + 1 + 4 + 4 + 60],
  [OBS_FEATURES - (12 + 6 + 4), OBS_FEATURES],
];

/** Encode what `obs.player` can see into a fixed-length vector (the obs tower's input). */
export function encodeObs(obs: Observation): Float32Array {
  const f = new Float32Array(OBS_FEATURES);
  const me = obs.player;
  const rel = [me, (me + 1) % 4, (me + 2) % 4, (me + 3) % 4];
  const relIndex = (seat: number) => (seat - me + 4) % 4;
  let o = 0;

  addRankCounts(f, o, obs.hand);
  o += RANK_SLOTS;

  f[o++] = obs.level / 14; // all features live in ~[0, 2] — no standardization pass needed

  for (let i = 0; i < 4; i++) f[o + i] = (obs.handCounts[rel[i] as number] as number) / 27;
  o += 4;
  for (let i = 0; i < 4; i++) f[o + i] = obs.finished.includes(rel[i] as number) ? 1 : 0;
  o += 4;

  // Per-seat played cards — from the threaded history (empty when history is absent, e.g. plain
  // rollout observations; the net then falls back to the unattributed outOfPlay block below).
  if (obs.history) {
    for (const ev of obs.history.plays) {
      addRankCounts(f, o + relIndex(ev.seat) * RANK_SLOTS, ev.cards);
    }
  }
  o += 60;

  addRankCounts(f, o, obs.outOfPlay);
  o += RANK_SLOTS;

  if (obs.trick) {
    f[o] = 1;
    const ti = COMBO_TYPES.indexOf(obs.trick.topCombo.type);
    if (ti >= 0) f[o + 1 + ti] = 1;
    f[o + 11] = obs.trick.topCombo.rank / 17;
    f[o + 12] = obs.trick.passes / 3;
    f[o + 13 + relIndex(obs.trick.topPlayer)] = 1;
    f[o + 17 + relIndex(obs.trick.leader)] = 1;
  }
  o += 21;

  if (obs.history) {
    for (const t of obs.history.tribute) {
      const g = relIndex(t.giver);
      const r = relIndex(t.receiver);
      f[o + g * 3] = singleValue(t.card, obs.level) / 17; // giver's hard ceiling
      f[o + r * 3 + 1] = 1; // receiver holds the paid card (until seen played — soft flag)
      f[o + g * 3 + 2] = singleValue(t.returnCard, obs.level) / 17; // giver holds the return
    }
  }
  o += 12;

  if (obs.history?.resist) {
    f[o + (obs.history.resist.kind === "single" ? 0 : 1)] = 1;
    for (const h of obs.history.resist.holders) f[o + 2 + relIndex(h)] = 1;
  }
  o += 6;

  if (obs.history) {
    for (const p of obs.history.passes) {
      const i = o + relIndex(p.seat);
      f[i] = Math.min(1, (f[i] as number) + 1 / 12);
    }
  }
  o += 4;

  return f;
}

// Action layout (keep ACT_FEATURES in sync):
//    1 pass flag
//   10 combo type onehot
//    1 combo rank /17
//    1 cards played /27
//   15 cards rank counts
//    1 empties-my-hand flag
//    1 bomb flag
export const ACT_FEATURES = 1 + 10 + 1 + 1 + 15 + 1 + 1; // 30

/** Encode one legal move (the action tower's input). `handSize` = the mover's current hand size. */
export function encodeAction(move: Move, handSize: number): Float32Array {
  const f = new Float32Array(ACT_FEATURES);
  if (move.kind === "pass") {
    f[0] = 1;
    return f;
  }
  const ti = COMBO_TYPES.indexOf(move.combo.type);
  if (ti >= 0) f[1 + ti] = 1;
  f[11] = move.combo.rank / 17;
  f[12] = move.cards.length / 27;
  addRankCounts(f, 13, move.cards);
  f[28] = move.cards.length === handSize ? 1 : 0;
  f[29] = isBomb(move.combo.type) ? 1 : 0;
  return f;
}
