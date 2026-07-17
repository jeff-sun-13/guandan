// The bot brain, off the main thread (ADR-0017; supersedes ADR-0005's main-thread simplification).
//
// The champion search bot burns ~1–2 s of CPU per decision; on the main thread that would freeze
// every tap and animation, so the controller posts each bot turn here instead. The engine/bots
// stack is pure TS with no I/O, so it bundles into a worker unchanged — and the belief sampler is
// documented to fall back to current-trick-only inference when no history is threaded (belief.ts),
// which is exactly the web app's situation.
//
// Requests are answered strictly in order (a worker runs one message at a time); the controller
// discards responses whose id no longer matches its newest request.

import { makeRng, type Rng } from "@guandan/engine";
import { heuristicBot, makeIsmctsBot, makeBeliefSampler, type Bot } from "@guandan/bots";
import type { Difficulty, MoveRequest, MoveResponse } from "./bot-protocol";

// Configs mirror tools/registry.ts so web play is the measured thing:
//   best = ismcts-rollout-huge  (THE champion: 1800 iters, ~2 s/move — status.md 2026-07-09)
//   fast = ismcts-rollout-1200  (the budget-curve knee: ~1 s/move at −0.17 pts/deal vs best)
//   easy = heuristic v1         (the original M1 opponent, instant)
const belief = makeBeliefSampler();
const BOTS: Record<Difficulty, Bot> = {
  best: makeIsmctsBot({ iterations: 1800, rollout: true, sampler: belief }),
  fast: makeIsmctsBot({ iterations: 1200, rollout: true, sampler: belief }),
  easy: heuristicBot,
};

// Bot decisions draw from the worker's own seeded RNG; the match RNG stays on the main thread and
// keeps dealing exactly as before. A fixed seed keeps bot lines reproducible for a given game.
const rng: Rng = makeRng(0x9e3779b9);

// The web tsconfig uses the DOM lib (this file is the only worker), so type `self` by hand.
const scope = self as { postMessage(msg: MoveResponse): void };

self.addEventListener("message", (e) => {
  const { id, difficulty, obs, legal } = (e as MessageEvent).data as MoveRequest;
  const bot = BOTS[difficulty] ?? heuristicBot;
  const t0 = performance.now();
  const move = bot(obs, legal, rng);
  scope.postMessage({ id, move, ms: performance.now() - t0 });
});
