# GS2 — Generative Subgame Solving (NeurIPS 2023)

**Paper:** *Efficient Subgame Refinement for Extensive-form Games*, NeurIPS 2023.
**Authors:** Zhenxing Ge, Zheng Xu, Tianyu Ding (Microsoft), Wenbin Li, Yang Gao (Nanjing
University — the Yang Gao cluster; see `landscape.md`).
**Access:** the research agent read the **full paper + supplement** (decompressed the NeurIPS PDF
streams locally). No arXiv version exists — NeurIPS proceedings only.
- Main: https://openreview.net/pdf?id=8HzOyg1ngp
- Supplement (Guandan rules, impl details, pseudocode, Table 1): the NeurIPS supplemental PDF.

> **Why this matters to us:** GS2 is the most serious **game-theoretic / search** Guandan work,
> and our intended bot v2 is decision-time search. But read the assessment (§9) first: GS2 is a
> *refinement layer on top of a DanZero-class value net*, not a self-contained bot. The single
> most valuable thing to steal is its **diversity-based hand sampler** — a drop-in upgrade to
> vanilla PIMC determinization. The rest (CFR gadget solving) is heavy and not portable.

> Confidence: §§1–8 are verified from the paper text. **Figure 3's exact Guandan numbers are
> plotted images** (not recoverable as text) — quoted only qualitatively. The head-to-head
> win-rates vs DanZero/SDMC/humans come from the *third-party* OpenGuanDan benchmark (2026), not
> from GS2 itself — flagged inline.

---

## 1. What GS2 is (and isn't)
**GS2 = Generative Subgame Solving.** It is a **subgame-solving / strategy-refinement** method in
the **CFR / DeepStack / Brown–Sandholm family** — NOT a from-scratch RL learner. It takes a fixed
**blueprint** strategy and, at decision time, refines it by solving a small subgame rooted at the
current information set. For Guandan, **the blueprint is a DMC value function `Q(I,a)`** — i.e.
the DanZero/DouZero network (`danzero.md`). GS2 adds *search on top of* DanZero's instincts.

So in our vocabulary: GS2 is exactly the "react + think" combo that the pure DanZero line lacks.
It is "DanZero + decision-time search," and its measured gain over DanZero *is* the search layer.

## 2. The precise problem it fixes
Prior **safe** subgame-solving methods (Endgame/Resolving, Maxmargin, ReBeL-style, and the
strongest, **KLSS / 1-KLSS** = Knowledge-Limited Subgame Solving, Zhang & Sandholm 2021) shrink
the *acting* player's own infosets but leave the subgame containing **all the other players'
infoset states.** In Guandan that's fatal:
- An infoset can be as large as **10³⁰**; there can be up to **10²⁰ opponent infosets inside a
  single one of your infosets.** Game-tree depth ~**400**; action space ~**10⁶**.
- Poker abstraction doesn't apply (heads-up hold'em infosets ≤ 1326). The standard CFR regret
  bound `O(√|Iᵢ|·T)` "is not guaranteed to converge in real-time."

**GS2's novelty:** a **generation function `f`** that *samples a subset of the other players'
infoset states* and builds the subgame over only that subset — reducing `|I₋ᵢ|`, which no prior
method did. It then runs a safe solver (Maxmargin LP, else MCCFR) on the small generated gadget,
and gives the **first exploitability analysis for arbitrary generation functions.**

## 3. Method
- **Generation function** `f : I₁ → Δ|Q|` samples a "block" `Q_r` of opponent histories (closed
  under the opponent's infoset). Build subgame `S` over `Q_r` + descendants; solve safely.
- **Proposition 4.1 (exploitability bound, 2p zero-sum):**
  `exp(σ′₁) ≤ exp(σ₁) + max_h (1−ω(h))·σ⁰₋₂(I₂(h))·δ(σ₁,h)`
  where `ω(h)` = prob. history `h` is considered and `δ` = how exploitable the blueprint already
  is there. **Reading: refinement is safest when (a) you cover more histories (higher ω) and (b)
  the blueprint is already weak there (small δ).** ⇒ GS2 wants a *coarse* blueprint — the opposite
  of unsafe/endgame solving, which needs a near-Nash blueprint.
- **Random generation (baseline):** sample k opponent states; expected-exploitability bound
  shrinks ∝ **1/k** ⇒ "generate as many as time permits."
- **Diversity-based generation (the proposed one, Eq. 3 + Algorithm 2):** choose the k-subset
  whose member infosets are **maximally spread in *value* space** (minimize max earth-mover
  distance to excluded infosets). In 2p zero-sum this = pick states whose alternative values are
  ~uniform over [min,max], solved by a simple **DP** (sort sampled histories by value, partition
  into k diverse buckets). **Intuition: cover the widest range of opponent situations with the
  fewest samples.** This is the difference-maker vs random sampling.
- **Solver:** Maxmargin via **linear programming** when feasible, else **MCCFR**. Blueprint for
  the toy games is plain **CFR**. *(Not Deep CFR, not CFR+.)*

## 4. Imperfect-information handling
- **No explicit belief distribution.** It *samples* opponent states (the generation function),
  and notably "does not assume the counterfactual probability of the history" — it works from a
  coarse blueprint without accurate beliefs.
- **Depth-limited** subgame; everything outside first-order knowledge is **frozen to the blueprint
  and treated as chance** (the 1-KLSS trick).
- **Leaf evaluation:** a single `Q(I,a)` value function; leaf payoff via **Monte-Carlo roll-outs
  where every player greedily plays `argmax_a Q(I,a)`** (the opponent's exact counterfactual value
  is replaced by `max_a Q(I,a)` since the sampled infoset is incomplete).

## 5. Neural components
**None new.** The only learned artifact is the **DMC `Q(I,a)`** blueprint (DanZero/DouZero-style),
treated as a black box — no architecture given. The generation function is the analytic diversity
DP, *not* a learned sampler. *(A follow-up paper and OpenGuanDan describe a "learned" generator;
in this paper the deployed one is the DP.)*

## 6. Guandan-specific engineering (the practically useful part — Appendix C)
- **Sampling (C.2):** on reaching infoset `I`, sample **m = 1000** candidate histories, then DP-
  select a **diverse k-subset.** Only **first-order** knowledge infosets are built (second-order is
  2^k — too slow). Acknowledged approximation.
- **Depth & branch limits (C.3):** default **depth limit = 10** (8 if opponents jointly hold > 27
  cards); keep only the **top-2 actions per action type** by Q at each node; leaf values via
  greedy-Q rollouts. *(Concrete knobs we can reuse directly.)*
- **Single-player search (C.4):** **only ONE player runs GS2; the teammate just plays greedy
  `argmax Q`.** Teammate nodes collapse to chance nodes from the blueprint. This dodges the 2v2
  team-coordination (TMECor) blow-up, which is "infeasible for large games."
- **Partnership (C.5):** **Resolving** gadget when two opponents still play, **Maxmargin** when
  only one remains (opponents share payoff but have different counterfactual values).
- **Conservative assumption (C.1):** they sample as if "**opponents know the player's exact private
  information**," yielding a worst-case refinement that "prevents a drastic rise in exploitability."
  Justified because Guandan uncertainty shrinks toward the endgame.
- **Invalid-particle repair (C.6):** as observations arrive, drop invalidated sampled histories and
  incrementally add the most-different new one — avoids full subtree rebuilds (keeps latency down).

## 7. Compute
- **No GS2 training** — pure decision-time search. The only trained artifact is the external DMC
  blueprint (no compute reported here; DanZero's was ~30 CPU-weeks — `danzero.md`).
- **Decision budget:** a few seconds/move (3 / 4 / 5 s in experiments). On a Xeon Gold 6242R, a
  Liar's-Dice-7 subgame: 122 s (unsafe) / 41 s (1-KLSS) vs **10 s for GS2 k=3** — much cheaper, but
  still *seconds*, on a server CPU.

## 8. Evaluation
- **Toy games (exploitability, OpenSpiel):** Leduc, Liar's Dice, Goofspiel. GS2-D ≈ 1-KLSS-unlimited
  at far less cost; exploitability drops as k grows; **on the larger games GS2-D beats
  1-KLSS-limited while random sampling (GS2-R) degrades.** GS2's edge is specifically the
  *real-time / large-scale* regime (given unlimited time, plain solvers can match it).
- **Guandan (Fig. 3, qualitative):** GS2 on a DMC blueprint vs the two Guandan-competition
  champions (1st = rule-based; 2nd = a DMC agent with warm-start + post-processing, ~90% vs the
  1st). GS2 gives a **significant average-score gain over the blueprint vs the DMC champion**, gain
  **growing with k**; smaller gain vs the rule-based champion (blueprint already dominates it).
- **Table 1 — the one exact Guandan number (GS2-R ablation, k=10), avg score per seat:**

  | Agent | pos-1 | pos-2 | pos-3 | pos-4 |
  |---|---|---|---|---|
  | Blueprint | 0.000 | 0.156 | 0.809 | 0.128 |
  | GS2-R (k=10) | −0.014 | 0.182 | 0.770 | 0.121 |

  **Random generation fails to beat the blueprint in Guandan** (10³⁰ infoset swamps it) — which is
  the whole reason the **diversity** generator exists. The headline GS2-**D** gains are the Fig. 3
  plots we can't quote numerically.
- **Third-party (OpenGuanDan benchmark 2026 — not from this paper):** GS2 vs SDMC **56.7%**, vs
  DanZero **62%**, vs humans **42.5%** overall (>50% only vs beginners). ⇒ GS2 is **somewhat
  stronger than DanZero head-to-head, still below strong humans.**

## 9. Assessment — what we take, what we leave
**The full GS2 system does NOT fit our project, for three concrete reasons:**
1. **It's not self-contained** — it refines a pre-trained **DMC blueprint** (a DanZero-class net,
   ~30 GPU-days). No blueprint, nothing to refine. Our starting point (pure engine + from-scratch
   search) is different.
2. **The CFR core is heavy** — LP/MCCFR gadget solving, Maxmargin/Resolving construction,
   exploitability machinery, all under a few-second budget on a 10³⁰ infoset. Far beyond a browser
   client; the authors run it on a Xeon, for one player only.
3. **It optimizes exploitability (Nash safety),** which matters against adversaries hunting your
   leaks. For single-player-vs-bots, raw expected score matters more — and PIMC/ISMCTS target that
   more cheaply.

**What IS portable — and genuinely valuable for our PIMC/ISMCTS bot:**
- ⭐ **The diversity-based hand sampler (Eq. 3 + DP).** The top takeaway. Instead of k *random*
  determinizations, **sample many candidate opponent hands, score each by your leaf value, then
  DP-select a k-subset whose values span the range uniformly.** Broad coverage with tiny k — ideal
  for client-side compute. A near-drop-in upgrade to the determinization step our v2 needs.
- **Greedy-value Monte-Carlo rollouts** as the leaf evaluator (standard PIMC/ISMCTS; confirms design).
- **Guandan-tuned depth/branch limits:** depth ~10 (8 when opponents hold many cards), **top-2
  actions per action type.** Concrete knobs to keep search tractable against the 10⁶ action space.
- **Single-player search + greedy teammate** (C.4): a pragmatic way to dodge 2v2 coordination
  blow-up — search our own decision, model the partner with a fast greedy policy.
- **"Assume opponents know your hand"** (C.1): a cheap worst-case robustifying mode.
- **Invalid-particle repair** (C.6): incrementally fix the sampled-hand set across tricks instead
  of resampling — keeps per-move latency low.

**NOT portable:** LP/MCCFR gadget solving, Maxmargin/Resolving, exploitability proofs, and the
dependence on a pre-trained DMC blueprint.

**Strength placement:** GS2 ≈ "DanZero + seconds of search," beating DanZero ~62% head-to-head but
still <50% vs strong humans. For us the realistic near-term ceiling is *value-guided ISMCTS/PIMC*,
whose flavor is GS2's search layer — minus the CFR machinery. **Borrow the diversity sampler; skip
the subgame solver.** See `our-edge.md`.
</content>
