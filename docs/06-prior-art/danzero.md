# DanZero (arXiv 2210.17087)

**Paper:** *DanZero: Mastering GuanDan Game with Reinforcement Learning*
**Authors:** Yudong Lu, Jian Zhao, Youpeng Zhao, Wengang Zhou, Houqiang Li (USTC).
**Venue:** IEEE Conference on Games (CoG) 2023. Submitted Oct 2022.
**One line:** The first published Guandan AI. Trained by self-play with **Deep Monte-Carlo
(DMC)** on 160 CPUs + 1 GPU for **30 days**; reaches roughly upper-amateur human level.

> This is the foundational reference for our bot work. Its **state/action encoding** is the
> single most reusable artifact here — DanZero+ (`danzero-plus.md`) inherits it wholesale, and
> the public code (`reference-implementation.md`) is built on it. Read this doc first.

> Sourcing: extracted from the ar5iv HTML render (the PDF is image-based). Two independent
> passes agreed. Exact per-baseline win rates and hidden-layer counts are **approximate** —
> flagged inline. The implementation reports different feature dims than the paper (see
> `reference-implementation.md` §4); trust the code where they conflict.

---

## 1. Problem framing — why Guandan is hard
They model the **full 4-player, 2-deck (108-card) game**: partners sit opposite (2v2), each
player dealt 27 cards, multi-deal matches with the level-up mechanic (climb 2 → A; win past A),
the level card / Heart-suit wild card, and tribute/return between deals.

Stated difficulties (these are the numbers that justify the whole approach):
- **Imperfect information** comparable in scale to **4-player Mahjong** — far larger than
  DouDizhu or 2-player games.
- **Enormous action space:** raw ≈ **10⁶**; *legal* actions at a single decision ≈ up to **10⁴**.
- **Long episodes:** an agent makes **>100 decisions per episode** (vs ~10 in DouDizhu).
- **2v2 cooperation** with a hidden partner hand.
- **Variable active-player count** as players finish and are skipped.
- **Level + tribute** mechanics couple deals together.

This catalogue is worth internalizing: it's *why* simple methods fail and why our engine must be
fast enough to simulate millions of these long episodes (`03-engine/design.md`).

---

## 2. Algorithm — Deep Monte-Carlo (DMC)
DMC = Monte-Carlo value estimation with a neural-net function approximator (same family as
**DouZero** for DouDizhu). It learns **Q(state, action)** by regressing toward the **observed
episodic return** (the final reward of the deal). Not PPO, not DQN/TD, not policy-gradient.

- **Target:** the realized Monte-Carlo return `r` (no bootstrapping → unbiased, but
  high-variance). Effectively undiscounted (γ=1) over the fixed-ish horizon.
- **Loss (Eq. 3):** `Loss = (1/N) Σ [ Q(τ,a) − r ]²` — plain MSE of Q onto the return.
- **Behavior policy:** ε-greedy — random legal action w.p. ε, else `argmax_a Q(τ,a)`.
- **Off-policy / staleness correction (Eq. 1):** because actors run slightly stale weights vs
  the learner, they clip a ratio:
  `Q_corrected = clip( Q(τ,a;θ_learner)/Q(τ,a;θ_actor), 1−λ, 1+λ ) · Q(τ,a;θ_actor)`
  (spiritually similar to V-trace/IMPALA clipping).

**Why DMC (their rationale):** TD methods (DQN) *overestimate* here; policy-gradient (A3C)
*fails on very large action spaces*; MC+NN can consume **action features directly** and is
unbiased. The "action as a feature you score" trick (§4) is what makes the huge action space
tractable.

**Reward** (assigned by the winning team's *partner finish position*):
- partner finishes 2nd → **+3**; 3rd → **+2**; 4th/last → **+1** (losers get the mirror −value).
- **At level A:** reward is 0 unless the partner finishes 2nd or 3rd — encodes the "you can't
  win the match from a weak finish at A" rule.

---

## 3. State encoding (the load-bearing part) — 513-dim vector
Built from one card-set primitive: every card collection is a **54-dim vector**, one slot per
distinct card (single-deck layout: 52 ranks-suits + 2 jokers), each element ∈ **{0, 1, 2}** =
how many copies are held (2 because two decks). Two decks are handled by the *value range*, not
by 108 slots.

The full **513-dim** state (per the paper):

| Dims | Size | Feature |
|---|---|---|
| 0–53 | 54 | Current hand |
| 54–107 | 54 | Remaining unseen cards (all − own hand − played) |
| 108–161 | 54 | Last move to beat (zeros if leading) |
| 162–215 | 54 | Partner's last move (zeros if pass; −1 if partner finished) |
| 216–299 | 84 | Remaining card counts of the 3 other players (3 × 28) |
| 300–461 | 162 | Played cards of the 3 other players (3 × 54) |
| 462–501 | 40 | Level info for both teams |
| 501–513 | ~13 | Flags: wild-card availability + which special formations are makeable |

> **Caveat:** the public code assembles **539** (and the PPO config says **516**), not 513 —
> the implementation drifted from the paper. See `reference-implementation.md` §4 for the exact
> code-level block list. Use the code's layout if you actually reimplement this.

Note what's **absent**: there is **no recurrent memory of the full action sequence** (no LSTM).
History is compressed into the "played cards" summaries. Tempo/ordering info is partly lost.

---

## 4. Action encoding — "score each legal action as a feature"
This is the key architectural idea and the thing most worth copying.

- The net does **NOT** have a fixed-size policy head over all actions. Instead **each legal
  action is encoded as its own 54-dim card-set vector** (same primitive as state).
- At each decision: enumerate the legal action set (up to ~10⁴ moves), and for **each** candidate
  form the input `[state(513) ‖ action(54)] = 567-dim`, run the net → a **scalar Q** for that
  one (state, action) pair.
- Choose `argmax` over scored legal actions (ε-greedy at train time).

Result: the output is **size-1** and **invariant to action-space size** — the same net scores
Singles, Pairs, Triples, Full Houses, Tubes, Plates, Straights, Bombs, Straight-Flushes, Joker
Bombs, and Pass, with no fixed head. This is how they tame 10⁶ actions.

---

## 5. Network architecture
- **Input:** 567-dim (state 513 ‖ action 54), one forward pass per legal action.
- **Body:** a plain **MLP** ("several layers"). **No LSTM, no ResNet, no attention.** (The
  public code uses **5 × Dense(512), tanh** → Dense(1). See `reference-implementation.md` §6.)
- **Output:** a single scalar Q(τ, a).

Deliberately simple value-regression net, evaluated once per legal action.

---

## 6. Training setup
- **Distributed self-play**, actor–learner pattern.
- **Actors:** **80** processes generating ε-greedy self-play; each episode yields **4
  trajectories** (one per seat). Tuples `(τ, a, Q, r)` go to a replay buffer; actors
  periodically pull fresh weights.
- **Learner:** samples batches, minimizes the MSE loss (+ Eq. 1 clip), pushes weights back.
- **Compute:** **160 CPUs + 1 GPU** (Xeon Gold 6252 CPUs; a single consumer **RTX 3070**),
  **~30 days**. Bottleneck is CPU-side simulation — classic DMC. *This is the cost line item to
  remember: a strong DMC bot is cheap in code but expensive in CPU-weeks.*
- **Tribute phase** is handled by **heuristic rules** and its data is **not** stored for RL.
- Exact lr / buffer / batch were in an appendix not rendered; see the code for real values
  (lr 1e-3 RMSProp, buffer 65536, batch 32768 — `reference-implementation.md` §7).

---

## 7. Evaluation
- **Metric:** head-to-head win rate (no Elo/ADP). One team = DanZero, other = a baseline;
  **1000 games per matchup.**
- **Opponents:** the **top-8 rule-based bots** from the 1st Chinese "AI for Guandan" Competition
  (baseline1 = strongest … baseline8 = weakest).
- **Results:** beats all 8. ~**100%** vs the weakest; vs strong baselines ≈ **90% (b1)**,
  **83% (b2)**, **87% (b4)** *(approximate — from figure extraction)*. They argue >80% in such a
  high-variance game is decisive.
- **Ablation:** removing the wild-card / special-formation flags collapses it to ~**53%**
  (near coin-flip) — the net leans heavily on those engineered hints (a fragility signal).
- **Human eval:** >100 games vs 10 human players → ~**60%** win rate → "human-level / above
  average amateur." Modest sample; not expert-validated.

---

## 8. Stated limitations / future work
- **Tribute is heuristic, not learned** — explicitly want RL on it.
- **Training is slow** (30 days) — want to accelerate (→ DanZero+ does this for the PPO stage).
- First system; the 60% human bar is modest, not a superhuman claim.

---

## 9. Critical assessment — where DanZero is beatable
(See `our-edge.md` for the cross-bot synthesis; the points specific to DanZero:)

1. **No search, no lookahead.** Purely reactive Q-scoring. The strongest imperfect-info agents
   search at decision time. This is the headline gap.
2. **No belief / opponent modeling.** It sees opponents' *played* cards and counts but never
   reasons about the hidden-hand distribution. Off-distribution / adversarial styles pull it out
   of its self-play manifold (hence only ~60% vs humans).
3. **DMC Q-targets are high-variance.** One terminal reward across 100+ decisions = noisy credit
   assignment; the learned value is the value *against itself*, not against arbitrary opponents.
4. **Deterministic argmax policy = exploitable.** ε-greedy is train-time only; at deployment it's
   predictable. Imperfect-info games reward *mixed* strategies.
5. **Implicit, weak partner coordination.** Cooperation only emerges from shared self-play; no
   explicit conventions/signaling.
6. **Heuristic tribute** = a known, un-optimized seam.
7. **Fragile features.** The ~53% ablation shows it depends on hand-engineered flags rather than
   learning combinatorial structure robustly.
8. **Soft evaluation.** 2022 rule bots + 10 humans + 60%, no Elo/exploitability bound.

**Bottom line:** DanZero is a strong, cheap, reproducible **baseline and encoding reference** —
but its reactive, opponent-blind, search-free design is the ceiling we want to break through.
The most reusable thing for us is the **encoding scheme** (§3–4) and the **DMC learning rule**
(§2); the most beatable thing is the **absence of search and belief**.
</content>
