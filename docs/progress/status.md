# Current Status

**Single source of truth for "where are we right now." Update this every session.**

_Last updated: 2026-07-10: task 9 gate FAILED (z=−3.66) — diagnosis queue running on the box (mechanism vs signal); do NOT delete the box until it's read_

## ▶ RUNNING NOW — task 9 DIAGNOSIS (`tmux plbdiag`, log `~/plb-diag.log`, launched 2026-07-10 ~16 UTC)
**The task 9 gate FAILED (read 2026-07-10 morning, `box-results/plb-gate.log`):**
- **HEADLINE: `ismcts-rollout-plb` vs `-big`: −0.1325 pts/deal, z=−3.66 @1400 (sequential stop).**
  The policy-likelihood belief AS-BUILT makes the champion decisively worse.
- Secondary (`-plb-trib` vs `-plb`): +0.012, z=0.35 @1200 — pins add nothing on top (consistent
  with the old trib-lane pooled ≈ null).
**Why not park immediately:** the challenger bundled TWO changes — the likelihood SIGNAL and a
MECHANISM switch (~600 fresh worlds/decision → one reused 64-world pool, ESS p50 ≈ 17). Either
could carry the −0.13. `tools/remote/run-plb-diag.sh` separates them (all vs `-big`, ≤1200 deals
each, |z|≥3 sequential, ~2.5 h each):
1. **`plb-u`** (seeds 48001+) — same pool, likelihood OFF (power=0 → uniform weights). Reads the
   pool-mechanism cost alone.
2. **`plb-r`** (seeds 49001+) — likelihood ON, pool rebuilt every 150 draws (diversity back).
3. **`plb-soft`** (seeds 50001+) — flattened posterior (power .5, mix .25, window 24; ESS p50
   48/64 vs 17/64 at defaults).
**Decision tree:** plb-u ≈ −0.13 ⇒ the POOL is the harm → plb-r is the key read (adopt refresh if
it recovers). plb-u ≈ 0 ⇒ the SIGNAL is the harm → plb-soft is the key read; if it's also negative
⇒ PARK policy-likelihood belief under the current net (ADR-0016), revisit with a round-2 net.
**Do NOT delete the box while this runs.** After it's read, the box is delete-safe again.
**Build state (2026-07-09):** task 9 is fully built + tested (`packages/bots/src/policy-belief.ts`,
ADR-0016): exact past-decision reconstruction via `recordMove` seq/trick stamps, per-seat
factorized likelihood, first-layer delta forward (~20 ms/decision — search speed unchanged),
`ismcts-rollout-plb*` variants registered, 189 tests green, calibration probe `tools/probe-plb.ts`.

## 🏁 NIGHT QUEUE 4 COMPLETE (read 2026-07-09 over SSH) — budget + endgame gates resolved
`tools/remote/run-queue-4.sh` finished (`NIGHTQ_COMPLETE`, ~21:09 UTC 2026-07-09; full log
`box-results/night-queue.log` — final copy scp'd; the overnight box-sync copy was mid-run):
1. **Budget 1800v1200 EXTENDED: DECISIVE — 1800 iters beats 1200.** Sequential stop at 600 deals
   (seeds 44001+): +0.1758 pts/deal, z=3.24. Inverse-variance pool with the 2026-07-03 batch
   (+0.171, z=2.59 @400, seeds 20001+): **+0.174 pts/deal, z≈4.15 over 1000 paired deals.** The
   budget curve genuinely extends past 1200; champion stays `ismcts-rollout-huge` (1800 iters,
   ~2 s/move). **Ship-target call for the human at integration time:** 1800 ≈ 2 s/move vs 1200 ≈
   1 s/move costing −0.17 pts/deal. Nothing to build now — just a latency preference to pick when
   bots get wired into the app.
2. **Exact-endgame leaf EXTENDED: NULL → DROPPED from rollouts.** Ran the full 1600-deal cap
   (seeds 45001+): −0.0047 pts/deal, z=−0.14. Pooled with the prior 400 (+0.073, z=1.32):
   **+0.017 pts/deal, z≈0.58 over 2000 paired deals.** Per the pre-registered adopt-or-drop:
   `endgameSolve` stays OFF in the champion's rollouts. (The solver itself remains built +
   oracle-verified; decision-time/analysis uses are still possible later.)
**Box state: tmux empty, load 0.00, everything collected → was briefly delete-safe, but the same
evening the task-9 gate was launched on it (see RUNNING NOW above) — hold deletion until that's
read.**

## 🏁 GATE 2 CLOSED FOR NOW (2026-07-08) — apprentice-as-rollout = PARITY at ~10× cost → PARKED; task 9 is next
The Gate 2b extension (`round1c`, 1200 deals, seeds 43001+) finished: **+0.0225 pts/deal, z=0.55.**
Pooled with round 1b's 400 deals (+0.065, SE 0.0699): inverse-variance → **+0.033 pts/deal,
z≈0.94 over 1600 paired deals.** Per the pre-registered decision ("flat out to ~1200–1600 deals →
treat Gate 2 as closed under this approach"): the nohist+temperature apprentice rollout is at
PARITY with the heuristic rollout at fixed 600 iters — never proven better — while costing ~10×
wall-clock, i.e. strictly worse on wall-clock-fair terms (the heuristic side could run ~6000 iters
in the same time, and the budget curve says iterations still buy strength). **Apprentice-as-rollout
is PARKED** (like history-conditioning before it: not abandoned — a stronger net from a round-2
dataset could reopen it, and "parity with a learnable policy" still beats "parity hand-coded" in
principle — but no more spend under the current net). Log: `box-results/round1c.log`.
**What survives round 1 intact:** the distillation pipeline WORKS (Gate 1 z=12.98; nohist z=15.25
— the strongest fast bot we have, ~µs/move), the dataset is banked, and the policy net's REAL next
job is **task 9: policy-likelihood belief** — weight/generate determinized worlds by the likelihood
of each seat's OBSERVED plays under the policy net (the partner runs OUR EXACT policy → near-exact
partner inference; GIB/Skat-style, ADR-0011's principled revival). That is a BUILD task for a fresh
session (design + implementation + tests on the dev machine, gates on the box), not an overnight
eval. Prereqs all in place: per-seat play attribution ✅ recorded, policy net ✅, paired harness ✅.

## 🏁 ROUND 1B COMPLETE (read 2026-07-07 evening, via box-sync) — GATE 2 STILL NOT UNBLOCKED, but the negative narrowed hard
Box pipeline finished 2026-07-07 13:25 UTC (`ROUND1B_COMPLETE`, commit 5fa1986, script
`tools/remote/run-round1b.sh`); full log `box-results/round1b.log`, nohist weights in
`box-results/policy-weights-nohist.json` (629 KB, also lands at `tools/data/policy-weights-nohist.json`
on the box).
- **NOHIST training:** best val CE **1.3854 @epoch 18** vs round-1 full net's 1.3860 @epoch 20 —
  the history features carried essentially no CE signal, as the epoch-1 tell predicted; the nohist
  net is not worse.
- **SANITY (`policy-nohist` vs `heuristic`): PASS — +1.1617 pts/deal, z=15.25 @300.** The nohist
  apprentice alone (no search) still crushes v1, even a touch stronger than round 1's full net
  (+0.988, z=12.98). Confirms it's safe to read Gate 2b through this net.
- **GATE 2a (`ismcts-rollout-net-t` vs `-big`, temperature alone, round-1 net): FAIL —
  −0.4250 pts/deal, z=−3.15 @100 (sequential stop).** Sampling instead of argmax in rollouts does
  NOT fix Gate 2 on its own — still a clear, decisive loss, though far smaller than round 1's
  undiagnosed −1.250 pts/deal, z=−8.64.
- **GATE 2b (`ismcts-rollout-net-nh-t` vs `-big`, nohist net + temperature): INCONCLUSIVE —
  +0.0650 pts/deal, z=0.93 @400 (hit the 400-deal `max-deals` cap without resolving, never a
  sequential stop).** Stacking both fixes moves the edge from strongly negative to
  near-neutral/slightly positive — real progress — but doesn't cross |z|≥3 either way.
  - The trend across all three rollout configs is monotone: round-1 net/argmax z=−8.64 →
    net-t (temp only) z=−3.15 → net-nh-t (temp+nohist) z=+0.93. Each fix helps; neither alone nor
    together yet proves parity with the heuristic-rollout champion.
- **Tribute-lane fill (`ismcts-rollout-trib` vs `-nohist`): 3000 new deals (seeds 42001+), edge
  −0.0002 pts/deal, z=−0.01 — flat.** Pooled with the prior ~2000 deals (+0.05 pts/deal, z≈1.9):
  prior SE = edge/z = 0.05/1.9 = 0.0263; new batch SE = 0.0223 (from the log). Inverse-variance
  pooling: weights w₁=1/0.0263²=1445, w₂=1/0.0223²=2011 → pooled edge = (1445×0.05 +
  2011×(−0.0002))/(1445+2011) ≈ **+0.0208 pts/deal**, pooled SE = √(1/3456) ≈ 0.0170, **pooled
  z ≈ 1.22**. (Cross-check via same-variance n-weighting gives +0.0199, z≈1.17 — consistent.)
  **Verdict: still inconclusive, now leaning toward null** — the big new batch pulled the
  suggestive positive from z≈1.9 down to z≈1.2. Would need several thousand more deals to resolve
  either way; not worth prioritizing while Gate 2 is still open.
**Decision-tree read:** per the tree recorded before this run, neither Gate 2a nor 2b reached
≥ z+3, so this lands in the "both null/negative" branch — the apprentice-as-rollout idea is **not**
unblocked yet. BUT Gate 2b's trend (decisively negative → near-zero/slightly positive as both
fixes stack) is a real, useful signal, not a clean kill. **Recommended next step, before the
invasive rewrite:** extend Gate 2b alone with a larger `max-deals` (it hit its 400-deal cap at
z=0.93, it was never a sequential |z|≥3 stop) — if it resolves positive with more data, the loop
unblocks cheaply; if it stays flat/negative out to ~1200–1600 deals, treat Gate 2 as closed under
this approach and move to the two harder suspects already on record: (1) thread simulated history
through rollout observations (invasive), or (2) drop apprentice-as-rollout and use the policy net
for its other role (policy-likelihood belief, task 9 — already justified by Gate 1).
**Box state:** `ROUND1B_COMPLETE` printed, all queues idle, load 0.02. Everything of value is
collected in `box-results/` (`policy-weights-nohist.json`, `round1b.log`). **The box is
DELETE-SAFE now** (same caveat as round 1: re-provisioning is ~10 min via `tools/remote/setup.sh`
if the next session wants it for a Gate 2b extension run instead of spinning up fresh).

## 🏁 ROUND 1 COMPLETE (read 2026-07-06 over SSH) — GATE 1 PASSES, GATE 2 FAILS DECISIVELY
Box pipeline finished 2026-07-07 00:18 UTC (`ROUND1_COMPLETE`); full log in
`box-results/round1.log`, weights collected to `tools/data/policy-weights.json` (627 KB).
- **Training:** 355,717 train / 18,721 val decisions; best val CE **1.3860** @epoch 20 (still
  improving at cutoff), top-1 57.5%. NOTE: uniform-CE baseline is 1.413 — the CE gain over
  uniform is small (−0.027 nats) even though top-1 crushes uniform (~18% at avg k=5.6). The
  visit-fraction targets are near-uniform on many decisions (search spreads visits), so CE is a
  weak-looking metric; top-1 and Gate 1 are the meaningful reads.
- **GATE 1 (sanity, `policy` vs `heuristic`): PASS — +0.988 pts/deal, z=12.98 @300.** The raw
  apprentice (no search at play time) crushes v1. Distillation works end-to-end.
- **GATE 2 (leaf quality, `ismcts-rollout-net` vs `ismcts-rollout-big`, fixed 600 iters):
  FAIL — −1.250 pts/deal, z=−8.64 @100.** Apprentice rollouts make the champion much WORSE than
  heuristic rollouts, and cost ~10× wall-clock (100 paired deals took 4,650 s vs seconds).
**Per the decision tree, this is the "GATE 2 negative" branch — diagnose before round 2:**
1. **Distribution shift / dead history features** — inside simulated rollouts the obs `history`
   is absent, so the played-counts block is all zeros; the net trained on real histories. Test:
   thread simulated history into rollout observations, or retrain with history features dropped,
   and re-gate.
2. **Rollout diversity** — the apprentice plays argmax (or near-argmax); deterministic rollouts
   collapse the leaf-value variance ISMCTS needs. Test: sample from the softmax (temperature) in
   rollouts, re-gate.
3. Only after quality-per-iteration is fixed does the ~10× cost question matter (a
   wall-clock-fair gate would give the heuristic version ~6000 iters).
**Box state:** all queues done, tmux empty, load 0.0. **Everything is collected — the box is
DELETE-SAFE now; the human should delete it in the Hetzner console to stop billing** (unless the
next session wants it for the Gate-2 diagnosis reruns — re-provisioning is ~10 min via
`tools/remote/setup.sh`, so holding it idle is optional).

## ✅ BOX FULLY HARVESTED (2026-07-06, dev machine back) — safe to delete the server
Queue 3 finished 2026-07-04 (QUEUE3_COMPLETE). Collected over real SSH to the dev machine:
- **Expert-iteration dataset: 21,000 champion self-play deals / 1,497,804 decisions with root
  search stats** → `tools/data/search-data/part-{0..6}.jsonl.gz` (~235 MB, gzip -t verified,
  gitignored). Worker logs alongside. This is task 8's training fuel.
- Queue logs + `value-weights.json` were already in `box-results/` via the Actions bridge.
**Nothing of round-1-or-earlier value remains uncollected.** Round 1's gates have since been
read and `policy-weights.json` + `round1.log` collected (see the section above) — the box is
now fully delete-safe.
**Next up (task 8, expert iteration):** obs/action encoder over the dataset → policy net →
use as ROLLOUT policy → re-measure the knee. Also: retrain the value net from this dataset's
outcome lines WITH best-checkpoint saving (train.ts saves the last epoch — the 2026-07-03
collection showed epoch-30 overfit, val RMSE 1.618 vs 1.548 best; fix before any retrain).
And re-decide the ship-target budget: 1200>600 was DECISIVE on the paired harness (+0.248,
z=3.04) and 1800v1200 trends real (+0.171, z=2.59) — the old plateau was partly instrument
artifact, so more per-move budget is again a live strength lever (at latency cost).

## 📊 BOX RESULTS COLLECTED (2026-07-03, via the Actions bridge) — queues 1+2 COMPLETE, queue 3 finishing
All numbers are paired-deal (`evald`) edges in pts/deal; gate = |z|≥3. Full logs: box-exec run
28678915368 job log + `box-results/` once the next scheduled sync lands (gitignore fix 2fb6436).
**Decisive results:**
- **`ismcts-learned` (Stage-1 v3 leaf) FAILS the gate: −0.265, z=−3.91 @400** vs rollout champion.
  Not close to parity. Train detail: val RMSE bottomed ~1.548 @epoch 5, drifted to 1.618 by 30 —
  saved weights are the OVERFIT epoch-30 (no best-checkpoint in train.ts; fix before rerunning, but
  the gap vs z=−3.91 is too big for that alone). Barely beats the LINEAR baseline (1.667).
- **Budget on the paired harness: 1200 > 600 iters DECISIVE (+0.248, z=3.04 @300)**; 1800 vs 1200
  = +0.171, z=2.59 @400 (hit max-deals; single-look significant). ⇒ **the "plateau at 1200–1800 /
  budget lever tapped out" claim (match-level Elo) is at least partly an instrument artifact** —
  gains persist to 1200 for sure and likely 1800. Ship-target latency tradeoff needs re-deciding.
**Trending / null:**
- pass-lane belief: −0.113, z=−2.13 @600 — hurts, consistent with 2026-06-30; stays OFF.
- hist-vs-nohist retest (fixed leaf, static 1200): 0.0000, z=0.00 @400 — clean null.
- tribute-lane: q1 +0.033 (z=0.71, 600) + q3 extended +0.059 (z=1.81, 1400) → pooled ≈ +0.05,
  z≈1.9 over 2000 deals. Suggestive small positive, needs ~5000 total deals to resolve at z=3.
- combo endgame+perType: q2 +0.077 (z=1.31) but q3 extended −0.062 (z=−1.71, 1400) → pooled ≈
  −0.02, z≈−0.7. Neutral; the hoped stacking of the two levers did not materialize.
- perType (rollout) +0.029 z=0.53; perType (static) −0.071 z=−1.29; match-aware @A −0.048 z=−0.81
  (and no-regression at normal levels confirmed, only 16/400 deals diverge); exact-endgame leaf
  +0.073 z=1.32 — all below resolution individually.
**Queue 3 remaining:** expert-iteration dataset gen RUNNING since 15:54 UTC (7 workers × 3000
deals, ~0.039 deals/s/worker → ETA ~2026-07-04 13:00 UTC). Disk 2% used, load 7.1/8 — healthy.
`value-weights.json` (v3, epoch-30) synced into `box-results/`.

## 📱 Mobile/cloud access to the box — VERIFIED WORKING (2026-07-02, phone cloud session)
Direct SSH from Claude cloud sessions is **impossible** (HTTPS-only sandbox egress — see
gotchas 2026-07-02; don't bother pasting the key into a session). The working path is the
**GitHub Actions bridge**: `.github/workflows/box-sync.yml` (secret `BOX_SSH_KEY`, already
configured) pulls the queue logs + live tmux pane tails + `value-weights.json` into
`box-results/` every 6 h, and any session can force a fresh sync on demand:
1. Trigger `box-sync.yml` via `workflow_dispatch` (GitHub MCP `actions_run_trigger`) on the
   branch you're on; ~30 s later a `box-sync: eval box logs` commit lands on that branch.
2. `git pull`, then read `box-results/box-status.txt` (uptime/tmux/file listing + per-file
   pull results), `box-results/ab-queue*.log`, `box-results/pane-abq*.txt`.
**WRITE path — `box-exec.yml`:** dispatch it with a `command` input (same MCP tool) and it
runs the command on the box over SSH; read the output from the job log (`get_job_logs`).
~10 s round-trip. Use it to requeue/kill experiments, `cd ~/guandan && git pull` fixes onto
the box, restart tmux queues. Long jobs MUST be launched detached in tmux (job timeout
15 min) — playbook in `tools/remote/README.md`. Note the box's `~/guandan` checkout is only
updated when something pulls it: the queue-2 waiter does `git pull` before it starts, so
fixes pushed to main before queue 1 completes ride into queues 2–3 automatically.
Verified 03:47 UTC (both paths, human approved the main merge): box up, load ~6.5/8,
queue 1 mid-experiment (tribute A/B at 400/600 deals, z=0.61), queues 2/3 waiting on their
chain triggers as designed; box-exec wrote+read a file and tailed the live log. Large
artifacts (the ~GB queue-3 search-data parts) stay on the box — collect those over real
SSH when the human is back, per the plan below.

## ⚡ Current focus (2026-07-01) — post-audit correction pass: better instrument, real bugs fixed, key conclusions re-tested
A full critical review of docs+code (human: "challenge previous agents' work") found the strategic
picture MOSTLY sound but resting on two bad legs — an underpowered instrument and a real value-scale
bug. This session (all changes tested, 167 tests green):
1. **NEW GATING INSTRUMENT — `pnpm evald` (ADR-0013), paired per-deal eval.** Same deal, seats
   swapped, common random numbers → deal luck cancels exactly; detects in SECONDS what match-level
   eval needed hours for (pimc-static gap: z=4.37 in 7 s). **All gating uses this now.** Sequential
   mode `--auto` stops at |z|≥3. ⇒ **The "3 neutral results → hand-coded ceiling" conclusion is
   DOWNGRADED** — those effects were below the old instrument's resolution (±10–14pp), not proven
   zero. Hand-coded levers are back on the table, each cheap to test now.
2. **Static-leaf ISMCTS value-scale BUG fixed** (`boundedStaticValue`, contract-tested): the leaf fed
   ±15–60 into a normalisation assuming ±3 — UCB drowned + unfinished positions outscored real wins.
   Fix measured **+0.125 pts/deal (z=2.28, n=600)**. Retest: **pimc-static STILL beats fixed
   static-ISMCTS (z=−6.2)** → the "ISMCTS needs belief+rollout leaf" method lesson stands. All
   pre-07-01 static-leaf ISMCTS numbers (incl. the 47.9% hist A/B) carry the contamination.
3. **Objective fixed at level A** (`dealValueCtx` + `Observation.matchCtx`, ADR-0014): declarer 1-4
   was valued "+1" but is a STRIKE; 1-2/1-3 both win the match. Opt-in (`useMatchContext`), gate via
   `pnpm evald … --level=14 --score=match`. (DanZero already did this — danzero.md §2.)
4. **Full public record now captured** (ADR-0014): plays attributed per seat (the #1 blind spot was
   not even recorded before), tribute receiver + return card + resist. Belief lanes separated
   (`usePassHistory`/`useTributeInfo`); constrained dealer does exact-card pinning (tribute→receiver,
   return→giver, resist→big-joker pins/exclusions), pins consumed when seen played.
5. **Candidate-cap bias fix available** (`candidates: "perType"`): the old cheapest-only cap pruned
   ALL bombs + top singles at wide nodes (for us and in-tree opponents). GS2's per-type retention.
6. **Learned-leaf pipeline bug found (not yet fixed): `gen-data.ts` trains ONLY at level 2** — every
   other level (wild moves!) is out-of-distribution. Fix lands with the Stage-1 re-gen (+ encoding
   gaps: trick topPlayer missing, straights invisible, wild-completed bombs uncounted).
7. **⏳ ALL experiments now on the Hetzner box (overnight, 2026-07-01→02). The dev machine is OFF;
   the human is away ~5 days; the box stays up and holds ALL results until collected.**
   - **Queue 1** (`tmux abq`, log `~/ab-queue.log`, seeds 10001+): tribute-lane, pass-lane,
     perType, match-aware @A + no-regression, exact-endgame — champion-config paired evals.
   - **Queue 2** (`tmux abq2`, log `~/ab-queue-2.log`, seeds 20001+, auto-chains when queue 1
     prints QUEUE_COMPLETE, 18 h fallback): hist + perType-static retests (migrated from the dev
     machine), the COMBINED challenger `ismcts-rollout-combo` (endgame+perType), Stage-1 gen-data +
     train ON the box, the `ismcts-learned` parity gate, and budget-curve probes (1200v600,
     1800v1200) on the paired harness.
   - **Queue 3** (`tmux abq3`, log `~/ab-queue-3.log`, seeds 30001+, chains on QUEUE2_COMPLETE,
     48 h fallback): tribute-lane + combo A/Bs extended to high n, then the EXPERT-ITERATION
     dataset — 7 × `gen-search-data.ts` workers ≈ 21k champion self-play deals / ~3M decisions
     with root visit stats → `~/search-data/part-*.jsonl` (~2.5 days). Total queued ≈ 4 days.
   - **FIRST ACTION NEXT SESSION — collect before anything else, then the human deletes the box.**
     From a cloud session: trigger box-sync + `git pull` (see "Mobile/cloud access" above).
     From a machine with real SSH:
     `ssh root@178.156.158.230 "cat ~/ab-queue.log ~/ab-queue-2.log ~/ab-queue-3.log"`,
     `scp root@178.156.158.230:guandan/tools/data/value-weights.json tools/data/`, and the
     search-data parts (large — consider processing/compressing on the box first). Then gate
     decisions per experiment at |z|≥3.
   - Local partials before shutdown (superseded by box reruns): hist batch 1 = −0.095 pts/deal
     (z=−0.66, n=100, seeds 1..100 — POOLABLE with box seeds 20001+); local Stage-1 train reached
     epoch 1 val RMSE 1.571 (net [144,128,64,1]; predict-mean 2.414, linear 1.667).
8. **Endgame exact solver landed** (evening): `solveEndgame` (oracle-verified alpha-beta), and
   `endgameSolve: true` makes every rollout finish EXACTLY at ≤8 cards (~0.25 ms median). A/B on
   the box. **Encoding v3** landed (topPlayer/leader, run structure, wild-aware bombs → 144 feats).
   **Stage-1 retrain in flight** (`tools/train-v3.log`): 600k rows (levels+tribute sampled),
   [144→128→64→1]; linear baseline = val RMSE 1.667 (predict-mean 2.414). Gate = parity-at-speed
   vs the champion on the paired harness.
**Roadmap adjustment (from the review, human-approved "do them all"):** before the Stage-2 RL spend,
run the cheap corrected-baseline levers (leaf/candidates/objective/tribute-pins via evald), then
Stage 1 with the gen-data+encoding fixes (honest gate: PARITY at speed — the budget curve says extra
iterations past the knee add ~nothing, so distillation is a speed win, not a strength win), then
**expert iteration** (distill champion policy → use as ROLLOUT policy → knee moves right → re-distill)
as the bridge to Stage 2, then **policy-likelihood belief** (Skat/GIB-style; the partner runs OUR
EXACT policy → near-exact partner inference — the principled ADR-0011 revival). Endgame exact solver
+ designed pair-conventions as parallel tracks. Details in changelog 2026-07-01.

**The 10-task plan (canonical copy — any session, any machine, work top-down; gate results
2026-07-03 unless noted):**
1. ✅ Paired per-deal eval harness (`pnpm evald`, ADR-0013).
2. ✅ Static-leaf value-scale bug fix (+0.125 z=2.28) + leaf contract test.
3. ✅ Contaminated experiments re-run: ISMCTS-vs-PIMC method result stands (z=−6.2); hist retest
   exact null; pass-lane HURTS (z=−2.13, stays off).
4. ✅ Per-type candidates: built + golden-pinned, but gates NULL individually (rollout +0.029
   z=0.53; static −0.071). Keep available; round-2 data-gen should use it (target-bias fix).
5. ✅ Full public history + exact-card pins. Tribute lane suggestive +0.05 @z≈1.9 over 2000 deals
   — resolving it needs ~5k deals (cheap box job whenever idle).
6. ✅ A-level match-aware objective: built, gated null at pinned-A (−0.048 z=−0.81), no regression
   at normal levels. Available via `useMatchContext`; rarely-triggering by construction.
7. ✅ Stage-1 learned VALUE leaf: FAILED decisively (z=−3.91) after all fixes → ADR-0015 pivot.
8. ◑ EXPERT ITERATION (ADR-0015) — round 1 DONE, apprentice-as-rollout PARKED (2026-07-08):
   Gate 1 PASSED (z=12.98; nohist variant z=15.25 — distillation works, strongest fast bot).
   Gate 2 after both fixes (nohist+temperature) pooled to parity (z≈0.94 @1600 deals) at ~10×
   rollout cost → closed under the current net. Reopen only with a stronger net (round-2 data).
9. ◑ Policy-likelihood belief (ADR-0016) — BUILT + tested 2026-07-09; **gate FAILED 2026-07-10
   (−0.1325, z=−3.66 @1400)**. Diagnosis running: pool-mechanism cost vs likelihood-signal harm
   (see RUNNING NOW). Park only if all three diagnosis arms read negative.
10. ◑ Endgame exact solver ✅ built + oracle-verified; `endgameSolve`-in-rollouts RESOLVED NULL
    2026-07-09 (pooled +0.017, z≈0.58 @2000 deals) → stays OFF in the champion. Designed pair
    conventions still need the human's conventions — ASK HIM.
**Budget re-decision RESOLVED on strength (2026-07-09):** 1200>600 decisive AND 1800>1200 decisive
(pooled +0.174, z≈4.15 @1000 deals) — the budget lever is NOT tapped out at 1200. Champion =
`ismcts-rollout-huge` (1800, ~2 s/move). The only remaining piece is the human's latency
preference at integration time (2 s vs 1 s/move for −0.17 pts/deal).

## Milestone: **M1 complete (playable web app vs 3 heuristic bots). Prior-art documented. Repo now under git + pushed to GitHub (github.com/jeff-sun-13/guandan) and remote eval compute is LIVE (Hetzner box, ADR-0009). CHAMPION = `ismcts-rollout-huge` (1800 iters) by a hair, but the full budget-saturation curve (2026-06-29, overnight on Hetzner) shows **strength PLATEAUS ~1200–1800 iters** — Elo by budget: 150→1193, 300→1473, 600→1662, 1200→1842, 1800→1877; 3600 vs 1800 inconclusive (58%), 7200 vs 3600 no gain. **`1200` iters is the strength/latency SWEET SPOT** (tied with 1800, ~1s/move) → the ship target for live play. This REVISES the earlier "no plateau / compute-elastic" claim (that extrapolated from 150→600). **The search-budget lever is now TAPPED OUT** — next strength must come from history threading (ADR-0011), a better leaf, or the learned route (ADR-0010), NOT more iterations. Lineage: rollout-leaf ISMCTS beat `pimcStaticBot` ~82% (2026-06-26); the v2 thesis (search + belief + good leaf TOGETHER) is validated. Cost: ~0.6–2 s/move (fine for the strength-first campaign + for actual human play). Campaign: "maximize strength, long haul, final product only, do NOT wire into the app" (human, 2026-06-26). Instruments: parallel eval (`pnpm eval`) + Bradley-Terry ladder (`pnpm ladder`). External benchmark scoped (OpenGuanDan + DanZero), still needs the human's machine.**

## ⚠️ Live remote box (2026-06-30) — Hetzner Cloud `178.156.158.230`, 8 vCPU, root ssh, repo at `~/guandan`
Heavy evals run here, headless in tmux (survives ssh/dev-machine crashes). **It bills while alive — delete it in the Hetzner console when idle.** Full ops playbook + gotchas in `tools/remote/README.md`. As of this update, the Path A tribute A/B (`ismcts-rollout-hist` vs `-nohist`, n=24) is running on it.

## Current focus (2026-06-30) — past the budget plateau; the information axis is the open question
Search budget is **solved** (knee ~1200–1800; ship 1200). Started the **information axis** (history threading, ADR-0011, Path A): built it; the engine stays pure, the arena threads a public play/pass/tribute record into `Observation.history`. **Results so far are sobering and reframed the problem:**
- **Cross-trick passing memory: ~no gain** (47.9%, n=96). This is a NARROW slice — it does NOT mean history is useless (an earlier draft wrongly implied that; corrected).
- **The real blind spot (strategy + gap analysis, 2026-06-30):** the bot counts cards at the *set* level (`outOfPlay`) but does **NOT attribute plays to players**, so it has **no per-opponent hand model** — most of what a strong human does. AND the belief-*sampling* mechanism (reweighting 6 uniform worlds) is too weak to represent sharp per-player inference; that's *why* passing scored 0. The one win (tribute ceiling) works because it's **constructive constrained dealing**, not reweighting.
- **Path A RESULT — history conditioning HURTS the champion** (`rollout-hist` 33.3%, n=48, significant).
  Investigated, didn't guess: the "greedy sampler is biased" hypothesis was TESTED & REFUTED; cause
  unknown. **History defaulted OFF to protect the champion. It is PARKED, not abandoned — REQUIRED, MUST
  REVISIT** (ADR-0011 must-revisit notice; human directive 2026-06-30). The info/signalling axis likely
  wants the learned route (ADR-0010).
- **Leaf/endgame tweak (run-out bomb trigger v1): ~neutral** (48.4%, n=64). Third neutral result in a row
  (belief, passing, run-out) → the ISMCTS+rollout champion is **near its incremental hand-coded ceiling.**

## ▶ ACTIVE DIRECTION (committed 2026-06-30) — the LEARNED ROUTE (ADR-0012). *Human will execute later.*
Human committed to the learned route after the 3 neutral results. Staged:
- **Stage 1 — strong learned LEAF (rich encoding).** Cheap, pure-TS, distills the rollout leaf on
  determinized (perfect-info) worlds. Strength/speed win; **does NOT address the info axis** (leaf sees
  all hands). **DONE:** rich encoding v2 (`packages/nn/src/encode.ts`, 86→124 feats: run-out shape, bomb
  structure, control — see strategy-and-gaps.md). **NEXT (the concrete to-do):**
  1. **Re-gen data** with the new encoding: `pnpm gen-data` (self-play → `(features, value)`; old
     `tools/data/*.bin` + `tools/data/value-weights.json` are STALE — the encoding changed, regenerate).
  2. **Retrain a BIGGER net** (Phase-1 net was deliberately tiny → underfit the richer input): `pnpm train`
     — bump layer widths in the MLP config. Weights land at `tools/data/value-weights.json`.
  3. **Eval** `ismcts-learned` vs the rollout champion on the ladder (registry auto-registers it when
     weights exist). Gate: match/beat at µs leaf cost (→ afford more iterations → the budget curve says
     that's stronger). Parity + no-regression per learned-leaf-design.md §6.
  - Pipeline is pure-TS → runs LOCALLY (small first, to confirm the rich encoding helps) or on a
    re-provisioned box for scale. **Box is DOWN** — re-provision via `tools/remote/setup.sh` (~10 min).
- **Stage 2 — self-play RL POLICY conditioning on the Observation+history.** The info/signalling ceiling
  and the home for the parked history work (ADR-0011). EXPENSIVE; **own go/no-go after Stage 1.**
- **Human steer (2026-06-30):** maximize self-play strength; external benchmark **deprioritized** (human
  play-tests for "drastic mistakes"); a playable-speed champion in the web app is a possible play-test aid.

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
1. ✅ **Engine throughput (task #4) — DONE (2026-06-26):** `legalMoves` type-routing + bomb
   short-circuit, output-identical, **~2.6× full-playout** (635→1635 deals/s). Cuts eval cost + CPU
   load directly. Optional further lever: typed-array `analyze` (constant-factor).
2. ◑ **Learned leaf (task #10) — Phase 1 BUILT & EXPLORED (2026-06-27), inconclusive.** Full pipeline
   in pure TS works (`@guandan/nn`, `pnpm gen-data`/`train`, `ismcts-learned`), but a simple net is
   only ~`pimc-static` strength & finicky (not champion-class). Bottleneck = encoding richness +
   capacity. **Phase 2** (richer encoding + bigger net + self-play RL) is the expensive ceiling
   pursuit — DEFERRED pending a human go/no-go (ADR-0010). **Reframe:** the rollout champion's
   seconds/move is fine for actual human play, so this isn't a blocker for the play goal.
3. **History-threading / public-information layer (ADR-0011, REQUIRED but deferred — human steer
   2026-06-28).** The pure snapshot `Observation` withholds the public play history + tribute, which
   is now identified as a **hard ceiling on strength**, not an acceptable simplification. Enables (in
   increasing difficulty): **tribute-as-deduction** + **cross-trick counting** (both tractable inference,
   extend `belief.ts`), then **signalling** (partnership conventions — "the entirety of high-end
   Guandan"; a deeper research track since determinized search under-values information-conveying plays).
   A belief/history tracker ABOVE the pure engine (keep `GameState` snapshot-only for cheap cloning).
   See ADR-0011 + `00-overview/strategy-decisions.md` Decision 4.
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
