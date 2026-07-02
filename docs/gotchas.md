# Gotchas

Surprises, footguns, and hard-won lessons. Append liberally — a 30-second note here saves a
future agent (or the human) an hour. Newest at top. Include the date.

---
## 2026-07-02 — Claude cloud sessions CANNOT SSH anywhere; the GitHub Actions box-sync bridge is the way
- Phone/web Claude Code sessions run in a sandbox whose ONLY egress is HTTP/HTTPS through a
  TLS-re-terminating proxy: raw TCP (SSH port 22) is silently dropped, and CONNECT to the box's IP
  gets 403 even on 443. **No environment network-policy setting fixes this** — it's the platform
  design (docs: code.claude.com/docs/en/claude-code-on-the-web, "Security proxy"). Pasting the box's
  private key into a cloud session is therefore useless for direct SSH (and never commit keys).
- **The bridge that works:** GitHub Actions runners CAN ssh. `.github/workflows/box-sync.yml` +
  the `BOX_SSH_KEY` repo secret pull box logs into `box-results/` on a 6 h schedule, and any session
  can force a fresh sync via `workflow_dispatch` (GitHub MCP `actions_run_trigger`) then `git pull`.
  Round-trip is ~30 s. Secrets are fine on a public repo (encrypted, masked, absent in fork PRs).
- **`scp` on the ubuntu-latest runner failed SILENTLY while `ssh` worked** (first three syncs
  committed only the status file; stderr was `2>/dev/null`'d so there was nothing to debug with).
  Fixed by pulling files with `ssh $BOX "cat ~/file"` instead — no SFTP dependency — and recording
  per-file success/failure IN the committed status file. Lesson: in unattended best-effort pipelines,
  never discard stderr; commit it — it's the only debugger you'll have.
- Corollary of the 2026-07-01 "queue logs LIE" gotcha: the sync also captures `tmux capture-pane`
  tails per session, because the tee'd log lags the real experiment state (node buffers to pipes).

## 2026-07-01 — Value-scale contracts at evaluator seams: assert them, don't assume them
- The ISMCTS leaf seam silently assumed values in [-3,3] (`(v+3)/6` normalisation) while the default
  static leaf returned ±15–60. TWO failure modes, both invisible: UCB exploration drowned (the
  reward range was ~10× the explore term) and non-terminal "good positions" outscored ACTUAL WINS
  (+3 → q=1 vs static +40 → q≈7). It survived 5 days and contaminated every static-leaf ISMCTS
  experiment because nothing crashes — the search just quietly mis-prioritises.
- **Lessons:** (1) any pluggable evaluator seam needs its scale in the type's docstring AND a
  contract test (`static-eval.test.ts` asserts leaf ∈ [-3,3] over sampled states — the learned leaf
  gets the same guard for free); (2) when a search behaves "surprisingly weak but correct-looking",
  check value scales FIRST — a diagnostic that only checks move legality/plausibility (like the
  2026-06-26 one) cannot catch it. (3) The bug fix measured +0.125 pts/deal (z=2.28, n=600) — real,
  but the "ISMCTS-static < PIMC-static" method result SURVIVED the fix (retested z=−6.2), so bugs
  and method effects coexist: quantify each, don't let one explain away the other.

## 2026-07-01 — Match-level A/Bs at n≤100 cannot see the effects that matter (use `pnpm evald`)
- A match is ~6 deals of divergence compressed to ONE bit. At n=48–96 games the 95% CI is ±10–14pp —
  and mature-engine improvements come in 1–3% steps that STACK. Three such "neutrals" in a row got
  read as "hand-coded ceiling reached" (2026-06-30) when the honest statement was "each effect is
  below instrument resolution". The paired-deal harness (ADR-0013) resolves what the match harness
  never could: the SAME deal with seats swapped under common random numbers makes deal luck cancel
  exactly — identical bots give d ≡ 0 with ZERO variance, and the known pimc-static gap that took
  ~25 min to establish at match level shows z=4.37 in 7 seconds.
- **Rule of thumb going forward:** treat any |z| < 3 sequential result as "keep running", never as
  "no effect"; and before declaring a strategic pivot on null results, compute what effect size the
  instrument could actually have seen.

## 2026-07-01 — Detached Windows queue logs LIE: pnpm buffers stdout to pipes (results lost on kill)
- The local `ab-queue.ps1` piped `powershell -Command "pnpm evald …" 2>&1 | ForEach-Object
  { Add-Content … }`. Node/pnpm buffer stdout when it's a pipe (not a TTY), so the log showed
  batch-1 of experiment 1 while the queue was ACTUALLY on experiment 4 — and killing the queue at
  shutdown lost experiments 1–3's results entirely (buffered, never flushed). The Linux box's
  `cmd | tee log` behaves better but the same buffering caveat applies to anything that pipes node.
- **Rules:** (1) don't trust a detached queue's log tail as "current state" — check the PROCESS list
  (worker command lines name the experiment); (2) have each experiment write its OWN result artifact
  (the `--auto` runner prints per-batch lines — those flush on process exit, so per-experiment
  wrappers that exit frequently are safer than one long pipe); (3) before killing a queue, grab
  results off the still-alive processes' logs or accept the loss consciously.

## 2026-07-01 — Long eval + live code edits don't mix (tsx workers load the CURRENT tree)
- The `--auto` sequential eval spawns FRESH worker processes per batch, and `tsx` compiles whatever
  is on disk at spawn time. Editing bot code while a multi-batch eval runs means later batches run
  DIFFERENT code than earlier ones — pooled numbers quietly mix two behaviours. Had to kill/restart
  a run for exactly this. **Rule: don't edit `packages/` while `tools/ab-queue.ps1` (or any
  long eval) is running**; queue experiments first, then code, or run evals from a git worktree.
- Also Windows-specific: `Add-Content` via a single long pipe holds an exclusive handle — the log is
  unreadable until the process ends. Append per line (`| ForEach-Object { Add-Content … }`) so a
  detached queue's log stays live-readable.

---
## 2026-06-28 — Rollout cost is REDUNDANT WORK, not allocation (measured — overturns the CLAUDE.md "no allocations" premise)
- Prototyped an allocation-free, fully in-place rollout core (`tools/fast-rollout-bench.ts`, kept for
  reference) to test the long-assumed hypothesis that per-ply `cloneState` allocation is what makes
  rollouts slow. **It is NOT.** Correctness gate passed (in-place core gives byte-identical finish
  order + dealValue as the pure rollout over 5,000 random deals — exact, since `heuristicBot` is
  deterministic and never reads the rng), then throughput, 30k full heuristic rollouts each:
  - Pure rollout (current shape): ~1,830 deals/s
  - In-place (no clones, mutate hands/trick in place): ~2,540 deals/s → **only ~1.37×**
- **Where the 1.37× actually comes from (decomposed with intermediate variants):**
  - dropping `validatePlay`/`classify()` re-validation in `applyMove` (rollout moves come straight
    from `legalMoves`, already legal by construction): **~55–60%** of the gain.
  - dropping the O(108) `outOfPlay` array `observe` builds every ply (the heuristic never reads it):
    **~30–40%**.
  - true in-place mutation / skipping `cloneState`: **~0%** (noise). V8's generational GC handles
    short-lived per-ply clones essentially for free (`cloneState` ≈ 0.06 µs/call in `pnpm bench`).
- **Lessons for future agents:**
  1. The "no allocations in hot paths" guidance in `CLAUDE.md` is **misleading for this engine** —
     the real rollout cost is REDUNDANT COMPUTATION (re-validation + building views the caller
     ignores), not GC. Measure before optimizing for allocation.
  2. The two wins (a "trusted apply" that skips re-validation; an `observe`/state-step that skips the
     unused `outOfPlay`) can be **additive PURE fast-paths** — still return fresh immutable state, so
     the crown-jewel purity is preserved. **Do NOT build a second mutable in-place engine path**: it
     buys ~0% and is the easiest place to introduce an aliasing/determinism bug next to the pure code.
     **DONE 2026-06-28:** both shipped as `applyMoveTrusted` + `observe(…, { includeOutOfPlay: false })`,
     wired into the PIMC/ISMCTS rollout leaves → 1.29× verified (`tools/bench-rollout.ts`), 136 tests
     green. See changelog 2026-06-28.
  3. The untouched dominant cost is `legalMoves`/`enumerateCombos` (~16 µs fresh hand, the heaviest
     allocator via `analyze`'s Maps). A **rollout-specific cheap move generator** (the rollout policy
     only needs the cheapest few moves, not the full enumerated `Move[]`) is the bigger prize — and
     the learned leaf attacks the same cost from the other side (shorter / no rollouts).

---
## 2026-06-26 — Belief sampling only helps a leaf that SIMULATES opponents (not a shape-only one)
- Added within-trick belief-conditioned determinization (`belief.ts`) and measured it. It **helped
  ISMCTS** (`ismcts-belief` vs `ismcts-fast` ≈ 56%, n=80) but did **nothing for the static-leaf PIMC
  champion** (`pimc-belief` vs `pimc-static` = 45.8%, tied).
- **Why — the reusable lesson:** belief sampling changes WHICH cards opponents hold at FIXED counts.
  `staticDealValue` only reads hand SHAPE (distinct ranks / plays-to-empty / bomb count), which is
  almost invariant to that reshuffle → the belief signal is wasted on it. The signal only pays off
  for an evaluator that actually simulates opponents acting on those specific cards (ISMCTS in-tree
  moves; a rollout leaf). **Corollary:** don't pair a more-informative SAMPLER with a leaf too crude
  to use the information — fix the leaf first. Both ISMCTS and belief turned out bottlenecked by the
  static leaf (→ task #7, leaf quality).
- Also: belief's *strong* signals (cross-trick passing history, tribute-as-deduction) need the public
  play HISTORY, which the pure Observation withholds by design — that's a future architecture decision
  (history threading), not a quick win. Only the within-current-trick signal is free from a snapshot.

---
## 2026-06-26 — ISMCTS did NOT beat strong-leaf PIMC (don't assume "more search = stronger")
- Implemented SO-ISMCTS (bot v2.2) expecting it to beat `pimcStaticBot`; it measured **~44% vs the
  heuristic** vs PIMC's ~73% — i.e. roughly heuristic-level, clearly NOT the champion. The search is
  correct (a single-position diagnostic shows it picks sensible non-trivial combos, budget changes
  some decisions, and it agrees with PIMC on leads), so this is a genuine method result, not a bug.
- **Lesson:** ISMCTS's strategy-fusion fix does NOT automatically beat depth-1 PIMC averaging when
  the leaf is a CRUDE static eval and determinizations are belief-free uniform. The tree's opponent
  nodes minimise the crude leaf over random worlds → bias/noise that simple averaging avoids. The
  prior art said this all along: you need **ISMCTS + belief-conditioned sampling + a good leaf
  together** (`06-prior-art/our-edge.md`, `pimc-uct-2020.md`). Build belief sampling (task #6) before
  expecting ISMCTS to pay off.
- **Tuning notes for whoever revisits:** deterministic cheapest-first expansion + lower exploration
  (c=1.0) measured WORSE (22%) than random expansion + c=1.4 (44%) — greedy expansion over-commits
  the tree spine to bad lines. Decisions are largely stable past a few hundred iterations, so raising
  the iteration count alone won't close the gap. The untested high-value lever is the **heuristic
  rollout leaf** (slow) instead of the static leaf.

---
## 2026-06-26 — Possible rules discrepancy: bomb size may cap at 8, not 10 (UNRESOLVED)
- External-benchmark research claims that with **two decks**, an n-of-a-kind bomb tops out at **8**
  (4 suits × 2 decks = 8 physical copies of a rank), so 9- and 10-card bombs **cannot physically
  exist.** Our frozen `01-rules/rules.md` says "Bomb sizes range from 4 up to 10 cards" (marked
  human + Pagat confirmed, 2026-06-22). **Flagged to the human, NOT changed** — rules are frozen and
  this contradicts a recorded human confirmation; could be a variant or a transcription slip.
- **Practically harmless either way:** you can never assemble 9–10 identical cards from 8 copies, so
  the 9/10 slots in the bomb-ordering table are just unreachable — no live bug. Worth confirming
  before any cross-engine benchmark (rule-variant alignment) or if we ever change the deck count.

---
## 2026-06-26 — Parallel eval: spawn workers with `node --import tsx`, not a `tsx` shim
- The parallel eval runner (`tools/parallel.ts`) fans out across CPUs with child processes. Spawn
  them as **`spawn(process.execPath, ["--import", "tsx", workerPath, …])`** — i.e. the Node binary
  with the tsx ESM loader — NOT by trying to exec a `tsx` command (no reliance on a PATH shim, works
  on Windows). Workers can't receive bot *functions* across the process boundary, so they rebuild
  bots by NAME from the shared `tools/registry.ts`. Each worker prints its H2HResult as one JSON line;
  the parent reads the last non-empty stdout line. Counts are additive over disjoint seed ranges, so
  pooling reproduces the exact single-thread numbers (`poolResults` + its test).
- `noUncheckedIndexedAccess` is ON for the repo and **also flags TypedArray element access** (not
  just plain arrays) — `new Float64Array(n)[i]` is still `number | undefined`. Use `arr[i]!` for
  in-range loop indices, or accumulate into a local instead of `arr[i] += x`. Hit this writing
  `rating.ts` (Bradley-Terry loops).

---
## 2026-06-25 — Comparing bots: control for compute (K), compare head-to-head
- When comparing two bot *variants*, don't infer relative strength from their win rates against a
  common third opponent if the variants ran at different compute budgets. We saw `pimc-static`
  (K=100) beat the heuristic 72.5% while `pimc-fast` (rollout, K=6) beat it 66.7%, which *looked*
  like "static leaf > rollout leaf." But head-to-head (`pimc-static` vs `pimc-fast`) was 52.5%
  (n=40, inconclusive) — they're ~equal; the 72.5-vs-66.7 gap was mostly the **K=100 vs K=6**
  difference, not the leaf type. **Lesson:** to compare two design choices, hold compute fixed and
  run them head-to-head; a vs-common-opponent number conflates the choice with the budget.
- Also: `pnpm eval` is single-threaded and slow for rollout bots (~9 s/game). One background
  command caps at ~10 min, so a rollout-bot eval maxes at ~30 mirrored matches per run — pool
  multiple runs with different `--seed` ranges to reach significance (Wilson CI on the pooled n).

---
## 2026-06-23 — UI hand selection: by STABLE KEY (supersedes the position note below)
- **Selection is now by a stable per-card key, not sorted-position.** The QoL grouping feature
  needed group membership to survive re-sorts and other copies being played, which position-based
  selection can't do (positions shift). Each physical card in the human's hand is a
  `Slot = { key, card }` with a key assigned once (`makeSlots`); selection/groups are sets of keys.
  This also still solves the duplicate-card problem (two 5♣ get distinct keys). See
  `useGuandanGame.ts` (`slots`/`groups`/`selected`) and `Hand.tsx`. ADR-0006.
- **Wild/type ambiguity is now a chooser, not a silent default.** `legalInterps` enumerates the
  distinct legal readings of the selection; `Controls` shows a "Play as:" row when ≥2 exist
  (defaulting to weakest). `chooseMove` still exists but is no longer the play path. So a straight
  flush led from hand can now be played as a bomb OR a straight — the human picks.

## 2026-06-23 — UI: select cards by POSITION, not card id (SUPERSEDED — see key-based note above)
- The double deck means two physical cards share the same id (e.g. both 5♣ = id 12). A hand UI
  that tracks selection by card id can't select both copies (a pair of identical cards), because
  `selected.includes(id)` is already true after the first. Track selection by **index into the
  sorted hand** instead, then map indices → ids when building the Move. See `Hand.tsx` /
  `useGuandanGame.ts`. _(Replaced by stable-key selection on 2026-06-23 for grouping.)_

## 2026-06-22 — `const enum` is unsafe in this engine (actually hit)
- **Don't use `const enum` in `packages/engine`** (or anywhere Vitest/Vite/esbuild compiles).
  esbuild transpiles each file in isolation and does **not** inline const-enum members across
  module boundaries, so an imported `Suit.Hearts` becomes `undefined` at runtime — silently
  wrong, not a compile error. Use a **regular `enum`** (emits a real runtime object) or a plain
  `const` object. We hit this with the `Suit` enum in `cards.ts`.
- General rule for the engine: prefer plain unions/consts over TS features that rely on
  type-directed emit (`const enum`, namespaces with values). They interact badly with the
  isolated-module transpilers the toolchain uses.

## 2026-06-22 — Wild-card combo enumeration can explode (watch this)
- `combos.classify` returns **all** legal interpretations of a card set. With two wilds, some
  sets (e.g. two wilds alone) legitimately map to many (type, rank) pairs. That's correct, but
  when `legalMoves` starts calling `classify` over many candidate subsets of a 27-card hand,
  this is the likely performance hot spot. If bots get slow, this is the first place to look
  (consider rank-count/bitset encodings and a non-brute-force wild solver). Noted in
  `03-engine/design.md` open questions.

---
## 2026-06-22 — Seeded so far (anticipated, not yet hit)
These are known traps to avoid, written up front:
- **Don't put rules logic in React/UI or the server.** It must live in `packages/engine`, or
  the bot-simulation goal becomes impossible. (See ADR-0002.)
- **No `Math.random()` / `Date.now()` in the engine.** Inject a seeded RNG. Hidden randomness
  breaks determinism, reproducible bugs, and self-play training.
- **Guandan has many regional variants.** Bomb ordering, combo lengths, and tribute rules
  differ. Confirm against one source of truth (likely guandan.cards) — see
  `01-rules/open-questions.md`. Don't trust a generic web description blindly.
- **Wild cards (Heart level card) are subtle.** A wild can stand for many ranks/suits;
  enumerating combos with wilds is where combo-detection bugs will hide. Test heavily.
- **Windows dev environment.** Paths, shells (PowerShell), and line endings differ from
  Linux. Watch for CRLF and path-separator issues in tooling configs.

## 2026-06-22 — Windows toolchain setup (actually hit)
- **PowerShell blocks npm/pnpm scripts by default.** Fresh Windows has execution policy
  "Restricted", so `npm`/`pnpm` (which are `.ps1` scripts) fail with "running scripts is
  disabled". Fix once: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.
- **A freshly-installed tool isn't on an already-open terminal's PATH.** After installing
  Node/pnpm, existing terminals don't see them until restarted. For non-interactive automation,
  prepend `C:\Program Files\nodejs` and `%APPDATA%\npm` to `$env:Path` for the command.
- **pnpm blocks dependency build scripts by default** (`ERR_PNPM_IGNORED_BUILDS`). Vite needs
  **esbuild**, whose postinstall fetches its binary. Approve it in `pnpm-workspace.yaml`
  (`onlyBuiltDependencies: [esbuild]`; this environment also uses an `allowBuilds:` hook key
  that must be set to `true`). Re-run `pnpm install` after.
- The working app lives at `C:\Users\Jeffrey Sun\guandan`. `pnpm dev` runs the web app.

_(Add real gotchas below as you hit them.)_
