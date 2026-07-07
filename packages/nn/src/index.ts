// @guandan/nn — encoding + (later) TS inference for the learned value/leaf net (ADR-0010).
// Pure TS, no runtime deps beyond the engine; the trained weights are loaded as plain data.

export { encodeState, FEATURE_SIZE } from "./encode";
export {
  type MLP,
  type FitOptions,
  initMLP,
  predict,
  fit,
  mlpToJSON,
  mlpFromJSON,
} from "./mlp";
export { encodeObs, encodeAction, OBS_FEATURES, ACT_FEATURES, OBS_HISTORY_RANGES } from "./encode-policy";
export {
  type PolicyNet,
  type PolicyExample,
  type PolicyFitOptions,
  type PolicyGrads,
  initPolicyNet,
  initPolicyGrads,
  accumulateExample,
  fitPolicy,
  policyScores,
  softmaxScores,
  policyCE,
  policyToJSON,
  policyFromJSON,
  towerForward,
} from "./policy";
