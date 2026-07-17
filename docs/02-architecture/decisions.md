# Architecture Decision Log (ADRs)

Append-only. Newest at top. Each entry: date, decision, why, alternatives, status.

---
## ADR-0017 — Search bots run in a Web Worker; the champion is wired into the web app (supersedes ADR-0005)
**Date:** 2026-07-15 · **Status:** Accepted (built, tested, browser-verified)
**Context:** The human called the integration step ("get the current best bots in the website").
The champion `ismcts-rollout-huge` (1800 iters + rollout leaf + belief sampler) burns ~1–2 s of CPU
per decision; ADR-0005's main-thread-with-a-timer approach would freeze every tap and animation for
the whole search. The engine/bots stack is pure TS with no I/O, so it bundles into a worker
unchanged, and `belief.ts` already falls back to current-trick-only inference when no history is
threaded — exactly the web app's situation (the arena's history threading is NOT wired into the web
controller; per ADR-0011/0016 both history lanes measured neutral-to-harmful anyway, so nothing
gated-in is lost).
**Decision:** `apps/web/src/game/bot-worker.ts` (a Vite module worker) owns bot instances; the
controller posts `(id, difficulty, observation, legalMoves)` per bot turn and applies the returned
move. Requests carry a monotonic id — only the response matching the newest request is applied, and
a snapshot guard (`status === "playing" && toAct === seat`) protects against stale application. A
750 ms floor keeps instant decisions (forced moves, the easy bot) watchable. Bot decisions draw
from the worker's own fixed-seed RNG; the match RNG stays on the main thread purely for dealing.
Difficulties mirror `tools/registry.ts` so web play is the measured thing: `best` =
`ismcts-rollout-huge` (~2 s/move, the champion), `fast` = `ismcts-rollout-1200` (the budget-curve
knee, ~1 s/move, −0.17 pts/deal vs best), `easy` = heuristic v1. The topbar selector defaults to
`best`; the outstanding 2 s-vs-1 s latency decision is now a lived choice in the UI rather than a
config constant.
**Alternatives:** keep bots on the main thread (freezes the UI for seconds — rejected); one worker
per bot seat (no benefit — turns are strictly sequential); wire the arena's history threading into
the web controller for the tribute-pin lane (deferred — the lane gated null individually, and it
would couple the controller to `recordMove`'s bookkeeping before it pays measured rent).
**Consequences:** the web app now plays the strongest measured bot at every non-human seat; bot
strength changes land by editing one config map in `bot-worker.ts`. The QoL simplification of
ADR-0005 is retired.

---
## ADR-0016 — Belief = policy-likelihood weighting of determinized worlds (the apprentice's second job)
**Date:** 2026-07-09 · **Status:** Built; **GATE FAILED 2026-07-10** (−0.1325 pts/deal, z=−3.66
@1400 — the pooled likelihood sampler makes the champion WORSE; tribute pins on top read null,
+0.012 z=0.35 @1200). Diagnosis run per the pre-registered revisit: the challenger bundled the
likelihood SIGNAL with a fresh-worlds→reused-pool MECHANISM switch (ESS p50 ≈ 17 effective worlds
vs ~600 fresh before) — `run-plb-diag.sh` separated them (plb-u: pool+uniform weights; plb-r:
likelihood+refresh; plb-soft: flattened posterior). Park only if all three read negative.
**PARKED 2026-07-14 — all three arms read negative** (`box-results/plb-diag.log`, 1200 deals
each): plb-u −0.0567 z=−1.42 (pool alone trends harmful, ns); plb-r −0.1117 z=−2.92 (diversity
restored, failure replicates — refresh not adopted); plb-soft −0.0446 z=−1.15. Pool cost + a
signal cost that scales with signal strength; nothing recovers to parity. Caveat: the signal was
only ever measured through a pooled vehicle (fresh-world scoring rejected on cost, never read).
Reopen with a round-2 net or a cheaper fresh-world likelihood path. Code stays built + tested.
**Context:** The champion's belief is a weak instrument: 6 candidate worlds reweighted by ONE
hand-coded binary signal (current-trick pass plausibility). Cross-trick extensions of that signal
measured neutral-to-harmful (ADR-0011 parked), and the diagnosis stood: the *sampling vehicle*
cannot represent sharp per-player inference. Meanwhile task 8 banked a policy net that predicts the
champion's play from a seat's observation (nohist variant: CE equal to the full net, standalone
z=15.25 vs v1) — i.e., we now own a calibrated model of "how would this seat play if it held X?".
That is exactly the likelihood a principled belief needs (GIB's biddable-hands trick; Skat solvers;
`06-prior-art/our-edge.md`). The partner runs OUR code, so at ship time partner inference via this
model approaches exactness — the ADR-0011 revival, done right.
**Decision:** Per root decision, build a POOL of K base-sampled worlds and weight each by
`Σ_seat Σ_decision log P_net(observed move | seat's reconstructed hand in this world)`; ISMCTS
iterations then draw worlds from the pool ∝ weight (importance resampling; `policy-belief.ts`).
Three structural choices make it exact and cheap:
1. **Exact reconstruction, no rule replay:** `recordMove` now stamps each play/pass with a global
   `seq` + the pre-move trick (it holds the true state — recording beats re-deriving trick-close
   rules). A seat's hand at any past decision = its current hypothesized hand + the cards it has
   since played (per-seat attribution, ADR-0014).
2. **Likelihood factorizes:** the net conditions only on (own hand, public context), so the public
   part of every past decision is world-independent — encoded ONCE per root decision, with only the
   15 own-hand slots applied per world as first-layer column deltas (`towerForwardFromPre1`, ~2.5×
   cheaper than a full obs-tower pass; act-tower embeddings cached per decision).
3. **Never hard-kill a world:** per-decision likelihoods are ε-mixed with uniform over the k legal
   moves (default ε=0.15) — the net is a model, not an oracle. Weights are log-accumulated and
   max-subtracted; a `power` exponent can flatten a degenerate pool (unneeded so far: measured ESS
   p50 ≈ 17/64, p10 ≈ 4 — sharpened but healthy; ~20 ms/decision ≈ free next to 600-iter search).
**Consequences:** the pass-plausibility lane is superseded inside the new sampler (subsumed by pass
likelihoods, calibrated); the tribute-pin lane survives as the base dealer (`useTributeInfo` —
constructive constraints compose with soft weighting). Pool draws repeat worlds across iterations
(vs fresh-per-iteration before) — accepted; refreshable via `refresh` if it ever measures as a cost.
**Gate (pre-registered):** `ismcts-rollout-plb` vs `ismcts-rollout-big` (differ only in sampler),
paired harness, sequential to |z|≥3 or 1600 deals; secondary `plb-trib` vs `plb` for the pin base.
**Alternatives:** score fresh worlds every iteration (the old vehicle) — ~7 ms × 600 iters/move,
rejected on cost; thread simulated history into rollout observations (the "invasive rewrite") —
still open, orthogonal; hand-tuned likelihoods — the net is measurably better calibrated than
anything we'd hand-write. **Revisit:** if the gate is null, probe `maxEvents`/`power`/`pool` and a
round-2 net before shelving; if it passes, regenerate expert-iteration data WITH this sampler
(compounding loop, ADR-0015 (d)).

---
## ADR-0015 — Learned route runs through EXPERT ITERATION (policy from search stats), not value-leaf distillation
**Date:** 2026-07-06 · **Status:** Accepted (round 1 running; each round gated per ADR-0013)
**Context:** ADR-0012's Stage 1 (distill the rollout leaf's VALUE from game outcomes) was built,
fixed twice (level-2-only data; encoding v3), retrained on clean data — and **decisively failed its
gate** (`ismcts-learned` −0.265 pts/deal, z=−3.91 vs the champion; barely beats a linear model).
Diagnosis: outcome-labeled value regression learns a blurry average of weak-heuristic play and loses
exactly the tactical sharpness the search's leaf needs. Meanwhile the 2026-07-03 collection showed
the budget curve is NOT tapped (1200>600 at z=3.04) — leaf fidelity is what moves the knee.
**Decision:** Pursue the learned route as **expert iteration**: (a) log the champion's ROOT VISIT
DISTRIBUTIONS during self-play (`gen-search-data.ts`; 21k deals / 1.5M decisions banked); (b) train
a **two-tower policy net** (obs tower once per decision, tiny action tower per legal move, dot-score
softmax on visit fractions — the split is what makes a learned policy affordable inside rollouts);
(c) use it as the champion's ROLLOUT policy; (d) if gated stronger, regenerate data with the
improved champion and repeat. Visit counts are a denser, sharper target than outcomes — the net
imitates deliberation, not results — and the same net later powers policy-likelihood belief
(exact partner inference) and any Stage-2 RL warm start.
**Gates per round:** the apprentice alone must crush `heuristic` (sanity), and the net-rollout
champion must beat the incumbent at fixed iterations (leaf quality first, wall-clock second).
**Alternatives:** (a) keep iterating value-leaf distillation — rejected on the measured failure;
(b) jump to Stage-2 self-play RL — still premature (expert iteration is the cheap on-ramp that
reuses everything and produces its warm start). **Revisit:** if round-1 gates fail, diagnose per
the decision tree in status.md before abandoning (known caveats: zero history features inside
simulated rollouts; round-1 targets only cover search-considered moves).

---
## ADR-0014 — Observations carry the FULL public record (attributed plays, tribute exchange, resist) + match context; objective may condition on it
**Date:** 2026-07-01 · **Status:** Accepted (mechanism shipped; each consumer gated on ADR-0013 evals)
**Context:** The 2026-07-01 code audit found the "public information layer" (ADR-0011) recorded only
passes + `{giver, card}` — while its own gap analysis named **per-seat play attribution** the single
largest blind spot. Exact free information was being dropped: the tribute **receiver** (the paid card
is pinned in their hand), the **return card** (pinned in the giver's), and **cancelled tribute**
(a single resist proves BOTH big jokers sit with the resister — the two strongest cards, located).
Separately, bots optimized the flat +3/+2/+1 even at declarer-at-A deals where 1-4 is a STRIKE and
1-2/1-3 both win the match (danzero.md §2 encodes the same correction).
**Decision:** (a) `PublicHistory` gains `plays` (seat-attributed, exact cards), full `TributeEvent`
(giver/receiver/card/returnCard), and `resist`; the arena + paired-deal harness populate them
identically (shared helpers). (b) The belief sampler's two lanes are **separately switchable**
(`usePassHistory` / `useTributeInfo`) so the previously-bundled "history hurts" result can be
dissected; the constrained dealer does **exact-card pinning** with pins consumed as seen played.
(c) `Observation.matchCtx` (levels/declarer/strikes — all public) is threaded by the arena;
`value.ts dealValueCtx` conditions the deal objective at declarer-at-A deals, opt-in per bot
(`useMatchContext`). Engine stays memoryless/pure — all population happens in the orchestrator.
**Alternatives:** keep passes-only history (rejected: can't ever measure what isn't recorded);
put the record in `GameState` (rejected: ADR-0002; also unnecessary — and note the ADR-0011 claim
that a move-log makes cloning expensive is wrong for structurally-shared append-only logs, so cost
was never the real argument).
**Revisit:** default-on for any lane/objective only after a ≥3σ paired-deal win on the champion config.

---
## ADR-0013 — Gating instrument: paired per-deal eval (duplicate-style, CRN) replaces match-level A/Bs
**Date:** 2026-07-01 · **Status:** Accepted (governs all bot-strength gating from here)
**Context:** Every 2026-06-30 "neutral" result (belief/history/run-out) was measured on match-level
binary outcomes at n=48–96 → 95% CIs ±10–14pp. Mature-engine improvements come in 1–3% increments
(chess engine practice runs SPRT at tens of thousands of games). Reading those nulls as "hand-coded
ceiling reached" was an instrument-resolution error — the same class of mistake we criticized in
guandan.cards' evaluation.
**Decision:** All bot A/Bs gate on **`pnpm evald`** (`eval-deal.ts`): the SAME seeded deal is played
twice with lineups swapped under common random numbers; the per-deal value differential d = x − y is
a paired sample (deal luck cancels EXACTLY — identical bots give d ≡ 0 with zero variance). Deals
sample levels 2..A, simulated tribute contexts, and match contexts. Sequential runs stop at |z| ≥ 3
(repeated peeking at 1.96 inflates false positives). Sums pool additively across worker processes.
**Measured:** the known pimc-static>heuristic gap = z=4.37 in 7 s (the match harness needed ~25 min
for a barely-significant read). The leaf-scale-bug fix (+0.125 pts/deal, z=2.28 @ n=600) is invisible
at match-level n<1000 — exactly the effect size class we've been unable to see.
**Alternatives:** (a) more match games — rejected: ~6 deals of divergence per 1-bit outcome wastes
compute; (b) unpaired per-deal values — rejected: deal-luck variance dominates; pairing is the win.
**Consequence:** the "3 neutral results ⇒ near ceiling" conclusion (2026-06-30) is DOWNGRADED to
"effects < instrument resolution"; hand-coded levers are re-testable. Match-level eval stays for
final confirmation of match-objective changes (e.g. A-level conditioning) where per-deal points
undervalue the true objective (use `--score=match`).

---
## ADR-0012 — Commit to the learned route (human go, 2026-06-30): staged — rich leaf first, then self-play RL for the info axis
**Date:** 2026-06-30 · **Status:** **Accepted** (human committed after 3 neutral hand-coded results)
**Context:** Search budget plateaued (~1200–1800 iters, 2026-06-29). Hand-coded belief/history was
neutral-to-harmful (Path A) and a rollout-policy tweak was neutral (run-out v1). The ISMCTS+rollout
champion is **near its incremental hand-coded ceiling.** Both the strategy and gap analyses
(`04-bots/strategy-and-gaps.md`) point to a learned net as (a) the strength/speed ceiling-raiser and (b)
the only viable home for the **information + signalling axis** (a net ingests history for free; self-play
can discover coordination — which determinized search structurally cannot send). Human committed to the
learned route (AskUserQuestion, 2026-06-30).
**Decision — two stages, cheapest-validating first:**
- **Stage 1 — strong learned LEAF (rich encoding).** Fix Phase 1's encoding bottleneck (the count-based
  86-feature vector discarded tactical structure → it was only ~`pimc-static` strength, changelog
  2026-06-27). Add structural features (who-can-beat-what, run-out/bomb structure, control) + a bigger
  net, distilling the rollout leaf's verdict on **determinized (perfect-info) worlds.** All **pure-TS**
  (existing `@guandan/nn` + hand-written Adam trainer), local, ~$0. **Gate:** `ismcts-learned`
  matches/beats the rollout champion at µs leaf cost (faster → more iterations → possibly stronger).
  **HONEST SCOPE:** the leaf scores PERFECT-INFO worlds, so it does **NOT** address the information axis
  (it sees all hands). It's a strength/speed win, not the info/signalling ceiling.
- **Stage 2 — self-play RL learned POLICY (the info-axis ceiling).** A net conditioning on the
  **Observation** (hidden info + the public history we already thread) with value/policy heads, improved
  by **self-play** (AlphaZero/DMC-style). This is where the net LEARNS to exploit history + discover
  signalling — which distilling the current history-WEAK search cannot add. The real ceiling-raiser and
  the home for per-opponent modeling + coordination. **EXPENSIVE** (sustained compute; scoped smaller
  than DanZero's 160 CPU × 30 d). **Its own go/no-go after Stage 1** (the big compute decision).
**Why staged:** Stage 1 is cheap, reuses infra, gives fast feedback + an immediate strength/speed win,
and validates the net-evaluation infra before the big RL spend. Stage 2 is where the info axis lives but
is the real investment — and it subsumes the parked history work (ADR-0011).
**First step:** a RICH state encoding (foundational for BOTH stages), encoding the tactical structure the
count-based version discarded, guided by `04-bots/strategy-and-gaps.md`.
**Alternatives:** (a) Jump straight to Stage 2 RL — rejected as premature (validate the cheap leaf first;
manage compute). (b) Keep hand-coding — rejected (near ceiling). (c) Distill the SEARCH into a policy net
— cheap and conditions on history, BUT it imitates the current history-weak search so it can't add
info-axis skill; useful only as a fast policy / Stage-2 warm-start, not a ceiling-raiser alone.
**Revisit:** after Stage 1's ladder result → go/no-go on Stage 2 RL and its compute.

---
## ADR-0011 — Public-information layer ("history threading"): REQUIRED; first attempt failed; MUST REVISIT
**Date:** 2026-06-28 · **Status:** **REQUIRED but UNSOLVED — first hand-coded attempt (Path A) measured
neutral-to-HARMFUL (2026-06-30). The requirement STANDS; a future agent MUST return to this.**

> ⚠️ **MUST-REVISIT NOTICE (human directive, 2026-06-30).** Per-opponent hand modeling from the play
> history, tribute-as-deduction, and partnership signalling are **essential** to top-tier Guandan (see
> `04-bots/strategy-and-gaps.md`). The bot CANNOT be world-class without them. Our **first attempt failed
> to help and we do NOT fully understand why** — so this is *parked, not abandoned*. **A future agent is
> REQUIRED to come back to this.** When you do, assume one of two things is true and find out which:
> **(a) the implementation was wrong**, or **(b) there's a structural reason** rich belief doesn't pay
> off in our determinized-reweighting search (in which case the fix is a different mechanism — see below).
>
> **What was tried (Path A, methodology, so you don't repeat blind):** the engine stayed pure; the match
> runner (`arena.ts`) threaded a `PublicHistory` (passes + tribute) into `Observation.history`. The belief
> sampler (`belief.ts`) used it two ways: a SOFT cross-trick passing reweight over 6 uniform
> determinizations, and a HARD tribute "ceiling" via a constructive constrained deal (`determinizeWithTribute`).
> **Results:** cross-trick passing vs within-trick = **47.9%** (n=96, neutral); full history (passing +
> tribute) on the rollout champion = **33.3%** (n=48, significantly WORSE). We hypothesized the constrained
> deal was distributionally biased and **tested it (`tools/belief-bias-check.ts`) — REFUTED** (it matches an
> unbiased rejection sampler). **Cause of the harm is still unknown.** Plausible-but-unverified leads for the
> next agent: the cross-trick reweight may inject noise; selecting 1 of 6 reweighted worlds may collapse the
> determinization diversity ISMCTS relies on; or the signal needs a CONSTRUCTIVE per-player belief (extend
> the tribute pattern to per-seat card-exclusion sets) rather than reweighting. History is OFF by default
> (`makeBeliefSampler({useHistory:false})`) but the code is intact and opt-in for exactly this investigation.
> **Strong prior: the right long-term home for this is the LEARNED route (ADR-0010)** — a net ingests history
> for free and self-play can discover signalling, which determinized search structurally cannot send.

**Problem (why it's structural, not a feature gap):** The pure engine is **memoryless by design.**
`GameState` holds only the CURRENT position (the four hands, the current trick, the finished order);
`applyMove` keeps **no move log**; `observe()` exposes a **snapshot** `Observation` (hand, card counts,
current trick, `outOfPlay`). So bots **cannot see the public play history** — who played/passed what
across past tricks — nor the **tribute exchange**. That omission is forced by two principles: engine
purity (ADR-0002) and search cost (bots clone `GameState` millions of times; a state carrying a
move-log is far more expensive to clone — the cost that bounds the budget-scaling we measure). Giving
bots history is therefore an **architecture decision about where the public memory lives**, not a patch.
**Decision (proposed):** Add a **public-information layer OUTSIDE the pure deal engine** — a belief/history
**tracker** (in the bots/match layer) that watches every move + the tribute and maintains an accumulated
record, feeding bots a **richer observation**. The pure `GameState` stays snapshot-only so search cloning
stays cheap. Exact form TBD (separate tracker vs enriched `Observation`); the hard constraint is that
history must **not** bloat the cloned search state.
**Why REQUIRED (human, an expert player, 2026-06-28):** it is the foundational enabler for three things
that separate decent from expert play — and the human flags the omission as a hard cap on strength:
  1. **Tribute-as-deduction** — the opening tribute reveals exact cards; e.g. deducing opponents hold no
     jokers/high cards makes leading singles a winning line.
  2. **Cross-trick counting/inference** — remembering each seat's plays/passes across the whole deal (the
     current belief sampler, `belief.ts`, uses only the CURRENT trick).
  3. **Signalling** — partnership conventions, "the entirety of high-end Guandan strategy" (human):
     reading partner plays as coded info, and PLAYING to inform partner.
**Difficulty gradient (honest — they are NOT equally hard):** (1)+(2) are **tractable inference** that
fits the existing determinization/belief framework (bias hidden-hand sampling with more public signals)
— high ROI once history is available. (3) **Signalling is much harder:** determinized search (PIMC/
ISMCTS) structurally **under-values information-conveying moves** — each sampled world assumes the
partner already knows the layout, so "play X to tell partner Y" shows no benefit in simulation. *Reading*
signals is tractable inference; *sending* them well likely needs methods **beyond vanilla determinization**
(explicit conventions + partner modeling, belief-state search, or learned policies — cf. bridge
conventions / Hanabi). So history threading is **necessary but not sufficient** for signalling.
**Cost (refined 2026-06-28 — the speed hit is mostly AVOIDABLE, and concentrated in signalling):**
For **reading** information (counting + tribute-deduction), the tracker conditions the hidden-hand
sampling at the **ROOT** of search; the **rollout hot loop that dominates cost is untouched** (still
clones the lean state). Net per-move overhead ≈ a richer belief computed once per move (~+10–30% on the
sampling step, a small fraction of total) — **negligible for live play, minor for eval. No teardown.**
For **signalling** (using info INSIDE the search — modeling how the partner's belief updates from our
play), the cost is real and the method is different (belief-state carried through the tree/rollout) —
this is where speed AND feasibility bind for a search bot.
**Prior art / connection to the learned route (ADR-0010):** The RL bots (DanZero family) already encode
played-card **counting** as state features (`06-prior-art/danzero.md` §3, "played cards of the 3 others
3×54"); GuanZero adds a teammate-cooperation encoding; guandan.cards does **tribute-as-deduction**
explicitly. They pay ~nothing for it because a **neural policy gets history for free as input** — they
don't do determinized search over cloned states. So this whole limitation is **specific to our PIMC/
ISMCTS architecture**, and signalling — hard/expensive for search — is **nearly free for a learned
policy** (self-play can even discover conventions, cf. Hanabi). ⇒ the information/signalling axis is the
**strongest concrete argument for the learned route**; ADR-0011 and ADR-0010 are tightly coupled.
**Alternatives:** (a) Put the move-log inside `GameState` — rejected: bloats the cloned search state and
couples rules to belief (ADR-0002/0006). (b) Keep the snapshot-only `Observation` forever — rejected:
now identified as a **ceiling on strength**, not an acceptable simplification. (c) Solve signalling with
in-search belief-state tracking (explicit conventions + partner model) — viable but hard/brittle; weigh
against the learned route, which gets it more naturally.
**Plan / status:** Deferred (the budget-scaling + engine-throughput levers are the current cheap frontier),
but **recorded as REQUIRED** — top-tier strength is impossible without at least (1)+(2). Likely sequence:
thread public history → tribute + cross-trick inference (extend `belief.ts`) → then **signalling as its
own research track / ADR**. Cross-ref `00-overview/strategy-decisions.md` (Decision 4), `gotchas.md`
(2026-06-26 belief note), `06-prior-art/our-edge.md` (the tribute/coordination edge we critiqued others for).
**Revisit when:** the budget/throughput levers flatten, OR the learned-policy track starts (a learned
policy could subsume conventions), OR sooner if a measured strength plateau traces to opponent/partner
modeling blindness.

---
## ADR-0010 — Learned leaf via supervised DISTILLATION first (not RL self-play)
**Date:** 2026-06-26 · **Status:** **Phase 1 BUILT & EXPLORED (2026-06-27) — inconclusive; Phase 2 deferred**
**Phase 1 result:** the full pipeline was built in pure TS and works, but a simple net (lossy
count-based encoding + small MLP) is **not a reliably strong leaf** — `ismcts-learned` lands around
`pimc-static` strength and swings with the net (54%→23% vs pimc-static across two label schemes), well
short of the rollout champion. The bottleneck is **encoding richness + capacity**, not label noise.
**Phase 2** (richer encoding + bigger net + likely self-play RL) remains the path to a champion-class
fast leaf, and stays **deferred pending a human go/no-go** (it's the expensive route). Detail:
`docs/04-bots/learned-leaf-design.md` + changelog 2026-06-27.
**Decision (proposed):** Break the champion's seconds/move ceiling with a **learned value net** used
as the ISMCTS leaf, trained by **supervised distillation of the existing heuristic-rollout leaf** —
NOT by reinforcement-learning self-play. Generate `(determinized full state, deal-outcome value)`
pairs from self-play, regress a **small MLP**, export weights, and **reimplement the forward pass in
TypeScript** (µs inference, no ONNX/tf.js) behind the existing `LeafEvaluator` seam. Encoding +
inference live in a new pure-TS `packages/nn`; the engine stays pure. Full plan:
`docs/04-bots/learned-leaf-design.md`. A self-play *improvement loop* (the expensive RL regime) is
**Phase 2, explicitly deferred** to its own future ADR.
**Why:** The rollout leaf is what makes `ismcts-rollout` both strong and slow. A net that approximates
it in microseconds gives **strength AND interactive speed**. Distillation is cheap (a few M positions,
a small net — hours on one modest GPU, or CPU), unlike DanZero's ~30 CPU-weeks of RL — so we get most
of the upside without the deferred-training cost the human was wary of.
**Alternatives:** (a) Full DMC/RL self-play now (DanZero/GS2 style) — rejected as Phase 1; expensive,
unnecessary to first beat our own rollout. (b) Keep iterating pure search/heuristics — lower ceiling,
and doesn't fix the speed. (c) Ship ONNX/tf.js inference — rejected; per-call overhead blows the µs
leaf budget; a hand-rolled small-MLP forward pass is faster and dependency-free.
**Gates before it can replace anything:** TS↔PyTorch parity test; must match/beat `ismcts-rollout` on
the ladder at far lower cost; validate vs the external benchmark (task #3) to catch self-play overfit.
**Revisit / escalate when:** Phase 1 plateaus below strong external play → open a Phase-2 ADR for the
self-play improvement loop (the real RL compute decision).

---
## ADR-0009 — Compute strategy: git → cloud eval boxes; optimize the TS engine (no native rewrite yet)
**Date:** 2026-06-26 · **Status:** Accepted
**Decision:** (a) Put the project under **git** and push to a remote, so any machine can clone it.
(b) Run heavy strength evals on **cloud CPU boxes**, not the dev machine — the parallel harness pins
every core (one worker per core) and the champion is seconds/move, so a real campaign overwhelms a
laptop. `tools/remote/setup.sh` bootstraps a fresh Ubuntu box (Node 24 + pnpm + install) to run
`pnpm eval`/`pnpm ladder` headless. (c) Cut compute *per game* by optimizing the **TypeScript**
engine (the `legalMoves` bitset re-encoding, task #4) and smarter evals (sequential testing/early
stopping) — **keep the one shared TS engine; do NOT rewrite it in a native language yet.**
**Why:** The bottleneck the human hit is real and worth solving for a long campaign, but the first
levers are *more cores* (cloud, ~$0.30–1.50/hr for 32–64 vCPU spot/auction; pay-per-use) and *less
work per game* (bitset), not a language change. A native/WASM hot-loop port is ~2–5× but forks the
"one engine runs in the browser AND Node" design (ADR-0001) and is real maintenance — premature while
algorithmic + horizontal scaling are untapped. The same cloud box later serves learned-leaf self-play
data generation + training.
**Alternatives:** (a) Keep evaluating only on the dev machine — rejected (strains it, caps campaign
throughput). (b) Rewrite the engine in Rust/Go now — rejected as premature (see above); revisit at
M4 if throughput still binds after bitset + cloud. (c) GPU box now — only needed once the learned
leaf (training) starts; CPU boxes suffice for search-bot eval.
**Revisit when:** bitset + cloud still bind (then a Rust/WASM headless engine for eval/training,
keeping TS for the browser), or the learned-leaf track needs GPUs.

---
## ADR-0008 — Bot-strength campaign: measurement-first, external benchmark before more algorithm work
**Date:** 2026-06-26 · **Status:** Accepted (governs the active bot-strength track)
**Decision:** Treat bot strength as a long campaign whose **instruments come before its experiments.**
Concretely: (a) the eval harness runs in **parallel across CPU cores** (child-process workers,
`tools/parallel.ts`), pooling additive counts into the exact single-thread numbers (`poolResults`);
(b) bot strength is summarized by a **Bradley-Terry rating ladder** (`pnpm ladder`, `rating.ts`) —
one Elo per bot on a shared scale, not just pairwise win rates — fit by Zermelo/MM iteration, chosen
over sequential Elo because it's order-independent and fits the whole round-robin at once; (c) before
investing in stronger search/learning we build an **external benchmark** (OpenGuanDan referee engine
+ DanZero opponent, over their WebSocket interface) so strength is validated **off our own heuristic
baseline.** A learned value/leaf net stays **deferred but explicitly on the table** (human, 2026-06-26),
to be reopened as its own ADR once pure search plateaus (extends ADR-0007's "revisit when").
**Why:** A months-long campaign that only ever measures vs our own v1 heuristic would risk the exact
failure we documented for the guandan.cards bot — a headline win rate that's **overfit to a weak
baseline** (`06-prior-art/our-edge.md` §1.5). An external, independent opponent is the only honest
yardstick for the "strongest anywhere" goal. Parallel eval + a shared-scale ladder make the
inner loop (run an experiment, see if it's really stronger and by how much) fast and unambiguous —
single-threaded eval capped strong-bot sweeps at ~30 games (`gotchas.md`, 2026-06-25).
**Alternatives:** (a) Jump straight to ISMCTS measured vs our own bots — rejected as the first step;
faster to a "stronger" number but can't tell real strength from baseline overfit. (b) Sequential Elo
for the ladder — rejected (order-dependent). (c) Reimplement an opponent's rules to benchmark
in-house — rejected; their engines are closed/Java, and OpenGuanDan refereeing both players over a
socket removes the rule-variant-mismatch risk entirely.
**Revisit when:** pure search plateaus below strong external opponents → the learned-leaf ADR opens
(reopening ADR-0007's deferred training question).

---
## ADR-0007 — Bot v2 = client-side determinized search (ISMCTS/PIMC); no training pipeline yet
**Date:** 2026-06-25 · **Status:** Accepted (this is the active bot-strength direction)
**Decision:** Bot v2 is **decision-time search that runs entirely client-side in TypeScript** — the
PIMC/ISMCTS family — with **no offline neural-net training pipeline for now.** It is built directly
on the pure engine's simulator (`legalMoves` + `applyMove` + cheap `cloneState`). To support it the
engine gains two small, pure additions: (a) a public **`outOfPlay: Card[]`** field on `Observation`
(cards no longer in any hand — needed to sample hidden hands), and (b) a **`determinize(obs, rng)`**
helper that returns a full `GameState` with the other seats' hidden hands sampled consistently with
the observation. Design + the research basis live in `docs/04-bots/v2-search-design.md`.
**Why:** The prior-art study (`docs/06-prior-art/`) showed the existing bots (DanZero/DanZero+, the
guandan.cards bot) are all **reactive — no real decision-time search** — and the academic ones are
**opponent-blind**. Search over sampled hidden hands attacks exactly those gaps and needs only a
fast engine, which we already have — no 30-CPU-week training run (DanZero's cost). It fits the
client-only M1/M2 product (ADR-0003) and the human's "document-now-decide-training-later" steer.
GS2 (NeurIPS 2023) confirms search beats the DMC line head-to-head, but its CFR machinery needs a
trained value net + server compute — out of scope; we borrow its *idea* (diversity hand sampling),
not its stack (`docs/06-prior-art/gs2.md`).
**Alternatives:** (a) Train a DanZero-style DMC/PPO net and ship weights — deferred; expensive and
the human hasn't opted in. (b) Keep iterating the v1 heuristic — lower ceiling; no lookahead. (c)
Put play-history/belief state in the engine `GameState` — rejected, keeps the rules pure (ADR-0002);
`outOfPlay` is *derived* in `observe()`, not stored, and determinization lives in its own file.
**Known risk (from prior art):** the 2020 PIMC+UCT Guandan system was only "marginally better than
random" (`docs/06-prior-art/pimc-uct-2020.md`). So **naive uniform-sample + random-rollout PIMC is
the floor to clear, not the goal** — plan for ISMCTS (over infosets, to fight strategy fusion in
2v2), belief-conditioned sampling, and a heuristic/learned leaf evaluator (v1 is the first leaf).
**Revisit when:** pure search plateaus below strong-human play — then a learned leaf evaluator
(offline-trained, weights shipped) becomes the next ADR, reopening the deferred training question.

---
## ADR-0006 — Web hand model uses stable card keys; table history lives in the controller
**Date:** 2026-06-23 · **Status:** Accepted
**Decision:** In `apps/web`, (a) the human's hand is modeled as `Slot = { key, card }` with a stable
key per physical card, and selection + manual groups are sets of keys; (b) per-trick table history
("who last played/passed", winning combo persisting) is derived and stored in the controller
(`useGuandanGame`), NOT in the engine. The engine remains untouched and pure.
**Why:** Grouping must survive re-sorts and other copies being played — sorted-position selection
(the prior approach) can't, since positions shift. Stable keys also keep the double-deck duplicate
fix. Table history is a presentation concern; the rules engine only needs the current trick top, so
adding history there would bloat `GameState` and violate the purity directive (ADR-0002). The
controller already sees every move (human via `play`/`pass`, bots via `stepBot`), so logging there
is free.
**Alternatives:** (a) Keep position-based selection — rejected, can't support persistent groups.
(b) Add a move/history log to engine `GameState` — rejected; couples rules to UI needs and grows the
state bots must clone millions of times. **Revisit when:** multiplayer needs a server-authoritative
move log — then a history layer belongs in the match/server layer, still above the pure deal engine.

---
## ADR-0005 — M1 web UI runs bots on the main thread (not a Web Worker yet)
**Date:** 2026-06-23 · **Status:** Accepted (revisit at bot v2)
**Decision:** The M1 web app drives bots on the main thread via a timed loop in
`useGuandanGame` (a `setTimeout` between plays, ~750ms, so moves are watchable). This deviates
from ADR-0003 / `05-frontend/design.md`, which call for bots in a Web Worker.
**Why:** v0/v1 bots compute effectively instantly, so a worker adds message-passing and
serialization complexity with no current benefit, and slows shipping a playable game. The
async/timed boundary is already isolated in one place (`stepBot`), so moving it behind a worker
later is a localized change.
**Alternatives:** Web Worker now — rejected as premature for instant bots.
**Revisit when:** bot v2 (determinized MCTS) lands and bot "thinking" could block the UI; move
`stepBot` into a worker then. Tracked in `gotchas.md` and `05-frontend/design.md`.
Also note: M1 auto-resolves tribute (incl. the human's) with the engine default return-card
policy and shows the result, rather than prompting the human — to be upgraded with bot v1.

---
## ADR-0004 — `legalMoves` emits one wild-minimal play per (type, rank, length)
**Date:** 2026-06-22 · **Status:** Accepted (revisit for v2+ bots)
**Decision:** The move generator (`packages/engine/moves.ts`) enumerates combos by TYPE (not by
subset), emitting each distinct (type, rank, length) play exactly once, formed with the FEWEST
wild cards necessary (naturals first). It does NOT also emit the wild-spending variant of a play
that is already formable without wilds, nor every choice of which pair to attach to a full house.
**Why:** Keeps the move list compact and generation fast (the hot path for search bots), avoids a
2^27-subset blowup, and conserves wilds by default — correct behavior for v0/v1. The classifier
(`classify`) still recognizes ALL interpretations, so legality/validation is unaffected.
**Alternatives:** (a) Enumerate every physical realization incl. wild-spend variants — rejected
now as combinatorially heavy and unnecessary for current bots. (b) Defer wild choice to the move
applier — rejected; the Move must carry concrete cards to stay a total `(state, move) -> state`.
**Revisit when:** a v2+ bot demonstrably benefits from deliberately spending a wild on an
otherwise-natural combo; then add opt-in wild-spend variants. Tracked in `moves.ts` + gotchas.

---
## ADR-0003 — Client-only for M1 (no server yet)
**Date:** 2026-06-22 · **Status:** Accepted
**Decision:** M1 ships as a fully client-side static web app; bots run in the browser
(in a Web Worker to keep the UI responsive). No backend, accounts, or DB until M3.
**Why:** Fastest path to something playable on the human's phone; forces engine correctness
first; free hosting.
**Alternatives:** Server-authoritative from day one — rejected as premature complexity.

---
## ADR-0002 — Engine is a pure, dependency-free TS package
**Date:** 2026-06-22 · **Status:** Accepted
**Decision:** All game rules live in `packages/engine` with no UI/network/IO and no runtime
dependencies. Randomness is injected via a seeded RNG. State is plain serializable data.
**Why:** A strong bot must simulate millions of games headlessly; rules tangled into UI make
that impossible. Purity also makes the engine exhaustively testable.
**Alternatives:** Rules inside React/server code — rejected (kills the bot goal).

---
## ADR-0001 — TypeScript everywhere, pnpm monorepo
**Date:** 2026-06-22 · **Status:** Accepted
**Decision:** Single TS codebase for engine/bots/web/server, managed as a pnpm workspace.
**Why:** One engine reused in browser and Node; best agent tooling; human can read TS.
**Alternatives:** Python engine + JS frontend (two languages, porting overhead) — rejected
since agents do the coding and a shared engine is worth more than the human's Python comfort.
