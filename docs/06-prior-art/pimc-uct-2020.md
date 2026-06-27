# PIMC + UCT (CCDC 2020) — the cautionary baseline

**Paper:** *Imperfect and Cooperative Guandan Game System* — Hengheng Shen, Lei Wu, Yang Li,
Xuejun Li. CCDC 2020 (Chinese Control and Decision Conference), pp. 226–230.
DOI 10.1109/CCDC49329.2020.9164725 · https://ieeexplore.ieee.org/document/9164725/

The **earliest published Guandan AI**, and the only prior work that uses the **same family of
approach we plan for bot v2**: PIMC-style determinization + UCT/MCTS search. So it's the closest
precedent to our intended design — but its main value is as a **cautionary tale**, not a recipe.

> **Confidence — read this.** The full text is **paywalled** (IEEE JS-gated; ResearchGate 403; no
> open PDF found). The agent could read only the **verbatim abstract** (via the Semantic Scholar
> API); everything else is from later citing papers or explicitly marked "not found." **Nothing
> was fabricated** — rollout counts, determinization counts, time-per-move, playout policy, and
> tribute/level/wild-card handling are all genuinely **not found**. Treat method facts (§1) as
> solid (from the abstract); treat the absence of detail as real, not an oversight.

> ⚠️ **Misattribution warning:** web snippets routinely pin DanZero's numbers (30 days / 160 CPUs
> / ~10³⁶ infosets / ~10⁴ legal actions / ~10⁶ action space) onto *this* paper. **Those are
> DanZero's, not Shen et al.'s.** This 2020 paper reports **no numeric results at all.**

---

## 1. Method (verified from the abstract)
Textbook **determinized UCT / PIMC**, quoting the abstract:
- *"sample the multiple possible game states through Monte Carlo Sampling … the UCT algorithm is
  used to search[] the game tree based on every sampled game state … the best action is selected
  based on searching results."*
- **Cooperation handling:** the only stated mechanism is that *"the payoffs of the two players in
  the same team are considered in the simulation phase"* to *"reduce the card ability loss in the
  team."* I.e. team payoff is folded into the rollout evaluation — no explicit partner modeling.

That's the whole method as published: sample hidden states → run UCT on each → pick the best
aggregate action, with team-aware payoffs in simulation.

## 2. What's NOT known (genuinely absent)
All of the detail we'd most want is **not found** in the accessible text:
- How determinizations are sampled (uniform vs. informed by played cards) — **not found**
  (abstract says "Monte Carlo Sampling," implying uniform/naive).
- Number of determinizations, rollouts, or tree budget — **not found.**
- Playout/rollout policy (random vs. heuristic) — **not found** (likely random).
- How the ~10⁶ action space, depth-~400 episodes, the wild card, levels, and tribute are handled
  or simplified — **not found.**
- Time-per-move / performance / feasibility numbers — **not found.**

## 3. Evaluation & strength (verified)
- The abstract claims only that the system plays **"better than random strategy."** That is the
  entire reported result — no opponents, metrics, or numbers.
- **Independently corroborated by both later papers** (verified on ar5iv):
  - DanZero: this system *"performs only slightly better than random agents."*
  - DanZero+: *"only marginally better than random agents."*
- **Near-orphan:** ~3 citations total; modern Guandan work (OpenGuanDan, GuanZero) doesn't even
  cite it and starts from DanZero instead.

## 4. The lesson for our bot v2 (the actual payoff)
This is the most useful thing the paper gives us: **naive determinized UCT — uniform hidden-hand
sampling + (presumably) random playouts — lands only marginally above random on Guandan.** That
is a direct warning about the floor of the approach we're considering. Do **not** assume "PIMC +
our fast engine" automatically yields strength.

**Why naive PIMC is weak on Guandan specifically:**
- **Strategy fusion** — running an *independent* tree per determinization lets the agent
  implicitly "choose differently in states it can't actually distinguish," which is especially
  damaging in a **2v2 partnership** game. This is the classic PIMC pathology.
- **Uniform sampling** wastes rollouts on implausible hands (the 10³⁰ infoset swamps you — exactly
  what sank GS2's *random* generator too; see `gs2.md` Table 1).
- **Random playouts** give noisy leaf values over ~400-deep episodes → poor move ranking.

**To go meaningfully beyond this baseline, anticipate needing the trio:**
1. **ISMCTS over information sets** (one tree over infosets, not independent per-determinization
   trees) — fixes strategy fusion; the right default for a partnership imperfect-info game.
2. **Belief-conditioned hidden-hand sampling** instead of uniform — weight determinizations by
   what's consistent with the public record (plays, passes, **tribute-as-deduction** —
   `our-edge.md` §3.3). GS2's **diversity sampler** (`gs2.md` §6) is a concrete, portable way to
   spend a tiny sample budget well.
3. **A learned or heuristic leaf evaluator** instead of full random rollouts — so each simulation
   yields a useful value cheaply. (Our v1 heuristic is a ready first leaf evaluator.)

**The one thing we have that they lacked:** a **fast, pure, deterministic engine.** A big part of
the 2020 weakness was almost certainly too few good rollouts; a fast simulator directly attacks
that. But the engine fixes *throughput*, not the *strategy-fusion / sampling-quality / leaf-value*
problems above — those need the trio. **Net: naive PIMC is the floor to clear, not the goal.**
</content>
