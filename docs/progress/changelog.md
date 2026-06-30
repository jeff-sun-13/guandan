# Changelog

Append-only, newest at top. One entry per working session. Format:
`## YYYY-MM-DD — short title` then bullets of what changed and why.

---
## 2026-06-30 — Path A (history threading, ADR-0011) built; cross-trick passing = no gain; tribute A/B running
- **Built the public-information layer** (the first real step past the tapped-out search budget). The
  memoryless engine stays pure; the match runner (arena) accumulates a `PublicHistory` (every pass with
  the top faced + the tribute exchange) and threads it into each bot's `Observation.history`. Two
  belief upgrades in the sampler: (1) **cross-trick passing** (soft importance weight — a strict
  superset of the old within-trick signal), (2) **tribute-as-deduction** (a HARD ceiling — a giver
  paid their highest non-wild single, so the tribute-aware determinization forbids dealing them any
  higher non-wild card, pushing the strong cards onto the other hidden hands). A/B toggle via
  `makeBeliefSampler({useHistory})`. **42 tests green** incl. the hard-ceiling guarantee.
- **Result 1 (NARROW) — cross-trick *passing memory* adds ~nothing.** `ismcts-hist` vs `ismcts-nohist`
  (static leaf, 1200 iters) = **47.9%** (CI 38.2–57.8, n=96, inconclusive). `nohist` still uses
  *within-trick* passing, so this only measures the MARGINAL value of remembering OLD passes — ~zero
  (the "who can't beat this" signal is mostly in the current trick).
- ⚠️ **CORRECTION — do NOT read this as "history doesn't help."** (Human flagged the overreach,
  2026-06-30, correctly.) This test covered only ONE narrow slice — *passing*. It says nothing about the
  far bigger unused signal: **per-player inference from what opponents PLAY.** What the bot actually does
  vs ignores: it counts cards at the **set level** (`outOfPlay` — which cards are gone) but does **NOT
  attribute plays to players**, so it has **no per-opponent hand model** (no "seat 2 dumped his high
  cards and passed a 6 ⇒ he's weak/void up top ⇒ lead singles at him; danger is seat 3"). That
  per-opponent modeling is most of what a strong human does, and we do none of it. So the information
  axis is **largely UNTESTED, not tapped.** Also: a 6-sample importance reweighting is itself a weak
  vehicle for rich inference. A pure-Guandan-strategy re-think + a code gap-analysis are in progress
  before drawing conclusions or pivoting to the learned route.
- **Tribute A/B RUNNING** (the one signal we DID build well — a hard ceiling). Since cross-trick passing
  is ~neutral, the full-history A/B ≈ isolates TRIBUTE. On the ROLLOUT champion (belief matters most
  there): `ismcts-rollout-hist` vs `-nohist`, n=24. Pending — report it, don't over-generalize from it.
- **Strategy re-think (2 parallel agents) → new `docs/04-bots/strategy-and-gaps.md`.** First-principles
  Guandan strategy (ranked by win-rate impact: pair-coordination > endgame control > bomb economy >
  per-opponent reading > counting > tribute > signalling) + a code-grounded gap audit. Key conclusions:
  (1) the bot's biggest blind spot is **no per-player play-attribution** (it counts cards at the set
  level but never models each opponent's depletion); (2) the **belief-sampling mechanism** (reweighting 6
  uniform worlds) is too weak to represent sharp per-player inference — that's *why* passing scored 0; it
  only works when **constructive** (the tribute ceiling); (3) **highest strength-per-effort right now =
  leaf/rollout quality, esp. endgame bomb management** (architecture-free, re-opens the budget knee); (4)
  the information + signalling axis ultimately favors the **learned route** (ADR-0010). Docs corrected:
  the earlier "information axis tapped → learned route" read here was an overreach from a narrow test.

---
## 2026-06-29 — Budget-saturation curve: strength PLATEAUS ~1200–1800 iters (revises the "no plateau" claim)
- Ran overnight + into the day on the Hetzner box: a budget ladder + head-to-head probes mapping
  `ismcts-rollout` strength vs ISMCTS search iterations. Full curve — **Elo, 6-bot playable-range
  ladder, n=24 mirrored/pair, `pimc-static` anchor**:
  | iters | 150 | 300 | 600 | 1200 | 1800 |
  | Elo   |1193 |1473 |1662 |1842  |1877  |
  Gains per step: 150→300 **+280**, 300→600 **+189**, 600→1200 **+180**, 1200→1800 **+35** (flattening).
  Top end (head-to-head): 2400 beats 1200 (33–15, 68.8%), but **3600 vs 1800 = 58.3%** (CI 38.8–75.5,
  inconclusive) and **7200 vs 3600 = 37.5%** (inconclusive, trends worse). So strength is FLAT past ~1800.
- **Finding — the knee is ~1200–1800 iterations.** Steep gains to ~1200, diminishing to ~1800, nothing
  measurable beyond. **This REVISES the 2026-06-28 "compute-elastic, no plateau" claim**, which
  extrapolated from only the 150→600 jump (deep in the steep region). The rollout leaf DOES saturate;
  we've now located where. (Earlier 4-bot overnight ladder agreed: huge 1920, big 1741, 150 1296,
  pimc-static 1044.)
- **Ship implication:** **~1200 iters is the strength/latency sweet spot** for live play (~1s/move with
  the fast-path), statistically tied with 1800 (Elo 1842 vs 1877). Champion = `huge` (1800) by a hair;
  `1200` is effectively co-champion at lower cost. Past ~1800 = wasted compute.
- **Strategic:** the **search-budget lever is tapped out FOR THE CURRENT APPROACH.** Important nuance
  (human, 2026-06-29): the knee is a property of today's information + leaf quality, NOT a fundamental
  ceiling — **richer belief (history threading) or a better leaf make each iteration more informative,
  which can shift the curve up AND move the knee right**, re-opening budget as a lever later. So the
  sequence is: improve information/leaf first (history threading, ADR-0011 Path A; or the learned leaf,
  ADR-0010), THEN re-measure the budget curve. Stopped the `day` ladder early once 2400/3600 were
  confirmed uninformative.

---
## 2026-06-28 — NEW CHAMPION: ismcts-rollout-big (600 iters) beats the 150-iter champion ~97%; search budget scales hard
- **Ran the budget-crank test on the Hetzner box** (178.156.158.230, 8 vCPU) — the campaign's first
  real use of remote compute (ADR-0009). Result is decisive: **`ismcts-rollout-big` (600 ISMCTS
  iterations) beats the reigning champion `ismcts-rollout` (150 iters) 31–1 / 32 = 96.9%**, 95% Wilson
  CI **[84.3%, 99.4%]** (mirrored, seeds 1–16). **`ismcts-rollout-big` is the new strongest bot.**
  `ismcts-rollout-huge` (1800 iters) vs the 150-champion is running now (will rank big-vs-huge).
- **The headline lesson — search budget scales the rollout leaf HARD (overturns a prior gotcha).** The
  2026-06-26 ISMCTS note warned "decisions are largely stable past a few hundred iterations, so raising
  the iteration count alone won't close the gap." That was measured on the **static-leaf** ISMCTS and
  does **NOT** generalize: with the **rollout leaf**, 150→600 iters is a ~97% blowout. Intuition: a
  faithful (rollout) leaf gives each extra iteration real signal to integrate, so the tree keeps
  sharpening; a crude static leaf saturates. **Strength is strongly compute-elastic for the champion.**
- **Strategic consequence:** this re-prioritizes the campaign. (1) The champion was badly
  under-budgeted — cranking iterations is the cheapest strength lever we have right now, gated only by
  move-time. (2) That makes **rollout throughput more valuable, not less** — every speedup buys more
  affordable iterations → more strength. So engine fast-paths + a learned leaf both pay double. See the
  in-place-rollout finding below.
- **Process:** ran headless in tmux on the box, logged to `~/eval.log`, polled by a detached watcher
  (survives a dev-machine crash). `-big` took ~19 min for 32 games on 8 cores. Playbook + the box
  details are now in `tools/remote/README.md` (live-box block + ops gotchas). No code changes.

---
## 2026-06-28 — Engine throughput: rollout fast-path (trusted apply + lean observe), 1.29× verified
- Productionized the two low-risk wins the in-place prototype identified (below), as **additive PURE
  fast-paths** — no mutable second engine, purity directive intact:
  - `applyMoveTrusted` (engine): same shared impl as `applyMove` but skips the combo re-validation
    (`classify`) + `beats` check for moves already known legal (everything from `legalMoves`). One
    implementation gated by a `trusted` flag, so behaviour can't drift.
  - `observe(state, player, { includeOutOfPlay: false })`: skips building the O(108) `outOfPlay`
    array. Default (omitted) is unchanged — determinize/UI still get the full honest observation.
- Wired both into the PIMC + ISMCTS **rollout leaves** (the champion's hot path). Lean observe is
  gated on `rolloutBot === heuristicBot` (which provably never reads `outOfPlay`), so a custom rollout
  policy still gets the full observation — safe by construction.
- **Verified equivalence + speedup.** New engine test (`apply-trusted-equivalence.test.ts`): trusted
  == checked transition is deep-equal at every ply of 50 random deals, lean observe == full save for
  `outOfPlay`, and purity (input unmutated). **136 tests green** (was 134), all packages typecheck.
  Head-to-head bench (`tools/bench-rollout.ts`, identical checksums = identical work): **1,740 →
  2,252 heuristic rollouts/s = 1.29×.** Directly buys ~29% more ISMCTS iterations per move-budget —
  and we just proved (above) strength is compute-elastic, so that's free strength for the champion.
- **Untouched bigger lever (noted):** the tree-descent `applyMove` calls in ISMCTS could also be
  trusted (moves come from `candidatesAt`→`legalMoves`); and `legalMoves`/`enumerateCombos` itself
  (a rollout-specific cheap move generator) remains the largest prize. Left for a focused follow-up.

---
## 2026-06-28 — Measured: rollout cost is redundant work, not allocation (in-place core only ~1.37×)
- Prototyped an allocation-free in-place rollout core (`tools/fast-rollout-bench.ts`) to test whether
  per-ply `cloneState` is the rollout bottleneck. **It isn't.** Correctness gate passed (identical
  finish order + dealValue vs the pure rollout over 5,000 deals), then throughput (30k heuristic
  rollouts): pure ~1,830 deals/s → in-place ~2,540 deals/s, **only ~1.37×**. Decomposition: skipping
  `applyMove`'s `validatePlay`/`classify()` re-validation ≈ 55–60% of the gain, skipping the unused
  `outOfPlay` array in `observe` ≈ 30–40%, true in-place mutation (no clones) ≈ **0%** (V8 GC makes
  short-lived clones ~free). Full writeup + the "don't build a second mutable engine path" guidance in
  `docs/gotchas.md`. **Actionable, low-risk, purity-preserving wins:** a "trusted apply" (skip
  re-validation for already-legal rollout moves) + a lean state-step (skip `outOfPlay`), both still
  returning fresh immutable state. The bigger untouched prize is `legalMoves`/`enumerateCombos` (a
  rollout-specific cheap move generator). Now higher-value given strength is compute-elastic (above).
  Nothing committed; prototype left for review.

---
## 2026-06-26 — Engine throughput: legalMoves type-routing → ~2.6× faster playouts (output-identical)
- Optimized the engine's hottest function, `legalMoves` (`packages/engine/src/moves.ts`), the #1
  compute lever (the rollout-leaf champion calls it ~143×/deal × ~150 rollouts/move). Two changes,
  both **provably output-identical** (same moves, same order, same card ids):
  1. **Type-routed following.** When following a trick, only enumerate the combo types that can beat
     the top — the top's own type (if non-bomb) + the bomb types — instead of enumerating ALL types
     then filtering. Skipped types would fail the `beats` filter anyway, so it's equivalent; it skips
     the expensive enumerations (notably the full-house double loop) on the majority of calls.
  2. **Bomb short-circuit.** The numeric-bomb loop skips ranks that can't reach size n
     (naturalCount + wilds < n) instead of blindly assembling all 4..10 of every rank.
- **Safety:** new equivalence property test (`moves-equivalence.test.ts`) asserts the optimized
  `legalMoves` is byte-identical to the old "enumerate-all + filter" oracle for ALL FOUR seats at
  every ply of 40 random deals (leading + every following top-type). So **no recorded eval result
  shifts** — the champion picks the same moves, just faster. 89 engine + 38 bots = **127 tests green**.
- **Measured (`pnpm bench`):** full random playout **635 → ~1635 deals/s (~2.6×)**; `legalMoves` fresh
  hand 21.5 → ~15 µs; **~322 vs ~127 full rollouts per 200 ms**. Directly cuts eval wall-time + the
  dev-machine CPU load the human flagged (ADR-0009). Updated the perf tables in `03-engine/design.md`
  + `04-bots/v2-search-design.md`. A further lever remains: typed-array `analyze` (constant-factor).

---
## 2026-06-26 — Infra decisions: git + cloud eval compute (ADR-0009); roadmap reaffirmed
- Human flagged that local evals strain the dev machine (correct — the parallel harness pins every
  core, by design) and asked to solve compute properly + put the project under git. Locked the
  strategy in **ADR-0009**: (a) git → remote, (b) run heavy evals on **cloud CPU boxes** (frees the
  laptop + more cores; the same box later hosts learned-leaf training), (c) cut compute/game by
  optimizing the **TS** engine (bitset, task #4) + smarter evals — **no native rewrite yet** (premature
  vs cloud + bitset; would fork the one-engine-browser+Node design).
- **Git:** couldn't auto-install (winget's GitHub download 403'd from this environment, even outside
  the sandbox — a network block). Left for the human to run `winget install --id Git.Git -e` in a
  normal terminal; then `git init` + commit. Prepped: expanded `.gitignore` (adds `tools/ladder.json`
  cache, coverage). Task #8.
- **Cloud eval:** wrote `tools/remote/setup.sh` (bootstrap a fresh Ubuntu box: Node 24 + pnpm + deps
  + tests) and `tools/remote/README.md` (provider/cost guidance, tmux workflow). Stopgap meanwhile:
  `pnpm eval … --jobs=6` throttles local runs. Task #9.
- **Roadmap reaffirmed (pursued after git+compute):** task #4 engine throughput (now higher value —
  the champion is rollout-bound), #10 learned leaf (ceiling-breaker: strength AND interactive speed),
  #3 external benchmark (off-baseline yardstick, needs the human's machine). No code/engine changes.

---
## 2026-06-27 — Learned leaf (ADR-0010 Phase 1): pipeline works, but a simple net isn't champion-class
- Built the **entire learned-leaf pipeline in pure TS/Node** (autonomous — no Python/GPU/Kaggle, since
  the net is tiny): `@guandan/nn` (state `encodeState` → 86 features; an `MLP` with a hand-written
  Adam trainer + JSON serialize), `tools/gen-data.ts` (self-play → labeled dataset), `tools/train.ts`
  (train + export weights), `bots/learned-leaf.ts` (a trained net as a `LeafEvaluator`); registry adds
  `ismcts-learned`/`pimc-learned` when weights exist. **134 tests green** (incl. a trainer test that
  only passes if forward+backprop+Adam are all correct). Committed as reusable infra.
- **Result — works, fast, but NOT champion-class and finicky.** The net learns real signal (val RMSE
  **1.61 vs 2.36** baseline) and `ismcts-learned` is **~20× faster than the rollout champion**
  (UI-viable). But its play strength is only ~`pimc-static` and swings with the net: single-outcome
  labels → **54%** vs pimc-static (n=48, inconclusive); averaged-rollout labels → **23%** (worse). A
  simple **lossy count-based encoding + small MLP is not a reliably strong leaf.**
- **Diagnosis:** the bottleneck is the **encoding** (card counts + trick state discard tactical
  structure — which straight, who-can-beat-what) + net capacity, NOT label noise (cleaner
  averaged-rollout labels didn't lower RMSE). Closing the gap to the rollout leaf needs **Phase 2**
  (richer encoding + bigger net + likely self-play RL) — the expensive path, deferred pending a human
  decision (ADR-0010).
- **Reframe (matters for the goal):** for the human pair actually PLAYING the bots, the rollout
  champion's "seconds/move" is **fine in a real game** (humans take seconds too). So the learned
  leaf's extreme speed is mainly for self-play/eval THROUGHPUT, not for sit-down play — the champion
  is already usable for the goal. The strong-but-slow vs fast-but-weaker tradeoff is real but doesn't
  block playing.

---
## 2026-06-26 — NEW CHAMPION (bot v2.3): ISMCTS + belief + rollout leaf beats pimc-static ~82%
- The v2 thesis test, and it **passed decisively.** `ismcts-rollout` = ISMCTS over infosets +
  belief-conditioned sampling + a heuristic **rollout leaf** (full-deal signal) — the complete "good
  search + belief + good leaf TOGETHER" combo the plan called for — beats the previous champion
  `pimcStaticBot`:
  - Three pooled batches (seeds 1–4, 5–20, 21–36): **59–13 / 72 = 81.9%**, 95% Wilson CI
    **[71.5%, 89.1%]** (highly significant; both 16-match batches independently 27–5 = 84.4%).
  - Config: `makeIsmctsBot({ iterations: 150, rollout: true, sampler: beliefSampler })`. Registered
    as `ismcts-rollout`. **This is the new strongest bot.**
- **Why it works — closes the loop on the session's findings.** ISMCTS (#5, ~heuristic-level) and
  belief (#6, helped only ISMCTS) were BOTH bottlenecked by the shape-only static leaf. Replacing it
  with a full-deal rollout leaf removes that bottleneck, and now: ISMCTS's lookahead + belief's
  realistic opponent hands + the rollout's faithful values compound. Each piece was necessary; none
  sufficed alone (static-leaf ISMCTS lost; belief did nothing for static-leaf PIMC; this combo wins).
- **Cost:** ~70–90 s/game ≈ seconds/move (the rollout leaf is ~1000× the static leaf, so iterations
  stay low at 150). **Too slow for the UI** — but the campaign is strength-first/final-product-only,
  so that's fine; a cheaper/learned leaf is the path back to interactive speed later (task #7c).
- **Process note:** eval batches must stay ≤16 matches with this bot — a 36-match run timed out at
  >9 min (no partial result; `pnpm eval` doesn't cache). Pool independent seed ranges instead. No
  engine/web changes; 126 tests still green.

---
## 2026-06-26 — Belief-conditioned sampling (bot v2 step 4): helps ISMCTS, not static-leaf PIMC
- Built **within-trick belief-conditioned determinization** (`packages/bots/src/belief.ts`,
  `makeBeliefSampler`). Plain `determinize` samples hidden hands UNIFORMLY; this importance-samples a
  small candidate pool and downweights worlds where a **cross-team passer in the current trick** could
  have cheaply followed (a non-bomb beat of the top) but didn't — passing usually means "couldn't
  cheaply beat," and you don't beat your own partner. Pure: derives the passers from the Observation
  alone (`currentTrickPassers` = the `passes` active seats before `toAct`); no engine/contract change,
  no history needed. Threaded a pluggable `sampler` into `makePimcBot` + `makeIsmctsBot`; registered
  `pimc-belief` / `ismcts-belief`. +5 tests (passer derivation incl. finished-seat skips, world
  validity). **126 tests green**, all packages typecheck.
- **Findings (measured):**
  - **Belief does NOT help the static-leaf PIMC champion:** `pimc-belief` vs `pimc-static` = **45.8%**
    (n=48, tied). Structural, not tuning: `staticDealValue` only counts hand SHAPE (plays-to-empty),
    so reshuffling WHICH cards opponents hold at fixed counts barely changes its score — belief info
    is wasted on a shape-only leaf.
  - **Belief DOES help ISMCTS:** `ismcts-belief` vs `ismcts-fast` = **45–35 / 80 = 56.3%**, 95% CI
    **[45.3%, 66.6%]** (consistently >50% across two seed batches; positive but not yet significant).
    ISMCTS simulates opponent responses in-tree, so realistic hidden hands actually change the search.
  - But ISMCTS+belief still **trails `pimc-static`** — belief narrows ISMCTS's gap, doesn't close it.
- **Root insight → next lever:** both ISMCTS (#5) and belief (#6) are bottlenecked by the **crude
  static leaf**. The static leaf is too shape-only to exploit card-identity (belief) or deep lookahead.
  So the unifying next step is **LEAF QUALITY** — a heuristic **rollout leaf** for `ismcts-belief`
  (the principled ISMCTS+belief+good-leaf combo, untested because slow), refining `staticDealValue`,
  and eventually a learned leaf (new task #7). **Champion stays `pimcStaticBot`.** No engine/web changes.
- **Scoped out (future, needs history threading):** cross-trick passing history + tribute-as-deduction
  — the bigger belief signals, which require giving bots the public play history (an architecture
  decision the current pure-Observation design defers).

---
## 2026-06-26 — Bot v2.2: ISMCTS implemented + measured — correct, but does NOT beat pimc-static
- Built **SO-ISMCTS** (`packages/bots/src/ismcts.ts`, `makeIsmctsBot`/`ismctsBot`) — the documented
  next raw-strength lever (`04-bots/v2-search-design.md` §4 step 3): one information-set tree keyed by
  the PUBLIC move signature (`type:rank:length` / `pass`), a fresh determinization resampled every
  iteration, UCB selection over the moves AVAILABLE in that world (availability counts), the deal
  modelled as **2-team zero-sum** (our team maximises the +3/+2/+1 deal value, opponents minimise it;
  partner is a cooperative searcher of the same objective — vs PIMC's greedy-heuristic teammate).
  Reuses the same pluggable leaf as PIMC (static default). Registered `ismcts` / `ismcts-fast` /
  `ismcts-big`. +4 tests (legality, determinism, forced-move, runs a full match). 121 tests green.
- **Result — correct but NOT the champion.** `ismcts`/`ismcts-fast` score **~43.8% vs heuristic**
  (n=32, inconclusive, trending below 50%), while `pimcStaticBot` gets ~73%. A single-position
  diagnostic confirmed the search genuinely works (it picks non-trivial plates/triples/straights over
  the cheapest single, iteration budget changes some decisions, and it **agrees with pimc-static on
  opening leads**) — so this is a real strength gap, not a bug. Raising iterations 600→1500→6000 did
  not help (decisions are largely stable past a few hundred iters).
- **Why (the honest read):** baseline ISMCTS's advantage (fighting strategy fusion) is outweighed by
  evaluating a CRUDE static leaf after an in-tree descent whose opponent nodes MINIMISE that crude
  value over **belief-free uniform** determinizations — noisier/more biased than PIMC's clean depth-1
  average over many worlds. This is exactly the prior-art lesson: the win is **ISMCTS + belief-
  conditioned sampling + a good leaf TOGETHER** (`06-prior-art/our-edge.md`, `pimc-uct-2020.md`), not
  ISMCTS alone. Tried (and reverted) deterministic cheapest-first expansion + lower c — measured
  WORSE (21.9%); random expansion + c=1.4 is the kept config.
- **Decision:** per the ship rule (must beat the champion on the ladder), **pimc-static stays the
  champion**; ISMCTS is a correct, documented rung **blocked on belief sampling (task #6)** and/or a
  stronger (rollout/learned) leaf. Next step folds belief-conditioned sampling into BOTH pimc and
  ismcts and re-measures. No engine/web changes.

---
## 2026-06-26 — Bot-strength campaign: foundations (parallel eval + rating ladder) + benchmark scoping
- Human reset priorities: **maximize bot strength as a long campaign, final product only — do NOT
  wire bots into the app.** Picked "foundations first" + "learned net on the table, decide later."
  Front-loaded measurement infrastructure because a months-long search/RL campaign optimizing only
  vs our own v1 heuristic would risk the exact overfit-to-a-weak-baseline trap we critiqued the
  guandan.cards bot for. Six campaign tasks tracked; foundations 1–2 landed this session.
- **Parallel eval harness (DONE).** `pnpm eval` now fans out across CPU cores via child processes:
  - `packages/bots/src/eval.ts` `poolResults()` — pure, combines H2HResults over disjoint seed
    ranges into the EXACT numbers a single run would give (counts are additive). +3 tests, incl. the
    "pooling == one combined run" guarantee.
  - `tools/registry.ts` — bot registry extracted from `eval.ts` so workers rebuild bots by name.
  - `tools/eval-worker.ts` — runs one seed sub-range, prints the H2HResult as JSON.
  - `tools/parallel.ts` `runParallelEval()` — chunks the seed range, spawns `node --import tsx`
    workers (default cores-1), pools. `tools/eval.ts` uses it (`--jobs`, `--no-parallel`).
  - **Measured:** pimc-static vs heuristic, 48 games in **9.9s (~4.8 games/s)** vs the documented
    ~1.1 games/s single-threaded (≈4–5× faster); reproduces the known ~72.5%. Slow strong-bot
    sweeps that capped at ~30 games (gotchas, 2026-06-25) are now cheap.
- **Rating ladder (DONE).** One Elo number per bot on a shared scale, not just pairwise win rates.
  - `packages/bots/src/rating.ts` `fitBradleyTerry()` — Bradley-Terry (Zermelo/MM iteration) over a
    round-robin win matrix → Elo-scaled, geomean-anchored to 1500; `formatLadder()`. Pure, +7 tests
    (balanced→equal, transitive order, base-centred mean, known-gap recovery, undefeated-stays-finite
    via smoothing). BT chosen over sequential Elo (order-independent, fits the whole matrix at once).
  - `tools/ladder.ts` (`pnpm ladder [matches] [bots…]`) — round-robins via the parallel runner,
    **caches per-pair results to `tools/ladder.json` keyed by run config**, so adding a new bot only
    plays ITS new pairings. First ladder (12 matches/pair): **pimc-static 1819, heuristic 1645,
    random 1036.**
- **External-benchmark research (scoped, not built).** Five research agents → the off-our-baseline
  yardstick plan: **OpenGuanDan** (github.com/GameAI-NJUPT/OpenGuanDan, arXiv 2602.00676) as a
  WebSocket+JSON *referee engine* (server supplies legal actions → no rules cross the boundary), with
  **DanZero** (AltmanD/guandan_mcc, Apache-2.0) as a strong opponent. Confirmed: DanZero's rules
  engine IS a closed binary; SDMC/GuanZero are paper-only; RLCard has no Guandan. Open: does
  OpenGuanDan ship trained agents+weights or only the engine (verify by cloning). No license on
  OpenGuanDan/Danzero_plus. Full plan in task #3 / status.md.
- **Rules flag (NOT acted on):** research claims two decks ⇒ n-of-a-kind bombs cap at **8, not 10**
  (4 suits × 2 decks). Our frozen `rules.md` says "4 up to 10" (human + Pagat confirmed). Harmless in
  practice (you can never assemble 9–10 physical copies, so those ordering slots are dead), but
  flagged to the human to confirm rather than touch frozen rules. See gotchas.
- **Totals: 117 tests green** (88 engine + 29 bots), all 4 packages typecheck. No engine/web changes.

---
## 2026-06-25 — Bot v2.1: static leaf evaluator — faster AND stronger PIMC (UI-viable)
- Added a cheap **static position evaluator** (`packages/bots/src/static-eval.ts`) so PIMC can score
  a sampled world WITHOUT a full rollout: per still-playing seat, estimate plays-to-empty (distinct
  ranks + jokers) + a bomb/control bonus, fold in who's already finished, score from the team's view.
  ~1µs vs a rollout's ~1ms. Lives in `@guandan/bots` (a bot's judgement, not an engine rule).
- Generalized `pimcBot` to take a pluggable **leaf evaluator** (`PimcOptions.leaf`, default = the
  heuristic rollout). Added `staticLeaf` + `pimcStaticBot` (K=100, maxCandidates=24). Registered
  `pimc-static` / `pimc-static-big` in `pnpm eval`. +2 bots tests (19 total).
- **Result — the static leaf is the better *tradeoff*** (not intrinsically stronger; the win is
  speed + cheap scaling):
  - **Beats v1 decisively:** `pimcStaticBot` (K=100) vs heuristic = **87–33 / 120 = 72.5%**, 95% CI
    **[63.9%, 79.7%]** (significant). The rollout PIMC at K=6 managed 66.7% vs the same opponent.
  - **But head-to-head, static ≈ rollout:** `pimc-static` (K=100) vs `pimc-fast` (rollout, K=6) =
    **21–19 / 40 = 52.5%**, CI [37.5%, 67.1%] → **inconclusive / roughly equal.** So the rollout
    leaf is *more informative per sample* (K=6 ≈ K=100-static), but the static leaf is so cheap that
    cranking K reaches the same strength far faster. The vs-v1 gap (72.5 vs 66.7) is mostly the K
    difference, not the leaf type — recorded honestly to avoid the confound.
  - **Faster:** ~**0.9 s/game** vs the rollout version's ~9.2 s/game (~5× faster) — ≈2 ms per move.
  - **UI-viable:** at ~ms/move it runs on the main thread without jank — unblocks putting a strong
    bot in the web app (the original reason for the static leaf), and scales further with more K.
- **`pimcStaticBot` (v2.1) is the new best *practical* bot** (≈ rollout strength, far faster). All
  packages typecheck; 88 engine + 19 bots tests green. v2 plan (`04-bots/v2-search-design.md`):
  step "cheap leaf eval" ✅ done.

---
## 2026-06-25 — Bot v2 kickoff: determinized search (PIMC v2.0) + engine prereqs + bench
- Started the north-star bot-strength track (human picked "start bot v2 (search)"). Locked the
  direction in **ADR-0007** and a concrete plan in **`docs/04-bots/v2-search-design.md`**:
  client-side decision-time search (PIMC → ISMCTS), **no training pipeline** — we win on method,
  not compute (grounded in `docs/06-prior-art/`).
- **Engine speed benchmark** — new `tools/bench.ts` + `pnpm bench`. Measured: ~1.58 ms/full
  random deal (635 deals/s), `legalMoves` 21.5 µs on a fresh hand (the hot path, as gotchas
  predicted), `applyMove` 0.68 µs / `cloneState` 0.09 µs, ~127 rollouts per 200 ms move budget.
  Recorded in `03-engine/design.md`.
- **Engine prerequisites for search (pure additions, ADR-0007):**
  - `Observation.outOfPlay: Card[]` — public cards no longer in any hand, derived in `observe()`
    (not stored → engine stays pure). Plus `outOfPlayCards(hands)` helper.
  - `determinize(obs, rng): GameState` (new `determinize.ts`) — samples a full state consistent
    with an observation (other seats' hidden hands drawn uniformly from the live pool by count).
    **+10 engine tests** (preserves own hand, matches counts, full-deck consistency, deterministic,
    faithful legal moves, rolls out to a valid finish, throws on inconsistent obs). Engine now 88 tests.
- **Bot v2.0 — `pimcBot`** (`packages/bots/src/pimc.ts`): for each candidate move, sample K worlds,
  roll each out to the deal end with the v1 heuristic (single-player search + greedy teammate, the
  GS2 trick), pick the best average deal value (+3/+2/+1 finish mapping). Common random numbers
  (shared worlds across candidates). Parameterised (`makePimcBot`); candidate prefilter keeps pass +
  go-out + cheapest plays. Registered in `pnpm eval` as `pimc` / `pimc-fast`. **+3 bots tests** (17).
- **Measured strength (`pnpm eval`):**
  - pimc-fast vs **random**: **10/0 (100%)** — search works end-to-end.
  - pimc-fast vs **heuristic (v1)**: **CONFIRMED STRONGER.** Two independent mirrored batches
    (seeds 1–30: 37–23; seeds 31–60: 43–17) pooled: **80–40 over 120 games = 66.7%**, 95% Wilson
    CI **[57.8%, 74.5%]** (lower bound > 50% → ship rule met). A real but **modest** edge over a
    decent heuristic — clearly past the "marginally better than random" floor (2020 paper), as
    expected for a *baseline* PIMC. Bigger gains await the next levers (cheap leaf eval, ISMCTS,
    belief sampling). Note: this is the cheap `pimc-fast` config (K=6); full `pimc` (K=20) should
    be stronger still but is ~3× slower.
- All packages typecheck; 88 engine + 17 bots tests green. **Bot v2.0 (PIMC) is the new strongest
  bot.** No web changes yet — pimc is seconds/move, so wiring it into the UI waits on a leaf-eval
  speedup / Web Worker (ADR-0005).

---
## 2026-06-25 — Deep dives on the two search-based Guandan agents (GS2, 2020 PIMC+UCT)
- Wrote up the two genuine search/game-theoretic precedents to our planned bot v2 (the line we
  most care about), via two parallel research agents:
  - **`06-prior-art/gs2.md`** — GS2 (NeurIPS 2023, "Efficient Subgame Refinement"). Full paper +
    supplement read (agent decompressed the NeurIPS PDF streams). It's **generative subgame solving
    (CFR family) on top of a DMC blueprint** — i.e. "DanZero + decision-time search." Beats DanZero
    ~62% head-to-head (third-party OpenGuanDan benchmark) but still <50% vs strong humans. **Verdict:
    the full system is NOT portable** (needs a DanZero-class value net + LP/MCCFR gadget solving
    under a few-second budget on a 10³⁰ infoset). **The portable gold is its diversity hand
    sampler** (sample many hands, DP-select a value-diverse k-subset) + concrete Guandan search
    knobs (depth ~10, top-2 actions/type, single-player search + greedy teammate).
  - **`06-prior-art/pimc-uct-2020.md`** — the 2020 CCDC paper (Shen et al.), the earliest Guandan
    AI and our closest design precedent (**PIMC determinization + UCT**). Paper is **paywalled**;
    only the verbatim abstract was accessible, so the doc carries explicit confidence flags and
    marks all missing detail "not found" (nothing fabricated). Key verified fact: it was only
    *"marginally better than random"* (corroborated verbatim by both DanZero papers). **The
    cautionary baseline:** naive determinized UCT (uniform sampling + random playouts) is near the
    floor on Guandan due to strategy fusion (acute in 2v2), wasted samples, and noisy leaf values.
    To clear it: **ISMCTS + belief-conditioned sampling + a learned/heuristic leaf evaluator.**
    Also flagged the common web misattribution of DanZero's numbers (30 days/160 CPUs/10³⁶ infosets)
    to this paper — they are NOT Shen et al.'s.
- Cross-linked both from `landscape.md` §B, `README.md`, and `our-edge.md` §6; updated status.md
  (TODO → done). Net steer for v2 now lives in `our-edge.md`. No code changes.

---
## 2026-06-25 — Guandan-AI landscape mapped; "PerfectDan" debunked
- Chased down "PerfectDan," a supposedly search-based Guandan agent flagged as a TODO in the
  prior-art docs. **Verdict: it does not exist** — it was an LLM hallucination from the earlier
  research pass (a name-blend of the real *PerfectDou* Doudizhu agent, NeurIPS 2022, + DanZero).
  Five independent searches all came back negative. Corrected every reference to it in the docs.
- The upside: the search surfaced the **full Guandan-AI research landscape**, which the initial
  prior-art pass had under-covered. New doc **`06-prior-art/landscape.md`** maps it with cited
  URLs and confidence flags:
  - Genuine **search/game-theoretic** lines (most relevant to our v2): **GS2** (NeurIPS 2023, CFR
    subgame refinement) and a **2020 PIMC+UCT** system (CCDC 2020) — the latter is essentially our
    planned v2 approach, done in 2020.
  - More DMC/RL agents: **GuanZero** (2024, teammate-cooperation encoding), **SDMC** (2024, soft
    action sampling to resist exploitation; won the 2nd Chinese Guandan competition; only ~57.6%
    vs DanZero — improvements over DanZero are consistently marginal).
  - **OpenGuanDan** (2026) — a standard benchmark/simulator (models tribute); its own conclusion
    is **no Guandan agent is superhuman yet** (validates our north star).
  - LLM theory-of-mind agent (arXiv 2408.02559); competitions (NJUPT's CGAIAC); repos.
  - Two dominant clusters: USTC/Houqiang Li (DanZero line) and Nanjing/NJUPT (SDMC, GS2,
    OpenGuanDan, the competition).
- Updated `06-prior-art/README.md`, `our-edge.md` §6, and status.md to remove the false TODO and
  point at the real prior art. **Lesson recorded:** unverified names from an LLM's *own commentary*
  (vs. quoted from a source) are a fabrication risk — verify before documenting. No code changes.

---
## 2026-06-23 — Prior-art research: documented the three known Guandan bots (`docs/06-prior-art/`)
- The human supplied the core reference works that will guide all future bot work and asked for
  a full read-through, opinions, and docs: the friend's guandan.cards bot-infrastructure page, the
  two DanZero RL papers (arXiv 2210.17087, 2312.02561), and the public DanZero+ code.
- Ran four parallel research agents (one per source), then synthesized into a **new top-level docs
  section `06-prior-art/`** (added to `docs/README.md` map):
  - `README.md` — section index + landscape comparison table + one-paragraph synthesis.
  - `danzero.md` — DanZero (DMC self-play). Foundational state/action encoding reference: 54-dim
    {0,1,2} card vectors, ~513-d state, per-legal-action Q-scoring (567-d input), 160 CPUs × 30
    days, ~82–90% vs 2022 rule bots, ~60% vs 10 humans.
  - `danzero-plus.md` — DanZero+ (PPO over DMC's top-k actions). Improvement is **marginal**:
    55/45 over DanZero, gain collapses away from k=2. Still reactive, still opponent-blind.
  - `reference-implementation.md` — the public code: repo layout, exact encodings/hparams, trained
    DMC weights shipped, and the key gap — **their rules engine is a closed binary**, so we build
    ours regardless (matches the crown-jewel mandate).
  - `guandan-cards-bot.md` — the friend's "Strategist": hand-engineered interpretable heuristic +
    one small MLP calibrator (NOT RL). Has one genuinely good idea (tribute-as-deduction) but its
    headline 100–0 / 99–1 vs the public DanZero(+) checkpoints is self-reported, unreproducible,
    and most likely overfit to a weak baseline. Blunt critique per the human's steer.
  - `our-edge.md` — the opinionated synthesis: all three are **reactive (no real decision-time
    search)**, the academic ones **opponent-blind**, none **learns tribute**, all **softly
    evaluated**. Our opening = **PIMC/ISMCTS search over sampled hidden hands + belief tracking +
    the free tribute deduction** — what our pure/fast/deterministic engine was built for. We beat
    them on **method, not compute.**
- Cross-linked from `00-overview/glossary.md` (new Bot/RL terms block) and `04-bots/roadmap.md`.
- Two product decisions from the human folded in: (a) **defer** "which path WE take" — these are
  reference + critique for now; (b) be **blunt** in the friend critique (internal docs).
- Flagged a research TODO: **read & document PerfectDan** (a search-based Guandan agent we haven't
  read yet) — see status.md open follow-ups and `our-edge.md` §6. No code changes this session.

---
## 2026-06-23 — Eval harness (`tools/`) — the gate for all bot-strength work
- Built the head-to-head evaluation harness agreed as the post-QoL step. Bot strength is the
  north star, and nothing on that track was measurable before this.
- **`packages/bots/src/eval.ts`** (core, where the rigor + tests live):
  - `evaluateHeadToHead(a, b, opts)` plays one bot lineup vs another over N seeded matches and
    reports A's win rate + **95% Wilson score interval**. **Mirrored by default**: each match is
    replayed with seats swapped on the same seed, cancelling first-leader/deal luck so the number
    reflects skill. `wilsonInterval` and `formatReport` (with a significance verdict) alongside.
  - 7 new tests: deterministic, mirror doubles games, win+draw counts == games, CI brackets the
    estimate, and heuristic ≫ random. Bots package now 14 tests (was 7).
- **`tools/`** — new workspace package (added to `pnpm-workspace.yaml`; `tools/` was already the
  target home in repo-structure). `tools/eval.ts` is a thin CLI over the core, run with **`tsx`**
  via the root script **`pnpm eval [botA] [botB] [N] [--no-mirror] [--seed N]`**. Added `tsx` +
  `@types/node` devDeps; `pnpm install` clean (esbuild postinstall already approved).
- **Decision — core in `bots`, CLI in `tools`:** the measurable stats core lives in the
  already-tested `@guandan/bots` package (builds directly on `playMatch`); `tools/` holds only
  arg-parsing + printing. Keeps rigor under vitest and lets the web app / future tools reuse it.
- **First measurements:** heuristic vs random = **200/0 = 100% (95% CI 98.1–100%)**, ~150 games/s.
  Mirror sanity check: heuristic vs heuristic = **exactly 50.0%** (CI straddles 50% → inconclusive),
  confirming no positional bias in the harness. Repo: **92 tests green**, 4 packages typecheck.

---
## 2026-06-23 — QoL pass: table history, stacked/grouped hand, combo chooser, tribute picker
- Human ran the app locally (desktop browser) and confirmed a full match plays fine — M1
  "playable" bar met. Then specced five quality-of-life features; all landed in `apps/web` with
  **zero engine changes** (engine stays pure — history/tribute-choice are UI concerns):
  - **Table history.** Added `board: Board` to the controller Snapshot; a new `applyLogged` updates
    each seat's last action (play/pass) per trick, and on trick resolution clears the board to just
    the winning combo, which persists in the center until that winner leads again. `Table.tsx` now
    renders per-seat actions + a `centerWinner` pile; the human's last action shows above the hand.
  - **Hand layout + grouping.** Rewrote the hand model from **selection-by-sorted-position** to
    **selection-by-stable-key** (`Slot = {key, card}`), which fixes duplicate-card selection AND
    lets manual groups survive re-sorts / cards leaving. Loose cards auto-stack by rank (fanned,
    offset; added a corner index to `CardView`). "Group selected" peels cards into their own pile;
    "✕ ungroup" / "N×" tags. Groups + selection live in the controller (`groups`, `selected` keys).
  - **Combo chooser.** `legalInterps` lists the distinct legal readings of the selection (via engine
    `classify`/`beats`, deduped by type:rank); `Controls.tsx` shows a "Play as:" row when ≥2 exist,
    defaulting to the weakest. `comboLabel` in `format.ts` renders the options.
  - **Tribute return picker.** Split tribute into payment vs return (`setupTribute`): bots auto-return,
    but when the human receives, a new `status: "tribute"` + `pending` pauses on a `TributeReturn`
    overlay (preview of who paid what + a card picker that disables the received card). `confirmReturn`
    applies the human's pick, then play begins.
- Verified: `tsc` clean, `vite build` succeeds (49 modules), **85 tests still green** (engine/bots
  untouched). Recorded ADR-0006 for the key-based hand model + controller-owned table history.

---
## 2026-06-23 — Bot v1 (heuristic) + wired into the web app (M1)
- **`packages/bots/heuristic.ts` `heuristicBot`** — first strategic bot (no search): goes out
  when a play empties the hand; cooperates with partner (passes on a partner-won trick);
  conserves bombs (only bombs when an opponent has ≤4 cards or to go out); beats opponents with
  the cheapest sufficient non-bomb; leads low and avoids fracturing a pair for a lone single.
- **Measured strength:** heuristic team beats a random team **60/60 (100%)** over seeded
  matches, avg ~6 deals/match — a decisive edge. Added a strength test (asserts majority) and a
  legality test (only ever returns legal moves). This is the seed of the `tools/` eval harness.
- **Made `heuristicBot` the default opponent** in the web app (replaces randomBot in the
  controller). Totals: 85 tests green (78 engine + 7 bots), clean `tsc`, web builds.

---
## 2026-06-23 — Playable web app vs 3 bots (M1)
- **`apps/web` is now a playable Guandan game** vs three v0 bots, mobile-first portrait.
  - `game/useGuandanGame.ts` — the controller hook. Owns match/deal state, drives bot turns on
    a ~750ms timer (main thread — ADR-0005, deviating from the planned Web Worker since v0/v1
    bots are instant), and maps the human's selected cards to a Move via `chooseMove` (leading
    → weakest non-bomb reading; following → weakest reading that still beats the trick).
  - Tribute between deals is auto-resolved (default return-card policy) and shown in a banner;
    finishing order + level changes shown in a between-deals overlay; match-over screen.
  - Components: `Table`, `Hand` (selection by hand POSITION so the double deck's duplicate
    cards select independently), `CardView` (wild cards get a gold glow + badge), `Controls`
    (live legality feedback), `Overlays`. Mobile-first CSS in `index.css`.
  - Wired `@guandan/web -> @guandan/engine + @guandan/bots`.
  - Verified: `tsc` clean, `vite build` succeeds (48 modules; engine+bots bundle to browser),
    dev server serves 200. Recorded ADR-0005 for the main-thread-bots decision.
  - NOT yet manually playtested in a browser/phone — that's the next human step.

---
## 2026-06-22 — Match layer + tribute + full match runner (M1)
- **Confirmed match progression against Pagat** before coding: each hand is played at the
  DECLARERS' (previous winner's) level; losers keep their own level; the match is won only by
  the declarers, on A, finishing 1-2 or 1-3; each hand a declarer-on-A fails is a strike, and
  the third strike demotes them to level 2.
- **`packages/engine/match.ts`** — `MatchState`/`createMatch`/`dealLevel`/`scoreDeal`/
  `applyDealResult`/`isMatchOver`. Handles promotion (+3/+2/+1, capped at A), the A-win
  condition, and three-strikes demotion. Pure; 17 tests.
- **`packages/engine/tribute.ts`** — `planTribute` (double-down → both losers pay, higher card
  to 1st, higher payer leads; single → last pays 1st; anti-tribute when the paying side holds
  both big jokers → previous 1st leads), `highestTributeCard`, `defaultReturnCard`. 9 tests.
- **`packages/bots/arena.ts`** — `playMatch(bots, rng)`: deal → tribute exchange → bot play →
  score, looped to a winner; deterministic per seed. Return tribute uses the default
  "give-back-lowest" policy for now (flagged as a future bot decision).
- Totals: **83 tests** (78 engine + 5 bots), clean `tsc`. Four random bots play whole matches.

---
## 2026-06-22 — Single-deal engine complete + bot v0 (M1)
- **Finished the single-deal engine** (`packages/engine`), TDD, now 56 tests + clean `tsc`:
  - `state.ts` — `GameState`/`Move`/`Trick`/`Observation` as plain serializable data;
    `cloneState`, `partnerOf`/`teamOf` (teams {0,2} vs {1,3}).
  - `deal.ts` — `createDeal` (seeded shuffle, 27/seat, RNG-chosen first leader),
    `applyMove` (full trick resolution), `isTerminal`/`result`/`observe`.
  - `moves.ts` — `enumerateCombos` (structured by type, wild-minimal) + `legalMoves`.
  - Confirmed trick rules against Pagat: passing does NOT eliminate you from a trick (you may
    bomb later); trick ends after the other active players pass consecutively; if the trick
    winner has gone out, the lead goes to their PARTNER.
  - Property test: 60 random self-play deals all terminate with a valid 4-seat finish order.
- **Added `packages/bots` with v0 (random legal).** Stable contract `Bot = (obs, legal, rng)
  => Move`; `randomBot`. A driver test runs four bots through complete deals end-to-end
  (precursor to the tools/ eval harness). Wired the workspace dep `@guandan/bots ->
  @guandan/engine`. Full repo: 59 tests green.
- Engine public API (`index.ts`) now exports the full single-deal surface + the move generator.

---
## 2026-06-22 — Rules frozen + engine foundation (M1 started)
- **Froze the rules.** Resolved every open question in `01-rules/open-questions.md` using the
  human's answers + Pagat (https://www.pagat.com/climbing/guan_dan.html, now the cited source
  of truth). Product decisions: first-deal leader = seeded-random; no return-tribute rank cap;
  A-level demotion implemented; standard level range 2→A. Rewrote `01-rules/rules.md` as the
  authoritative confirmed spec (removed all ⚠️).
- **Built the engine foundation** in `packages/engine/src` (TDD, 43 Vitest tests, clean
  `tsc`):
  - `rng.ts` — mulberry32 seeded RNG; plain-data state so it can live in GameState and clone
    cheaply for simulation.
  - `cards.ts` — cards as ints 0..53; suits/jokers; wild = Heart-of-level; `singleValue`
    encodes the level-rank elevation; `makeDeck` = 108 cards.
  - `combos.ts` — `classify` returns ALL legal interpretations of a card set (handles wild
    substitution, incl. two wilds); `beats` implements the full bomb ordering
    (4<5<straightFlush<6..<10<jokerBomb) and same-type non-bomb comparison.
  - Exported the new API from `index.ts`.
- **Gotcha hit & recorded:** `const enum` breaks under esbuild/Vitest (members aren't inlined
  across modules → `undefined` at runtime). Switched `Suit` to a regular `enum`. See gotchas.

---
## 2026-06-22 — Toolchain + monorepo scaffold (M0)
- Installed and verified Node v24.17.0 / npm 11.13.0 / pnpm 11.8.0 on the Windows dev machine
  (fixed PowerShell execution policy and PATH along the way — see `gotchas.md`).
- Scaffolded the pnpm monorepo: root `package.json`, `pnpm-workspace.yaml`,
  `tsconfig.base.json`, `.gitignore`.
- `packages/engine`: placeholder public API (`ENGINE_HELLO`/`ENGINE_VERSION`) + passing
  Vitest smoke test.
- `apps/web`: Vite 6 + React 19 + TS hello-world page, mobile-first viewport, `server.host`
  on for LAN/phone testing.
- Verified: `pnpm install` clean, engine test passes, web typechecks, `vite build` succeeds,
  dev server returns HTTP 200.

---
## 2026-06-22 — Project kickoff & docs scaffold
- Defined the project: mobile-friendly Guandan site vs strong bots; long-term goal = best
  Guandan bots anywhere.
- Collected scoping decisions from the human:
  - Stack: TypeScript (human only knows Python; agents do the coding).
  - First milestone: single-player vs 3 bots.
  - Hosting: a few $/month acceptable later.
  - Bots: strength is the main long-term goal; start small.
- Recorded ADR-0001/0002/0003 (TS monorepo; pure engine; client-only M1).
- Wrote the full docs tree under `docs/` (overview, rules draft + open questions,
  architecture, engine design, bot roadmap, frontend design, progress, gotchas).
- No code yet. Repo = `CLAUDE.md` + `docs/`.
