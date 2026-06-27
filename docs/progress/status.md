# Current Status

**Single source of truth for "where are we right now." Update this every session.**

_Last updated: 2026-06-26_

## Milestone: **M1 complete (playable web app vs 3 heuristic bots). Prior-art documented. NEW CHAMPION (bot v2.3) = `ismcts-rollout` = ISMCTS + belief-conditioned sampling + heuristic rollout leaf — beats the old champion `pimcStaticBot` ~82% (59–13/72, CI [71.5,89.1]). The v2 thesis (search + belief + good leaf TOGETHER) is validated. Cost: seconds/move (too slow for UI, fine for the strength-first campaign). In a dedicated bot-strength campaign — "maximize strength, long haul, final product only, do NOT wire into the app" (human, 2026-06-26). This session also built the parallel eval harness + Bradley-Terry ladder (`pnpm ladder`). External benchmark scoped (OpenGuanDan + DanZero).**

## Bot-strength campaign (active — the north star, human-directed 2026-06-26)
Direction: keep maximizing bot strength as a long research effort; integrate into the product once,
at the end (`memory/prefers-final-product`). A learned value/leaf net is **on the table but deferred**
(decide later; ADR-0007 revisit). The trap we're explicitly avoiding: optimizing only vs our own v1
heuristic = overfitting to a weak baseline (the critique we leveled at guandan.cards). Hence
foundations + an external benchmark come before more algorithm work.
Tracked as 7 tasks. **DONE: (1) parallel eval, (2) rating ladder, (5) ISMCTS, (6) belief sampling,
(7) leaf quality.** **NEW CHAMPION = `ismcts-rollout`** (ISMCTS + belief + rollout leaf), beats the
old champion `pimcStaticBot` ~82% — the v2 thesis validated end-to-end this session. The path there
told the story: static-leaf ISMCTS ≈ heuristic; belief helped ISMCTS but not shape-only PIMC; the
rollout leaf removed the bottleneck and the combo leapt ahead (changelog 2026-06-26). **Remaining:**
(3) external benchmark bridge (needs the human's machine); (4) engine throughput (`legalMoves` bitset
— now MORE valuable since the champion is seconds/move); and the deferred big levers — a **learned
leaf** (strength AND interactive speed; reopens training) and **history-threading** (unlocks belief's
cross-trick + tribute-as-deduction signals). Both want their own ADR.

## Done
- Locked stack: TypeScript everywhere, pnpm monorepo (ADR-0001).
- Locked engine-purity and client-only-M1 decisions (ADR-0002, ADR-0003).
- Wrote full docs scaffold (overview, rules draft, architecture, engine, bots, frontend).
- **Toolchain installed & verified:** node v24.17.0, npm 11.13.0, pnpm 11.8.0 (Windows).
- **Monorepo scaffolded & working:** `packages/engine` and `apps/web` (Vite + React 19 + TS).
  `pnpm install` clean, web typechecks, builds, and the dev server serves HTTP 200.
- **Rules FROZEN (2026-06-22):** all `01-rules/open-questions.md` items resolved (human +
  Pagat). `01-rules/rules.md` rewritten as the authoritative, confirmed spec (no more ⚠️).
- **Engine — single deal COMPLETE (M1):** 56 passing Vitest tests, clean typecheck:
  - `rng.ts` — deterministic, serializable seeded RNG (mulberry32): `makeRng/cloneRng/
    nextU32/nextFloat/nextInt/shuffle`.
  - `cards.ts` — compact card model (ids 0..53), suits, jokers, `cardRank/cardSuit/isWild/
    singleValue` (level elevation), `makeDeck` (108 cards).
  - `combos.ts` — `classify` (all legal interpretations incl. WILD substitution), `beats`
    (full bomb ordering 4<5<SF<6..<10<jokerBomb), `isLegalCombo`, `isBomb`.
  - `state.ts` — `GameState`/`Move`/`Trick`/`Observation` (plain serializable data),
    `cloneState`, `partnerOf`/`teamOf`.
  - `deal.ts` — `createDeal` (seeded shuffle, 27 each), `applyMove` (trick resolution,
    pass-doesn't-eliminate, 3-consecutive-pass close, partner-leads-if-winner-out, going-out
    + finish order), `isTerminal`/`result`/`observe`.
  - `moves.ts` — `enumerateCombos` (by type, wild-minimal) + `legalMoves`.
  - Property test: 60 random self-play deals always terminate with a valid finish order.
- **Bots — v0 (random legal) DONE:** new `packages/bots` with the stable `Bot = (obs, legal,
  rng) => Move` contract + `randomBot`.
- **Engine — MATCH LAYER DONE:** multi-deal rules, fully tested:
  - `match.ts` — `MatchState`, `createMatch`, `dealLevel` (declarers' level; first deal = 2),
    `scoreDeal` (+3/+2/+1), `applyDealResult` (promote winners capped at A, losers stay put,
    A-level win only for declarers finishing 1-2/1-3, three-strikes-at-A demotion to 2).
  - `tribute.ts` — `planTribute` (double-down vs single, anti-tribute on both big jokers,
    leader = higher payer / 1st if cancelled), `highestTributeCard`, `defaultReturnCard`.
- **Match runner DONE:** `packages/bots/arena.ts` `playMatch(bots, rng)` ties deal → tribute →
  play → score into a full match to a winner; deterministic per seed. Return-tribute uses the
  default "give back lowest" policy for now (a later bot decision).
- Four bots play complete matches end-to-end (deal → tribute → play → score).
- **Web UI — PLAYABLE (M1):** `apps/web` now plays a full match vs 3 bots, mobile-first.
  - `game/useGuandanGame.ts` — controller hook: drives deals/turns, runs bots on a timer
    (main thread for now, ADR-0005), translates the human's card selection into a Move
    (`chooseMove`), handles tribute between deals (auto, default policy, shown in a banner).
  - Components: `Table` (seats, levels, turn, center trick), `Hand` (position-based selection
    so duplicate cards work), `CardView` (wild glow/badge), `Controls` (Play/Pass/Clear with
    live legality feedback), `Overlays` (deal summary + match-over).
  - Verified: typechecks, `vite build` succeeds (engine+bots bundle to the browser), dev
    server serves 200. NOT yet manually playtested in a real browser/phone.
- **Bots — v1 (heuristic) DONE + wired in:** `packages/bots/heuristic.ts` `heuristicBot` —
  goes out when able, cooperates with partner (won't beat a partner-won trick), conserves
  bombs (only bombs when an opponent is low or to go out), beats opponents with the cheapest
  sufficient non-bomb, leads low without fracturing pairs. **Beats v0 60/60 (100%)** over
  seeded matches (avg ~6 deals/match). Now the default opponent in the web app.
- **Totals: 85 tests green** (78 engine + 7 bots), clean `tsc`, web builds.
- **Ran locally (2026-06-23):** human confirmed the app plays a full match fine in a desktop
  browser. This closes the M1 "playable" bar; phone testing still nice-to-have, not blocking.
- **QoL pass (2026-06-23) — five features, all in `apps/web` (engine untouched, stays pure):**
  1. **Table history.** Each seat shows its most recent play/pass for the current trick; when a
     trick resolves, the board clears to just the winning combo, which persists in the center
     until that player leads the next trick. Tracked in the controller (`board: Board` in the
     Snapshot, updated by `applyLogged`) — NOT the engine, since the rules don't need history.
  2. **Hand layout.** Loose cards auto-stack by rank into fanned, slightly-offset piles (corner
     index keeps suits readable). Selection is now by **stable per-card key** (was sorted-position)
     so duplicates select independently AND group membership survives re-sorts / cards being played.
  3. **Manual grouping.** Select cards → "Group selected" peels them into their own pile (left);
     each group shows an "✕ ungroup" tag; a rank-stack's "N×" tag selects the whole pile. Lets you
     pre-build straights/tubes/bombs and plan wilds. Groups reset each new deal.
  4. **Combo chooser.** When the selected cards have ≥2 distinct legal readings (e.g. straight vs
     straight-flush), a "Play as:" button row appears; one reading is auto-chosen (weakest) and the
     human can switch. Single-reading selections still auto-resolve. Reuses engine `classify`/`beats`.
  5. **Tribute return picker.** When the human RECEIVES tribute, play pauses on a preview overlay
     (who paid what) and the human chooses which card to give back (any but the received one). Bots
     still auto-return. New `status: "tribute"` + `pending` on the Snapshot; `setupTribute` splits
     payment from return.
- **Eval harness DONE (2026-06-23):** the gate for all bot-strength work now exists.
  - `packages/bots/src/eval.ts` — `evaluateHeadToHead(a, b, opts)`: plays a bot lineup vs another
    over N seeded matches, **mirrored by default** (same deals, swapped seats) to cancel deal luck,
    and reports A's win rate with a **95% Wilson CI**. `wilsonInterval`, `formatReport` alongside.
    Tested (7 new tests): deterministic, mirror doubles games, counts consistent, heuristic≫random.
  - `tools/` (new workspace package) — `tools/eval.ts` CLI, run via **`pnpm eval [a] [b] [N]`**
    (uses `tsx`). New bots register in its REGISTRY.
  - **Measured:** heuristic beats random **200/0 = 100% (95% CI 98.1–100%)**, ~150 games/s. Mirror
    sanity: heuristic vs heuristic = **exactly 50.0%** (CI straddles 50% → "inconclusive"), so the
    harness has no positional bias. "Every new bot must beat the last to ship" is now routine.
- **Totals now: 92 tests green** (78 engine + 14 bots), 4 packages typecheck, web builds.
- **Prior-art research documented (2026-06-23) — new `docs/06-prior-art/` section.** Read and
  wrote up the three known Guandan bots so future bot work has the full picture:
  - `danzero.md` / `danzero-plus.md` — the two academic RL papers (arXiv 2210.17087, 2312.02561):
    Deep Monte-Carlo self-play; DanZero+ adds a PPO layer over DMC's top-k actions. Full
    state/action encoding (54-dim {0,1,2} card vectors, ~513-d state, per-action Q-scoring),
    training (160 CPUs × 30 days), and results captured.
  - `reference-implementation.md` — the public DanZero+ code (porting notes; their rules engine is
    a **closed binary**, so we build ours regardless — aligns with the crown-jewel mandate).
  - `guandan-cards-bot.md` — the friend's guandan.cards "Strategist": a hand-engineered
    interpretable heuristic (NOT RL) + a tiny MLP calibrator; claims 100–0 vs the public DanZero
    checkpoints (self-reported, unreproducible, likely overfit to a weak baseline — blunt critique).
  - `our-edge.md` — the synthesis: all three are **reactive (no real search)**, the academic ones
    **opponent-blind**, none **learns tribute**. Our opening = **decision-time search over sampled
    hidden hands (PIMC/ISMCTS) + belief tracking + the free tribute-as-deduction signal** — exactly
    what our pure/fast/deterministic engine enables. We beat them on **method, not compute**.
  - Strategic "which path do WE take" is **deferred** (human: "document now, decide later").

## Measurement infrastructure (built 2026-06-26 — the campaign's instruments)
- **`pnpm eval [a] [b] [N]`** now runs in parallel across CPU cores (child-process workers via
  `node --import tsx`), pooling counts into the exact single-thread numbers. ~4–5× faster on strong
  bots. Flags: `--jobs=N`, `--no-parallel`, `--seed`, `--no-mirror`. Core: `poolResults` +
  `runParallelEval` (`tools/parallel.ts`, `tools/eval-worker.ts`).
- **`pnpm ladder [matches] [bots…]`** — round-robin → one Bradley-Terry Elo per bot on a shared
  scale (`fitBradleyTerry`/`formatLadder` in `packages/bots/src/rating.ts`). Caches per-pair results
  to `tools/ladder.json` keyed by config, so adding a bot only plays its new pairings. First run
  (12 matches/pair): pimc-static 1819, heuristic 1645, random 1036.
- **Bot registry** is now `tools/registry.ts` (shared by eval, workers, ladder). Add new bots there.
  Now includes `ismcts*` (bot v2.2) and the belief-sampled `pimc-belief` / `ismcts-belief` (see below).

## Environment notes (Windows)
- Dev machine is Windows 11, PowerShell. Set `Set-ExecutionPolicy -Scope CurrentUser
  RemoteSigned` so npm/pnpm scripts run. node lives at `C:\Program Files\nodejs`, global
  npm bin at `%APPDATA%\npm`. See `gotchas.md` for PATH/esbuild notes.
- Run the app from `C:\Users\Jeffrey Sun\guandan` with `pnpm dev`.

## Next actions (concrete) — all under the bot-strength campaign
The product tracks (deploy, wire-the-bot-in, UI polish, phone test) are **deliberately deferred** by
the human: final product only, at the end. The champion is now `ismcts-rollout`.

**Infra first (human-directed 2026-06-26, ADR-0009):**
- **Git (task #8) — BLOCKED on the human** installing git (`winget install --id Git.Git -e`; the auto-
  install 403'd here). Then `git init` + commit + push. `.gitignore` already prepped.
- **Cloud eval compute (task #9)** — heavy evals strain the dev machine; move them to a many-core
  cloud box. `tools/remote/setup.sh` + `README.md` make it turnkey once the repo is on a git host.
  Stopgap: `pnpm eval … --jobs=6`.

Campaign next steps (after infra), in rough order:
1. **Engine throughput (task #4) — now the highest-value in-repo lever.** The champion is seconds/move
   because it does ~150 full heuristic rollouts/decision, and `legalMoves` (21.5µs, the hot path per
   `pnpm bench`) dominates a rollout. A rank-count/bitset re-encoding speeds EVERY rollout → either a
   faster champion or more iterations/depth at the same budget. Keep the engine pure; gate on the 88
   engine tests + a `pnpm bench` delta.
2. **Learned leaf/value net (task #10; reopens training, ADR-0007/0008/0009).** The rollout leaf
   is what makes the champion strong AND slow. A learned value net that approximates the rollout's
   judgement in ~µs would give strength AND interactive speed — the natural ceiling-breaker now that
   pure search + a heuristic leaf is proven. The DanZero encoding (`06-prior-art/danzero.md`) is a
   ready feature set. This is a real compute/infra decision — its own ADR.
3. **History-threading architecture (future, own ADR)** — unlock belief's BIGGER signals (cross-trick
   passing, **tribute-as-deduction**, GS2 diversity sampler) by giving bots the public play history,
   which the pure-Observation design withholds. Decide where it lives (richer Observation vs
   match-layer/belief tracker). Belief already helps the champion's rollouts; more belief = more edge.
4. **External benchmark bridge (task #3) — the honest yardstick.** OpenGuanDan referee + DanZero
   opponent (plan in task #3 / changelog). FIRST clone OpenGuanDan and check it ships weights, not
   just the engine. Without an off-our-baseline opponent we can't know we're actually strong (the
   guandan.cards overfit trap). Needs the human's machine (Java + downloads).
- **Tuning the champion (cheap, optional):** sweep `ismcts-rollout` iterations / `maxCandidates` /
  belief λ on the ladder; try a shallow-rollout+static-eval leaf (GS2 pattern) for a speed/strength
  trade. Gate vs the current champion.
- **v1 polish (optional, parallel):** lead choice / bomb timing / endgame — cheap, and improves PIMC
  since v1 is its rollout policy.

## Blockers
- None. Rules are frozen; the engine path is unblocked. Campaign foundations (eval+ladder) are in.

## Open follow-ups (non-blocking)
- ✅ **DONE (2026-06-25):** the search-based prior art is now written up — `06-prior-art/gs2.md`
  (GS2, NeurIPS 2023) and `06-prior-art/pimc-uct-2020.md` (the 2020 PIMC+UCT system). Net guidance
  for v2 baked into `our-edge.md`: naive PIMC is only "marginally better than random," so build
  **ISMCTS + belief-conditioned sampling + a leaf evaluator**, and steal **GS2's diversity hand
  sampler.** _(Note: "PerfectDan" was an LLM hallucination — does not exist; corrected 2026-06-25.)_
- **Remaining prior-art reading (optional, lower priority):** SDMC (soft action sampling vs
  exploitation), GuanZero (teammate-cooperation encoding), the OpenGuanDan benchmark — see
  `06-prior-art/landscape.md`. Only the ⚠️-flagged items there still lack full text.
- Verify a few fine points against **guandan.cards** when convenient: tube/plate Ace-low
  legality, and exact wild behavior in bombs/straight-flushes. Pagat is canonical by default.
- `legalMoves` wild enumeration could be a hot-path perf concern for bots — revisit encoding
  (counts/bitsets) once we can benchmark a full game (see `03-engine/design.md` open questions).

## Quick orientation for a new agent
Read `CLAUDE.md` → this file → the doc for whatever you're touching. Update this file and
`changelog.md` before you finish.
