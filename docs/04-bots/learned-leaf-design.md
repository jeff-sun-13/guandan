# Learned Leaf Evaluator — design proposal (bot v2.4 → bridge to v3)

> **Status: PROPOSAL (awaiting human approval).** This reopens the deferred "training" question
> (ADR-0007/0008), so nothing here is built until the human signs off — see **ADR-0010 (Proposed)**.

## 1. Why
The champion `ismcts-rollout` (ISMCTS + belief + heuristic **rollout** leaf) is the strongest bot we
have, but it is **~seconds/move**: its leaf plays a full deal out (~0.6 ms each, post-engine-opt) and
the search calls it ~150×/move. A **learned value net** that predicts the same verdict in
**~microseconds** would:
- **Restore interactive speed** (µs leaf → ms/move → UI-viable again), and
- **Plausibly increase strength** — a net trained on millions of rollouts is a lower-variance, often
  more accurate value than a single noisy rollout.

This is the documented ceiling-breaker (status.md; `06-prior-art/our-edge.md` opening #4). The key
insight that makes it affordable: **we are NOT doing DanZero-style RL from scratch** (160 CPUs ×
30 days). We are *distilling our existing rollout leaf into a net* — cheap supervised regression.

## 2. Approach — two phases; do Phase 1 first, escalate only if it plateaus

### Phase 1 — Distill the rollout leaf into a value net  (CHEAP; the actual proposal)
The ISMCTS leaf scores a **determinized full state** (all four hands known) → a perfect-information
value. So the learning target is `V(fullState, team) = expected deal value` (the +3/+2/+1 mapping).
1. **Generate data** by self-play with our current bots (champion, or just heuristic rollouts for
   cheapness). At sampled positions record `(encoded full state, label)` where the label is the
   actual deal outcome value (a free Monte-Carlo target from finishing the game) and/or the average
   of K rollouts (smoother). Start with the free game-outcome label.
2. **Train a small net** to regress the value — i.e. distill "what a rollout would say" into weights.
3. **Swap it in** as the ISMCTS `leaf` (we already have a pluggable `LeafEvaluator` seam).

**Cost:** data-gen is CPU-bound (millions of positions — a few hours on a many-core cloud box, now
2.6× cheaper after the `legalMoves` optimization). Training a small MLP on a few M examples is
minutes-to-hours on **one modest GPU (or even CPU)**. This is *not* the RL regime.

### Phase 2 — Self-play improvement loop  (DEFER; expensive, separate decision)
Iterate: net guides ISMCTS → stronger self-play → retrain the net on the better outcomes → repeat.
This bootstraps *beyond* the rollout's ceiling (DanZero/GS2 territory) and needs real sustained
compute. **Only if Phase 1 plateaus below the external benchmark.** Its own ADR + go/no-go.

## 3. Net design
- **Output:** one scalar — our-team expected deal value, normalized (e.g. to [0,1] like the search's
  internal value). Optionally a second head (win-probability) later.
- **Input features** (encode the determinized full state — a *bot/training* concern, lives in a new
  `packages/nn`, so the engine stays pure):
  - Per-seat hand as **rank-count vectors** (15 ranks × count, + jokers + wild flags). DanZero's
    54-dim {0,1,2} card encoding is a ready reference (`06-prior-art/danzero.md` §3).
  - To-act seat (relative to our team), trick state (top type/rank, passes), finished order, level,
    per-seat card counts. ≈ a few hundred features.
- **Architecture:** a **small MLP** (e.g. 256→256→1, ReLU) — enough for a value regressor, and tiny
  enough that TS inference is microseconds. Keep it small on purpose.
- **Loss:** MSE on the normalized value to start.

## 4. Inference in TypeScript (keep the whole stack pure-TS)
- **Train in PyTorch (Python, on a GPU); export the weights** (JSON/binary).
- **Reimplement the forward pass in TS** — for a small MLP this is a few typed-array matmuls,
  dependency-free, microseconds per call. **Avoid ONNX Runtime / tf.js** (heavy per-call overhead,
  bad for a µs leaf budget).
- **Parity test:** assert the TS forward pass matches the PyTorch net's outputs on sample inputs.

## 5. Pipeline / deliverables
1. `tools/gen-data.ts` (Node) — self-play, sample positions, write a `(features, value)` dataset.
   Runs on a cloud CPU box.
2. `train/` (Python + PyTorch) — train the value MLP, export `weights.json`. Runs on a GPU (or CPU).
3. `packages/nn/` (TS) — `encode(state, team)`, `forward(weights, x)`, a `learnedLeaf: LeafEvaluator`
   + the parity test. Engine untouched (purity preserved).
4. Register `ismcts-learned` (ISMCTS + belief + learned leaf); evaluate on `pnpm ladder`.

## 6. Gates — don't ship unless
- **Parity test passes** (TS inference == PyTorch).
- `ismcts-learned` **matches/beats `ismcts-rollout`** on the ladder at **far lower cost** (the whole
  point: equal strength, µs leaf). If it's weaker, it's a *speed/strength tradeoff* — keep
  `ismcts-rollout` as the strength champion and `ismcts-learned` as the fast/UI champion.
- **Validate against the external benchmark (task #3)** when available — a learned net is exactly the
  kind of thing that overfits to our own self-play distribution (the recurring guandan.cards trap).

## 7. Risks
- **Distillation loss** → weaker than the rollout. Mitigation: ladder gate; ship as a tradeoff bot if
  weaker, not as a regression.
- **Overfit to our self-play distribution** → external validation (#3); diversify self-play data.
- **TS/PyTorch inference drift** → parity test.
- **Scope creep into full RL** → Phase 2 is explicitly deferred with its own ADR + go/no-go.

## 8. Compute (see ADR-0009 + the 2026-06-26 compute research)
- Phase 1 **data-gen**: cloud CPU burst (cheaper post-engine-opt). Phase 1 **training**: one modest
  GPU, short/cheap (or CPU for a model this small). Phase 2 (if ever): real RL compute — separate.
- Concrete provider/cost options are being gathered (CPU + GPU research agents, 2026-06-26); the
  findings land in this section.
