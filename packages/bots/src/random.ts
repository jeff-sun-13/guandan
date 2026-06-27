// Bot v0 — random legal. Picks uniformly among the legal moves. Its only job is to prove the
// engine + game loop run end-to-end; it plays no strategy whatsoever. See the ladder in
// docs/04-bots/roadmap.md (v1 heuristic is next).

import { nextInt } from "@guandan/engine";
import type { Observation, Move, Rng } from "@guandan/engine";
import type { Bot } from "./index";

export const randomBot: Bot = (_obs: Observation, legal: Move[], rng: Rng): Move => {
  if (legal.length === 0) throw new Error("randomBot got no legal moves");
  return legal[nextInt(rng, legal.length)] as Move;
};
