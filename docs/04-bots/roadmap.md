# Bot Roadmap — the long game

North star: **the strongest Guandan bots anywhere.** That's a research-grade goal; we get
there by a ladder of increasingly strong bots, each a drop-in replacement implementing the
same interface. The engine (see `03-engine/design.md`) is built so every rung is possible
without a rewrite.

> **Read the prior art first (`06-prior-art/`).** The two academic Guandan bots (DanZero,
> DanZero+) and our friend's guandan.cards bot are all documented and critiqued there. The
> short version that shapes this roadmap: **all three are reactive (no real decision-time
> search), the academic ones are opponent-blind, and none learns tribute.** Our planned v2
> (determinized search) targets exactly those gaps — see `06-prior-art/our-edge.md` for the
> full "how we beat them" analysis.

## The bot interface (stable contract)
```
type Bot = (obs: Observation, legal: Move[], rng: RNG) => Move
```
A bot sees only **observable** state (its hand + public info), the legal moves, and a seeded
RNG. This contract never changes; only the body gets smarter.

## The ladder
### v0 — Random legal  (M1)
Picks uniformly among legal moves. Purpose: prove the engine + UI loop end-to-end. Trivial.

### v1 — Heuristic  (M1)
Hand-crafted rules: hold bombs, dump singles early, don't break pairs/straights needlessly,
play over opponents but cooperate with partner, manage the level/wild cards, basic
endgame ("can I go out?"). Goal: clearly beats guandan.cards-level dumb play. Most of the
near-term "feels smart" value is here.

### v2 — Search / Determinized MCTS  (M2)  ← active design
Guandan is imperfect-information. Approach: sample plausible opponent/partner hands
consistent with observations ("determinizations"), run MCTS/rollouts on each sampled full
game, aggregate to pick a move. Needs the fast simulator the engine provides. This is the
first rung that can genuinely outplay strong humans in tactical spots.
**Concrete plan: `04-bots/v2-search-design.md` (ADR-0007).** Key lesson from prior art: naive
PIMC was only "marginally better than random" (`06-prior-art/pimc-uct-2020.md`), so plan for
ISMCTS + belief-conditioned sampling + a heuristic leaf evaluator, not bare determinized UCT.

### v3 — Learned (self-play)  (M4+)
Train a policy/value network via self-play (the engine runs headless at scale in Node, or we
port the hot loop to a faster lang if throughput demands). Likely an ISMCTS + neural net
guided search. This is the "best in the world" attempt.

## What makes this possible (engine requirements — keep true)
- Cheap state clone + `applyMove` + `legalMoves` = the simulator v2/v3 need.
- Deterministic seeded RNG ⇒ reproducible self-play and debugging.
- An **inference/belief** helper: given an Observation + game history, enumerate/sample
  hidden-hand assignments consistent with what's been played (needed for determinization).

## Evaluation harness (build early, in `tools/`)
- **✅ DONE (2026-06-23).** Head-to-head runner: `pnpm eval [botA] [botB] [N]`. Core is
  `evaluateHeadToHead` in `packages/bots/src/eval.ts` (mirrored matches to cancel deal luck; win
  rate + 95% Wilson CI; `formatReport` gives a significance verdict). CLI in `tools/eval.ts`.
  Register each new bot in the CLI's REGISTRY. **Ship rule:** a new bot must beat the previous one
  with the CI lower bound > 50% (`heuristic is stronger (95% CI excludes 50%)`).
- **TODO later:** round-robin across >2 bots; a bridge to play our bot against guandan.cards' bot
  in fixed scenarios to measure the gap directly.

## Scoping reality check
v0/v1 are weekend-sized. v2 is a real project. v3 is open-ended research. Ship v1, make the
game fun, and let v2/v3 advance in parallel once the engine is frozen. "Best in the world"
is a direction, not a deadline.
