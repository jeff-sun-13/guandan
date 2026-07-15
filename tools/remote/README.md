# Remote eval compute

Heavy strength evals pin every core and the current champion is seconds/move, so a real campaign
should run them on a **cloud CPU box**, not the dev machine (ADR-0009). The harness is headless
Node + tsx — it runs anywhere.

## ⚠️ Current live box (EPHEMERAL — verify/update/delete this block when the box changes)
- **NO LIVE BOX — deleted by the human 2026-07-14** (after the task-9 diagnosis was captured;
  everything of value is in `box-results/` + `tools/data/`). For the next heavy run, provision a
  fresh server per "Workflow" below, then rewrite this block with the new IP. A fresh box needs:
  the dev machine's SSH pubkey in `authorized_keys`, stale `known_hosts` entries cleared (new host
  key), and — if the IP changed — the `box-sync.yml`/`box-exec.yml` workflows updated (they
  hardcode the host) so the Actions bridge keeps working.
- The `178.156.158.230` in the examples below is the DEAD box's IP — substitute the new one.
- **Previous host:** `178.156.158.230` — Hetzner Cloud, login `root`, **RE-PROVISIONED 2026-07-01** (the
  2026-06-28 box at the same IP was deleted; host key changed — clear stale `known_hosts` entries).
- **SSH key:** the dev machine's `~/.ssh/id_ed25519.pub` must be in the box's
  `/root/.ssh/authorized_keys` (a fresh box does NOT have it — add via the Hetzner web console).
- **Bootstrap a fresh box in one command** (installs everything, then launches the experiment queue
  detached — see `run-queue.sh`):
  ```bash
  ssh root@178.156.158.230 'apt-get update -qq && apt-get install -y -qq git tmux && \
    { [ -d ~/guandan ] || git clone https://github.com/jeff-sun-13/guandan ~/guandan; } && \
    cd ~/guandan && git pull && bash tools/remote/setup.sh && \
    tmux new-session -d -s abq "bash tools/remote/run-queue.sh 2>&1 | tee ~/ab-queue.log"'
  ```
- **Billing:** it bills while it exists. When the campaign is idle, **delete the server in the Hetzner
  console** (or `hcloud server delete`) — stopping isn't enough to fully stop charges on some plans.
- If this IP is dead, the box was deleted/recreated — provision a new one per "Workflow" below and
  update this block (and `docs/progress/status.md`).

## Ops playbook — drive a headless eval from an agent (no interactive shell)
Run long jobs in **tmux** so they survive ssh drops / a dev-machine crash, and `tee` to a logfile so
results are recoverable even if the tmux pane is gone. Pattern that works (write a script, don't fight
nested quoting over ssh — PowerShell mangles heredocs; use the Bash tool or scp a file):
```bash
# 1. write a run script on the box (Bash tool, heredoc piped over ssh):
ssh root@HOST 'cat > ~/run-eval.sh' <<'EOF'
#!/usr/bin/env bash
cd ~/guandan
t0=$(date +%s); pnpm eval ismcts-rollout-big ismcts-rollout 16; echo "done $(( $(date +%s)-t0 ))s"
echo RUN_COMPLETE
EOF
# 2. launch detached in tmux, logged:
ssh root@HOST 'tmux new-session -d -s eval "bash ~/run-eval.sh 2>&1 | tee ~/eval.log"'
# 3. poll for completion without holding the connection open (run_in_background a watcher):
ssh root@HOST 'until grep -q RUN_COMPLETE ~/eval.log; do sleep 15; done; cat ~/eval.log'
```
Check state on reconnect: `ssh root@HOST 'tmux ls; cat /proc/loadavg; cat ~/eval.log'`.

### Gotchas hit driving evals on the box (save yourself the confusion)
- **`pnpm eval <a> <b> N` → N is MATCHES, not deals**, and mirror is ON by default, so N=16 runs **32
  games** (16 seeds × 2 seat-swaps). A "match" is several deals to a winner (~6–12), so a single match
  of two rollout bots is ~2–3 min. Don't read a 1-match `--no-mirror` probe as the per-game cost of a
  real run — and an n=1 result is meaningless (CI 21–100%).
- **Parallel tail / straggler:** the runner uses `cores-1` workers; games vary 4→12 deals, so near the
  end `loadavg` drops to ~1 while ONE worker finishes the longest match. No partial result prints until
  ALL workers finish and pool (`poolResults`). Don't kill it when load drops — it's almost done.
- **Keep batches modest for rollout bots** and **pool seed ranges** for significance (changelog
  2026-06-26): a too-big single run just ties up the box with no checkpointing. 16 mirrored = a first
  read; pool more `--seed` ranges if the CI straddles 50%.
- This box is only **8 cores** — fine for first reads, but the eval is embarrassingly parallel, so a
  32–64 vCPU box cuts wall-time ~4–8× at the same $/core for high-power batches.

## Workflow
1. **Get the repo on a git host** (needs git installed + a GitHub/GitLab remote — see task #8).
2. **Provision a many-core Linux box.** More cores ≈ linearly faster (the eval is embarrassingly
   parallel). Options, cheapest-per-core first:
   - **Hetzner Cloud** (CCX dedicated-vCPU) or **Hetzner auction** dedicated servers — best $/core.
   - **AWS / GCP spot** (`c7i`/`c6i`/`c2d`, 16–96 vCPU) — elastic, pay only while running, ~70% off
     on-demand. Good for occasional big sweeps.
   - Rough cost: a 32–64 vCPU spot box is ~$0.30–1.50/hr; a heavy eval is minutes → cents per run.
3. **Bootstrap + run:**
   ```bash
   git clone <your-repo-url> guandan && cd guandan
   bash tools/remote/setup.sh        # installs Node 24 + pnpm + deps, runs tests
   tmux new -s eval                  # so jobs survive SSH drops
   pnpm eval ismcts-rollout pimc-static 16
   pnpm ladder 30
   ```
4. **Copy results back** (the printed report, or scp `tools/ladder.json`).

## Concrete options & costs (2026-06-26 research)
- **Default (low-friction):** Hetzner Cloud CCX (**EU** region — free egress; US includes only 1 TB)
  or OVH c3, on-demand ~$0.03/vCPU-hr, no spot interruptions. **64 vCPU × 4h ≈ $7.** One-command
  spin-up via `hcloud`/snapshot + cloud-init.
- **Cheapest (long data-gen):** GCP c2d/c3 or AWS c6i **spot** ~$0.01/vCPU-hr (~$3 for 64 vCPU × 4h),
  *but* shard into idempotent ≤30-min chunks (preemption re-queues a chunk) and keep data in-cloud /
  compressed (hyperscaler egress ~$0.09–0.12/GB).
- **Buy a box only if sustained:** breakeven vs renting is ~1,000–3,000 hours (a used dual-EPYC 7V12 =
  128 cores ~$1.5–2.3k). Not worth it for bursty use.

## Performance tip — pre-compile TS, don't run `tsx` per worker
`tsx`/esbuild strips types per process (~50 ms startup) and skips no JIT-relevant optimization, so for
a many-short-process sim/data-gen farm, do an ahead-of-time build (`tsc`/esbuild) and run `node out.js`
directly — one process per **physical** core. Bake Node + pnpm + the pnpm store into the box snapshot
(`pnpm fetch` + `pnpm install --offline`) so launch is near-instant. (The interactive `pnpm eval`/
`pnpm ladder` on `tsx` is fine; this matters only at fleet scale.)

## Stopgap (no cloud yet)
Throttle local runs so the dev machine stays usable: `pnpm eval <a> <b> <N> --jobs=6`
(leaves cores free; slower but non-saturating).

## Later
The same box (or a GPU one) hosts learned-leaf **self-play data generation + training** when that
track starts (ADR-0009 / task #7c).
