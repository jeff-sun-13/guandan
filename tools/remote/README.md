# Remote eval compute

Heavy strength evals pin every core and the current champion is seconds/move, so a real campaign
should run them on a **cloud CPU box**, not the dev machine (ADR-0009). The harness is headless
Node + tsx — it runs anywhere.

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

## Stopgap (no cloud yet)
Throttle local runs so the dev machine stays usable: `pnpm eval <a> <b> <N> --jobs=6`
(leaves cores free; slower but non-saturating).

## Later
The same box (or a GPU one) hosts learned-leaf **self-play data generation + training** when that
track starts (ADR-0009 / task #7c).
