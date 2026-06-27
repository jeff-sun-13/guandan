// State encoding for the learned value/leaf net (ADR-0010, docs/04-bots/learned-leaf-design.md).
//
// Turns a (determinized) full GameState into a fixed-length feature vector, from the perspective of
// the team we're scoring for. Everything is TEAM-RELATIVE — seats are reordered to [ourSeatA,
// ourSeatB, oppSeatA, oppSeatB] — so the net is symmetric across the two teams (a position and its
// mirror encode the same way, halving what the net must learn). The SAME encoder is used at
// data-generation time (Node, god-view self-play) and at inference time (the ISMCTS leaf, on a
// determinized sampled world), so train/serve features match exactly.
//
// Features are RAW counts/values here; standardization (subtract mean, divide by std) is applied at
// train time and the stats are shipped to the TS inference path — keeping this encoder simple and
// stable. Lives in @guandan/nn (a learning concern), so the engine stays pure.

import {
  cardRank,
  SMALL_JOKER,
  BIG_JOKER,
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

// Layout (team-relative). Per seat in order [ourA, ourB, oppA, oppB]: 15 counts (ranks 2..14 = 13,
// + small joker + big joker). Then global features. See learned-leaf-design.md §3.
const RANK_SLOTS = 15; // 13 ranks (2..14) + small joker + big joker
const HAND_BLOCK = 4 * RANK_SLOTS; // 60
export const FEATURE_SIZE = HAND_BLOCK + 1 /*level*/ + 4 /*toAct*/ + 13 /*trick*/ + 4 /*finished*/ + 4 /*counts*/; // 86

/** Seat visiting order relative to `team`: our two seats, then the opponents' two. */
function seatOrder(team: number): [number, number, number, number] {
  return team === 0 ? [0, 2, 1, 3] : [1, 3, 0, 2];
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
      // slot within this seat's 15-wide block: jokers at 13/14, ranks 2..14 at 0..12.
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

  return f;
}
