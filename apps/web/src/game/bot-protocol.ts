// The message contract between the game controller (useGuandanGame.ts) and the bot Web Worker
// (bot-worker.ts). Everything here is plain serializable data — Observation, Move, and the card
// ids inside them are numbers/arrays/objects, so they cross postMessage via structured clone.

import type { Move, Observation } from "@guandan/engine";

/** Which bot plays the three non-human seats. Configs mirror tools/registry.ts (see bot-worker.ts). */
export type Difficulty = "best" | "fast" | "easy";

/** Main thread → worker: decide one move for the seat that produced this observation. */
export interface MoveRequest {
  /** Monotonic request id; the controller applies only the response matching its newest request. */
  id: number;
  difficulty: Difficulty;
  obs: Observation;
  legal: Move[];
}

/** Worker → main thread: the chosen move (echoes the request id). */
export interface MoveResponse {
  id: number;
  move: Move;
  /** Wall-clock ms the bot spent deciding — handy when tuning the strength/latency tradeoff. */
  ms: number;
}
