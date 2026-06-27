// @guandan/nn — encoding + (later) TS inference for the learned value/leaf net (ADR-0010).
// Pure TS, no runtime deps beyond the engine; the trained weights are loaded as plain data.

export { encodeState, FEATURE_SIZE } from "./encode";
