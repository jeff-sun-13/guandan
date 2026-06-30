// Public API of the Guandan engine — the project's crown jewel.
// See docs/03-engine/design.md for the planned design and docs/01-rules/rules.md for the rules
// this engine implements.
//
// Hard rules for this package (see CLAUDE.md):
//   - No UI, no network, no I/O, no globals.
//   - All randomness flows through an injected seeded RNG (never Math.random()).
//   - State is plain, serializable data so it can be cloned and simulated cheaply.

export const ENGINE_VERSION = "0.0.0";
export const ENGINE_HELLO = "Guandan engine online";

// Seeded RNG (deterministic, serializable).
export {
  type Rng,
  makeRng,
  cloneRng,
  nextU32,
  nextFloat,
  nextInt,
  shuffle,
} from "./rng";

// Card model.
export {
  type Card,
  Suit,
  SMALL_JOKER,
  BIG_JOKER,
  RANK_J,
  RANK_Q,
  RANK_K,
  RANK_A,
  RANK_SMALL_JOKER,
  RANK_BIG_JOKER,
  makeCard,
  isJoker,
  cardRank,
  cardSuit,
  isWild,
  singleValue,
  makeDeck,
  cardLabel,
} from "./cards";

// Combo detection & comparison.
export {
  type Combo,
  type ComboType,
  classify,
  isLegalCombo,
  isBomb,
  beats,
} from "./combos";

// Game state & single-deal flow.
export {
  type GameState,
  type Move,
  type Player,
  type Trick,
  type Phase,
  type Observation,
  type PublicHistory,
  type PassEvent,
  type TributeEvent,
  partnerOf,
  teamOf,
  cloneState,
} from "./state";
export {
  createDeal,
  applyMove,
  applyMoveTrusted,
  isTerminal,
  result,
  observe,
  outOfPlayCards,
} from "./deal";
export { enumerateCombos, legalMoves } from "./moves";
export { determinize } from "./determinize";

// Match layer: multi-deal scoring, levels, win/demotion.
export {
  type MatchState,
  type DealScore,
  type FinishPattern,
  START_LEVEL,
  MAX_LEVEL,
  A_STRIKES_LIMIT,
  createMatch,
  dealLevel,
  scoreDeal,
  applyDealResult,
  isMatchOver,
} from "./match";

// Tribute / return tribute between deals.
export {
  type Tribute,
  type TributePlan,
  highestTributeCard,
  planTribute,
  defaultReturnCard,
} from "./tribute";
