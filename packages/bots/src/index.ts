// Guandan bots. Every bot implements the SAME stable contract (docs/04-bots/roadmap.md):
//
//     type Bot = (obs, legal, rng) => Move
//
// A bot sees only the OBSERVABLE state (its own hand + public info), the list of legal moves,
// and a seeded RNG. It never touches the hidden full GameState. This contract never changes;
// only the body gets smarter as we climb the ladder v0 -> v1 -> v2 -> v3.

import type { Observation, Move, Rng } from "@guandan/engine";

/** The bot contract. Given what it can see, return one of the supplied legal moves. */
export type Bot = (obs: Observation, legal: Move[], rng: Rng) => Move;

export { randomBot } from "./random";
export { heuristicBot, runoutBot, makeHeuristicBot, type HeuristicOptions } from "./heuristic";
export { pimcBot, pimcStaticBot, makePimcBot, staticLeaf, type PimcOptions, type LeafEvaluator } from "./pimc";
export {
  ismctsBot,
  makeIsmctsBot,
  makeIsmctsSearcher,
  type IsmctsOptions,
  type IsmctsSearchResult,
  type IsmctsRootStat,
} from "./ismcts";
export { makeLearnedLeaf } from "./learned-leaf";
export { makePolicyBot } from "./policy-bot";
export { makeBeliefSampler, beliefSampler, currentTrickPassers, type Sampler, type BeliefOptions } from "./belief";
export {
  makePolicyBeliefSampler,
  buildEvidence,
  worldLogLikelihood,
  type PolicyBeliefOptions,
  type PoolStats,
} from "./policy-belief";
export { staticDealValue, boundedStaticValue, playsToEmpty, bombCount } from "./static-eval";
export { dealValue, dealValueCtx } from "./value";
export { solveEndgame, cardsRemaining, type EndgameSolve } from "./endgame";
export { playMatch, applyTributePlan, recordMove, type MatchOutcome } from "./arena";
export {
  evaluateHeadToHead,
  poolResults,
  formatReport,
  wilsonInterval,
  type NamedBot,
  type H2HOptions,
  type H2HResult,
} from "./eval";
export {
  evaluateDealsPaired,
  poolDealResults,
  formatDealReport,
  type DealEvalOptions,
  type DealEvalResult,
} from "./eval-deal";
export {
  fitBradleyTerry,
  formatLadder,
  type LadderEntry,
  type BradleyTerryOptions,
} from "./rating";
