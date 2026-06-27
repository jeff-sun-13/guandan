# Our Edge — why the existing bots fall short, and how we beat them

The opinionated synthesis the human asked for. Read the per-bot docs first
(`danzero.md`, `danzero-plus.md`, `reference-implementation.md`, `guandan-cards-bot.md`).

> **Scope note (decision deferred).** As of 2026-06-23 the human chose *"document now, decide
> our own bot path later."* So this doc is **analysis + a menu of openings**, not a locked plan.
> When we commit to an approach it becomes an ADR (`02-architecture/decisions.md`) and a
> milestone in `04-bots/roadmap.md`. Don't read the "what we'd build" section as settled.

---

## 1. What all three have in common (the shared blind spots)
Lay the three side by side and the same gaps appear in all of them:

1. **No real decision-time search.** DanZero and DanZero+ are *purely reactive* — a value net
   scores legal actions and picks the argmax; there is **no lookahead at all.** The friend's bot
   has a search layer but **admits it is "noise-dominated" scaffolding.** Nobody here actually
   searches well. In imperfect-information games, search at decision time (PIMC, ISMCTS, ReBeL-
   style) is the single biggest lever on strength. **This is the headline opening.**
2. **Little or no belief modeling.** Both papers are **completely opponent-blind** — they never
   infer the hidden-hand distribution; they just see played cards as features. The friend's bot is
   the exception (it has a belief matrix) — which is a hint that belief modeling matters and that
   the academic bots leave it on the table.
3. **Nobody learns the tribute phase.** All three hand-code tribute/return and (in the papers)
   *discard those samples from training.* Tribute materially shapes a deal and leaks exact
   information. It's an un-optimized seam in every existing bot.
4. **Deterministic, exploitable policies.** The papers deploy argmax (ε-greedy is train-time
   only); the friend's bot is a deterministic rules engine. Imperfect-info games reward **mixed
   strategies**; deterministic play is predictable and farmable. (This is also *why* the friend
   can plausibly hit 100–0 vs a frozen DanZero checkpoint — a static deterministic opponent is the
   easiest thing in the world to exploit.)
5. **Soft, narrow evaluation.** The papers validate against 2022-era rule bots + ~10 amateur
   humans (≤71% win). The friend validates only against the *public* DanZero checkpoints (which
   may be weak — `reference-implementation.md` §9) and reports no human/cross-tier numbers. **No
   one has an Elo ladder, an exploitability bound, or a strong-human benchmark.** "Strongest
   anywhere" is, frankly, a low bar to *claim* right now and an open one to actually *take*.

## 2. Why each specific bot is beatable
- **DanZero** — strong cheap baseline, but reactive + opponent-blind + high-variance MC targets +
  fragile hand-engineered features (drops to ~53% without the wild-card flags). Only ~60% vs
  amateur humans. The encoding is its gift to us; the lack of search/belief is its ceiling.
- **DanZero+** — the "+" is marginal: **55/45 over DanZero**, and the gain *collapses* away from
  the magic `k=2`. Same reactive core, same blind spots, plus a new one: **the policy can never
  exceed DMC's top-k ranking.** Title ("Dominating") oversells the result.
- **guandan.cards "Strategist"** — coherent design and one genuinely good idea (tribute-as-
  deduction), but **hand-tuned coefficients**, an **admittedly noise-dominated search**, an
  **experimental-only learned value head**, and a **100–0 claim that is self-reported,
  unreproducible, and most likely overfit to a weak public checkpoint.** Matches the human's
  lived experience that the site's bots aren't actually that good.

## 3. The openings we can exploit (ranked by leverage)
1. **Decision-time search over sampled hidden hands — PIMC / ISMCTS.** This is the big one and it
   is *exactly* what our engine is built for. Sample opponent/partner hands consistent with the
   public record (a "determinization"), simulate forward with cheap `applyMove`/`legalMoves`,
   aggregate over many samples to pick a move. This is already our planned **bot v2**
   (`04-bots/roadmap.md`). None of the three published/known bots does this well — it's our most
   direct path past all of them.
2. **Explicit belief tracking over hidden hands.** Maintain a distribution over what each opponent
   holds, updated from every play, pass, *and the tribute exchange.* Feeds both better
   determinization sampling (weight samples by likelihood) and better heuristics. The friend
   proves it helps; the papers prove you can win without it — so doing it *well* is an edge.
3. **Tribute-as-deduction (steal this immediately — it's free).** The tribute card is, by rule,
   the payer's highest non-wild single → it **pins a known card to the receiver and caps the
   payer's rank.** That is exact, certain information about hidden hands. Both papers throw it
   away; we already model tribute fully in the engine (`tribute.ts`), so we can wire this
   deduction into belief/heuristics cheaply. **Low effort, real signal.**
4. **A learned value/leaf evaluator** to guide search (the thing the friend says he *wants* and
   doesn't have). Even a modest net that scores a position lets MCTS search far deeper per
   millisecond. The DanZero encoding (`danzero.md` §3–4) is a ready-made starting feature set.
5. **The DMC-as-pruner trick, repurposed for search.** DanZero+'s one clever idea: use a value
   prior to cut ~5000 legal moves down to a handful, then think hard about *those*. For us that
   means a fast policy prior (even our v1 heuristic) to prune the search frontier — making
   ISMCTS tractable in a browser.
6. **A less-exploitable (mixed) policy.** Because the friend's strongest "proof" is beating a
   *deterministic frozen net*, we should be wary of becoming that ourselves. Search with
   stochastic action selection, or explicit regret/equilibrium methods later, guards against being
   farmed the same way.
7. **Learn the tribute decision** eventually — the seam everyone leaves open.

## 4. What this implies for our engine (keep these true)
The crown-jewel engine (`03-engine/design.md`) is the substrate every opening above needs.
Non-negotiables this analysis reinforces:
- **Cheap clone + `applyMove` + `legalMoves` = the simulator** for PIMC/ISMCTS. Already a stated
  requirement; this is *the* reason it matters.
- **A belief/determinization helper:** given an `Observation` + public history, **sample hidden-
  hand assignments consistent with what's been seen** (and, ideally, weighted by likelihood +
  tribute deductions). This is listed as an engine requirement in `04-bots/roadmap.md` — treat it
  as first-class.
- **Speed.** Their bots ran ~5000-wide action spaces and 100+ decisions/deal. Our `legalMoves`
  wild-enumeration is a known hot spot (`gotchas.md`); benchmark it before v2 search leans on it.
- **Determinism** (seeded RNG) for reproducible self-play and debugging — already locked.

## 5. The compute reality (informing the deferred decision)
A blunt cost picture for when we decide how far to go:
- **The DanZero recipe is cheap in code, expensive in CPU.** ~30 CPU-weeks (160 CPUs × 30 days)
  for the DMC net; PPO was <1 day on top. Reproducible but not free.
- **Pure search (PIMC/ISMCTS) needs no training** — just a fast engine and CPU at *inference*
  time. This fits our client-side, no-training-pipeline default and is the cheapest route to
  beating reactive bots. **Strong recommendation: this is bot v2 and likely our best ROI.**
- **A learned leaf evaluator** is the natural next step if pure search plateaus — and only *then*
  does the "train offline, ship weights" question become live.
- We do **not** need to match their compute to beat their bots. Search beats reactive nets in
  imperfect-info games more often than more-of-the-same training does. We win on *method*, not
  *scale* — at least until we're fighting for the last few percent.

## 6. Open research TODOs (the full field map is in `landscape.md`)
> ⚠️ **Correction (2026-06-25):** an earlier draft listed "PerfectDan" here as a search-based
> Guandan agent to chase down. **It does not exist** — it was an LLM hallucination (a blend of the
> real *PerfectDou* Doudizhu agent + DanZero). See `landscape.md`. The real prior art is below.

- ✅ **GS2** (NeurIPS 2023) and the **2020 PIMC+UCT** system — the search-based precedents, now
  fully written up: **`gs2.md`** and **`pimc-uct-2020.md`.** Two load-bearing lessons for our v2:
  (a) **naive PIMC is only "marginally better than random" on Guandan** (the 2020 result) — we
  must clear that floor with **ISMCTS + belief-conditioned sampling + a leaf evaluator**, not bare
  determinized UCT; (b) GS2's **diversity hand sampler** (sample many hands, DP-select a
  value-diverse k-subset) is a cheap, portable upgrade to the determinization step. Both reinforce
  openings #1–#4 above. (GS2's heavy CFR subgame solver is *not* portable — see `gs2.md` §9.)
- **SDMC** (Nanjing, 2024) — already tried **soft action sampling to resist exploitation** (our
  §3.6 idea); only ~57.6% vs DanZero. Read how much it actually bought. (`landscape.md` §A)
- **GuanZero** (2024) — DMC + "behavior regulating" for teammate cooperation — relevant to the
  weak-partner-coordination gap. (`landscape.md` §A)
- **OpenGuanDan** (2026) — a standard Guandan benchmark/simulator (models tribute) we could
  evaluate against on neutral ground. (`landscape.md` §D)
- **DouZero / DouDizhu lineage** — DanZero is "DouZero for Guandan"; the DouZero papers/repo are
  the cleanest reference for the DMC recipe if we ever go the learned route.
- **ISMCTS / PIMC literature** (Cowling et al. on ISMCTS; PIMC analyses) — the theoretical
  backing for opening #1. Worth a reference doc before building v2.

---

### One-line takeaway
Everyone here built a **reactive** bot and validated it **softly**; the academic ones are
**opponent-blind** and the friend's headline number is **overfit to a weak baseline.** Our
opening is **decision-time search over sampled hidden hands, fed by real belief tracking
(including the free tribute deduction)** — which is exactly what our pure, fast, deterministic
engine was designed to enable. We beat them on **method**, not compute.
</content>
