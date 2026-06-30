// State encoding for the learned value/leaf net (ADR-0010/0012, docs/04-bots/learned-leaf-design.md).
//
// Turns a (determinized) full GameState into a fixed-length feature vector, from the perspective of
// the team we're scoring for. Everything is TEAM-RELATIVE — seats are reordered to [ourSeatA,
// ourSeatB, oppSeatA, oppSeatB] — so the net is symmetric across teams (a position and its mirror
// encode the same). The SAME encoder runs at data-gen (Node god-view) and inference (the ISMCTS leaf
// on a determinized world), so train/serve features match exactly.
//
// v2 (ADR-0012, Stage 1): the count-only v1 (86 feats) was the strength bottleneck — it discarded the
// tactical STRUCTURE a value function needs (run-out shape, bomb structure, control / who-can-beat-
// what). v2 keeps the raw rank-counts and APPENDS per-seat structural features + team control
// aggregates, guided by docs/04-bots/strategy-and-gaps.md (the "run-out" framework). Still pure-TS,
// lives in @guandan/nn so the engine stays pure.

import {
  cardRank,
  singleValue,
  isWild,
  SMALL_JOKER,
  BIG_JOKER,
  type Card,
  type GameState,
  type ComboType,
} from "@guandan/engine";

/** Stable combo-type order for one-hot encoding the current trick's top combo. */
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

const RANK_SLOTS = 15; // 13 ranks (2..14) + small joker + big joker
const HAND_BLOCK = 4 * RANK_SLOTS; // 60
const GLOBAL_BLOCK = 1 /*level*/ + 4 /*toAct*/ + 13 /*trick*/ + 4 /*finished*/ + 4 /*counts*/; // 26
const STRUCT_PER_SEAT = 8; // see seatStructure()
const STRUCT_BLOCK = 4 * STRUCT_PER_SEAT; // 32
const TEAM_BLOCK = 2 * 3; // per team: bombs, wilds, biggest-bomb power (6)
export const FEATURE_SIZE = HAND_BLOCK + GLOBAL_BLOCK + STRUCT_BLOCK + TEAM_BLOCK; // 124

/** Seat visiting order relative to `team`: our two seats, then the opponents' two. */
function seatOrder(team: number): [number, number, number, number] {
  return team === 0 ? [0, 2, 1, 3] : [1, 3, 0, 2];
}

/** "Power" of a bomb (mirrors the ordering 4<5<SF<6..<10<jokerBomb), for the biggest-bomb feature. */
function bombPower(rankSize: number, isJokerBomb: boolean): number {
  if (isJokerBomb) return 20;
  return rankSize; // 4..10 natural n-of-a-kind; straight-flush ~handled coarsely elsewhere
}

/**
 * Per-seat structural features (the "run-out" framework, strategy-and-gaps.md), 8 numbers:
 *  [0] playsToEmpty — distinct natural ranks + one per joker kind (runnability; fewer = closer to out)
 *  [1] bombs        — natural ranks with >=4 copies, + the four-joker bomb
 *  [2] singles      — natural ranks with exactly 1 copy (loose "garbage" — hard to shed, beatable)
 *  [3] pairs        — natural ranks with exactly 2 copies
 *  [4] triplesPlus  — natural ranks with exactly 3 copies (full-house / plate material)
 *  [5] wilds        — wild (Heart-of-level) cards held (flexible / near-top)
 *  [6] maxValNorm   — highest singleValue held / 17 (top "stopper" strength; control up top)
 *  [7] biggestBomb  — bombPower of the seat's biggest bomb / 20 (0 if none)
 */
function seatStructure(hand: Card[], level: number): number[] {
  const byRank = new Map<number, number>();
  let small = 0;
  let big = 0;
  let wilds = 0;
  let maxVal = 0;
  for (const c of hand) {
    if (c === SMALL_JOKER) small++;
    else if (c === BIG_JOKER) big++;
    else byRank.set(cardRank(c), (byRank.get(cardRank(c)) ?? 0) + 1);
    if (isWild(c, level)) wilds++;
    const v = singleValue(c, level);
    if (v > maxVal) maxVal = v;
  }
  let plays = byRank.size + (small > 0 ? 1 : 0) + (big > 0 ? 1 : 0);
  let bombs = 0;
  let singles = 0;
  let pairs = 0;
  let triples = 0;
  let biggestBomb = 0;
  for (const n of byRank.values()) {
    if (n >= 4) {
      bombs++;
      biggestBomb = Math.max(biggestBomb, bombPower(n, false));
    } else if (n === 3) triples++;
    else if (n === 2) pairs++;
    else if (n === 1) singles++;
  }
  if (small >= 2 && big >= 2) {
    bombs++;
    biggestBomb = Math.max(biggestBomb, bombPower(0, true));
  }
  return [plays, bombs, singles, pairs, triples, wilds, maxVal / 17, biggestBomb / 20];
}

/**
 * Encode `state` from `team`'s perspective into a length-`FEATURE_SIZE` Float32Array. Reads all four
 * hands, so it is meant for a full/determinized state (god view or a sampled world), not a hidden one.
 */
export function encodeState(state: GameState, team: number): Float32Array {
  const f = new Float32Array(FEATURE_SIZE);
  const order = seatOrder(team);
  let o = 0;

  // 4 seats × 15 rank/joker counts (raw counts; wild = heart-of-level counts in its natural rank).
  for (const seat of order) {
    const hand = state.hands[seat] ?? [];
    for (const c of hand) {
      const slot = c === SMALL_JOKER ? 13 : c === BIG_JOKER ? 14 : cardRank(c) - 2;
      const idx = o + slot;
      f[idx] = (f[idx] as number) + 1;
    }
    o += RANK_SLOTS;
  }

  // Level (the deal's elevated/wild rank), 2..14.
  f[o++] = state.level;

  // To-act seat, one-hot over the relative order (no bit set if the deal is over).
  const toActRel = order.indexOf(state.toAct);
  if (toActRel >= 0) f[o + toActRel] = 1;
  o += 4;

  // Trick: hasTrick + top-combo type one-hot(10) + top rank + passes.
  if (state.trick) {
    f[o] = 1;
    const ti = COMBO_TYPES.indexOf(state.trick.topCombo.type);
    if (ti >= 0) f[o + 1 + ti] = 1;
    f[o + 11] = state.trick.topCombo.rank;
    f[o + 12] = state.trick.passes;
  }
  o += 13;

  // Finished flag per relative seat.
  for (let i = 0; i < 4; i++) f[o + i] = state.finished.includes(order[i] as number) ? 1 : 0;
  o += 4;

  // Cards remaining per relative seat.
  for (let i = 0; i < 4; i++) f[o + i] = (state.hands[order[i] as number] ?? []).length;
  o += 4;

  // v2 — per-seat structural features (run-out / control), team-relative order.
  const struct: number[][] = [];
  for (const seat of order) {
    const s = seatStructure((state.hands[seat] ?? []) as Card[], state.level);
    struct.push(s);
    for (const v of s) f[o++] = v;
  }

  // v2 — team aggregates: [our bombs, our wilds, our biggest-bomb power], then opp's. (struct order is
  // [ourA, ourB, oppA, oppB]; bombs=idx1, wilds=idx5, biggestBomb=idx7.)
  const teamAgg = (a: number[], b: number[]) => [
    (a[1] as number) + (b[1] as number),
    (a[5] as number) + (b[5] as number),
    Math.max(a[7] as number, b[7] as number),
  ];
  for (const v of teamAgg(struct[0] as number[], struct[1] as number[])) f[o++] = v;
  for (const v of teamAgg(struct[2] as number[], struct[3] as number[])) f[o++] = v;

  return f;
}
