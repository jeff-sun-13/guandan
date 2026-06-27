# Bot v2 — Decision-time search (design)

The plan for our first bot that actually *thinks ahead*. Decided in **ADR-0007**; grounded in the
prior-art study (`docs/06-prior-art/`, especially `our-edge.md`, `gs2.md`, `pimc-uct-2020.md`).

> **Thesis (from the research):** every existing Guandan bot is *reactive* — no real
> decision-time search — and the academic ones are *opponent-blind*. Search over sampled hidden
> hands attacks both gaps and needs only a fast simulator, which the engine already is. We win on
> **method, not compute** — no neural-net training pipeline (deferred; ADR-0007).

## 0. Contract & scope (unchanged)
v2 is a drop-in `Bot = (obs, legal, rng) => Move` (`docs/04-bots/roadmap.md`). It sees only the
`Observation` + legal moves + a seeded RNG — never the hidden `GameState`. Everything below lives
in `packages/bots`, built on the pure engine. Determinism via the injected RNG is preserved.

## 1. Why naive PIMC is the *floor*, not the goal
The 2020 PIMC+UCT Guandan system (`pimc-uct-2020.md`) was only *"marginally better than random."*
So bare "uniform-sample hidden hands + random rollouts + independent tree per sample" is a known
dead end. The three documented reasons, and our countermeasures:
- **Strategy fusion** (independent per-determinization trees let the agent "decide differently" in
  states it can't distinguish — acute in 2v2) → use **ISMCTS over information sets** (one shared
  tree keyed by infoset), not independent PIMC trees.
- **Uniform sampling wastes rollouts on implausible hands** → **belief-conditioned sampling**
  (weight/diversify hands by consistency with the public record; GS2's diversity sampler).
- **Random rollouts give noisy leaf values over ~143-move deals** → use a **heuristic
  rollout/leaf evaluator** (our v1 heuristic is the first one).

## 2. Engine prerequisites (small, pure additions — ADR-0007)
The current `Observation` (see `state.ts`) gives only `hand` + per-seat `handCounts` + the trick.
That is **not enough to sample hidden hands**: you need the pool of still-live cards. Two additions
to `packages/engine`:

1. **`Observation.outOfPlay: Card[]`** — the multiset of cards no longer in *any* hand (already
   played/discarded, incl. the current trick on the table). Public info; computed in `observe()` as
   `fullDeck − union(all hands)`. Derived, not stored → keeps the engine pure (ADR-0002).
2. **`determinize(obs, rng): GameState`** (new `determinize.ts`) — returns a full `GameState`
   consistent with `obs`: your real hand, the other seats' hands drawn from the pool
   `pool = fullDeck − obs.hand − obs.outOfPlay` partitioned by `handCounts`, and `trick/toAct/
   finished/level/phase` copied over. Uniform sampling first; belief-weighting later. The candidate
   pool size must equal `Σ handCounts[p≠me]` (asserted).

With these, a bot can: `determinize(obs, rng)` → a real `GameState` → drive `legalMoves`/`applyMove`
for search/rollouts.

## 3. Performance budget (measured — `pnpm bench`, 2026-06-25, Node single-thread)
| Metric | Value |
|---|---|
| Full random playout (createDeal → terminal) | **~1.58 ms/deal**, ~143 moves/deal → **635 deals/s** |
| `legalMoves`, fresh 27-card hand (worst case) | **21.5 µs/call** ← the hot path (shrinks as hands deplete) |
| `applyMove` (incl. clone) | 0.68 µs · `cloneState` 0.09 µs |
| Rollouts per move budget | ~32 (50ms) · ~63 (100ms) · **~127 (200ms)** · ~316 (500ms) |

**Implications for the design:**
- A full random rollout costs ~1.58ms ⇒ "every candidate move × K determinizations × full rollout"
  blows a snappy budget fast (e.g. 20 candidates × 16 dets × 1 rollout ≈ 0.5 s). So: **cap
  candidate moves** (top-k by the v1 heuristic), **keep K modest** (≈10–20), and prefer a **cheap
  leaf** (heuristic static eval, or shallow/heuristic rollout) over full random rollouts.
- `legalMoves` worst case (21.5µs) dominates rollout cost; **encoding optimization (rank-count /
  bitsets) is the lever** if/when search gets hungry (`gotchas.md`, `03-engine` open questions).
  Not blocking v2 — note and move on.
- These are Node numbers; expect the same order in-browser (V8). A Web Worker (ADR-0005 revisit)
  becomes worthwhile once a move takes >~100ms.

## 4. Build order (each step gated by `pnpm eval`, CI lower bound > 50% to ship)
1. ✅ **DONE** — **Engine prereqs**: `Observation.outOfPlay` + `determinize()` + 10 tests.
2. ✅ **DONE** — **`pimcBot` v2.0 (heuristic-rollout leaf).** For each candidate move, across K
   determinizations, apply it then evaluate the world; average; pick the best. Single-player search
   with greedy-heuristic teammates (GS2 trick). **Result: beats v1 66.7%, n=120, CI [57.8%, 74.5%].**
   A real but modest edge — past the 2020 "barely better than random" floor, as expected for baseline.
2b. ✅ **DONE — static leaf (was §5, promoted).** `staticDealValue` scores a world with no rollout
   (~1µs vs ~1ms). `pimcStaticBot` (K=100). **Result: beats v1 72.5%, n=120, CI [63.9%, 79.7%]** and
   ~5× faster (~2ms/move) → **UI-viable.** Head-to-head vs the rollout leaf it's **≈ equal** (52.5%,
   n=40, inconclusive): the rollout is more informative per-sample, but the static leaf is cheap
   enough to crank K to parity far faster. Net: the best *practical* bot (equal strength, far faster).
3. ✅ **DONE — and the NEW CHAMPION once paired with belief + a good leaf (2026-06-26).** Built
   SO-ISMCTS (`ismcts.ts`): one infoset tree (UCB over available moves, determinization resampled per
   iteration, 2-team zero-sum, pluggable leaf/sampler). **Trajectory:** with the static leaf + uniform
   sampling it was only ~heuristic-level (~44% vs v1) — opponent-minimisation over a crude leaf +
   belief-free worlds is noisier than PIMC's depth-1 averaging. Adding **belief sampling** (step 4)
   helped modestly (~56% vs plain ISMCTS). Adding the **heuristic rollout leaf** (step 5) was the
   unlock: **`ismcts-rollout` (ISMCTS + belief + rollout) beats `pimcStaticBot` ~82%** (59–13/72, CI
   [71.5,89.1]). Exactly the prior-art thesis: the win is **ISMCTS + belief + good leaf TOGETHER** —
   each necessary, none sufficient alone. Cost: seconds/move (rollout leaf), too slow for UI.
4. ◑ **PARTIALLY DONE (2026-06-26) — within-trick belief sampling.** `makeBeliefSampler`
   (`belief.ts`) importance-samples worlds, downweighting ones where a cross-team passer in the
   current trick could have cheaply followed but didn't. Pure (Observation only, no history).
   **Result:** helps ISMCTS (`ismcts-belief` vs `ismcts-fast` ≈ 56%, n=80, positive/not-yet-sig) but
   NOT the static-leaf PIMC champion (45.8%, tied) — a shape-only leaf can't exploit card-identity
   info. So belief's payoff is gated on a leaf that simulates opponent interaction (step 5 / leaf
   quality). **Still TODO (needs history threading — own ADR):** cross-trick passing + GS2 diversity
   DP + **tribute-as-deduction** (`our-edge.md` §3.3, the exact-info signal).
5. **(Later) learned leaf evaluator** — only if search plateaus; reopens the training question
   (new ADR).

## 5. Leaf evaluation options (pick per perf)
- **Heuristic rollout:** play all seats with `heuristicBot` to deal end, score by finish (+3/+2/+1
  mapping, `match.ts` `scoreDeal`). Most faithful; ~1.5ms each.
- **Static hand-strength eval:** ✅ **implemented** (`static-eval.ts` `staticDealValue` — plays-to-
  empty + bomb control + finish progress). The current best leaf: cheaper *and* stronger than the
  rollout, and the practical default for a browser budget (cf. the guandan.cards "all-cost value
  model", `guandan-cards-bot.md`). Crude (ignores straights/tempo) — clear room to refine.
- **Shallow rollout + static eval at a depth cap** (the GS2 pattern): roll a few plies, then static.

## 6. Open questions / risks
- **Reward signal for a single deal vs the match:** v2 optimizes the current deal's finish; level/
  match context (e.g. playing at A) may warrant weighting — revisit once basic v2 works.
- **Tribute decisions** are still auto (default return policy). v2 doesn't address them yet;
  flagged as a later seam (`our-edge.md`).
- **Determinization legality:** sampled opponent hands are *card-consistent* but ignore behavioral
  info (a player who passed probably can't beat X). Step 4 addresses this; step 2 ignores it.
- **Perf in-browser / worker:** measure a real move's wall-time once `pimcBot` exists; move to a
  Web Worker if it janks the UI (ADR-0005).
</content>
