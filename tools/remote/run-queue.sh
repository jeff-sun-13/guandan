#!/usr/bin/env bash
# Champion-config A/B queue for the eval box (2026-07-01) — the heavy paired-deal experiments the
# dev machine is too slow for. Run detached so it survives SSH drops:
#   tmux new-session -d -s abq "bash tools/remote/run-queue.sh 2>&1 | tee ~/ab-queue.log"
# Progress: `tail ~/ab-queue.log`. Emits QUEUE_COMPLETE at the end (poll for it).
#
# Seeds start at 10001 so results stay POOLABLE with the dev machine's runs (seeds 1..N) — never
# pool two runs of the same experiment over overlapping seed ranges (double-counts deals).
set -uo pipefail
cd "$(dirname "$0")/../.."

run() {
  echo ""
  echo "===== [$(date -u +%F' '%T)] $1 ====="
  shift
  "$@" # keep going on failure — later experiments still run; the log shows what broke
}

# 1. Tribute lane ALONE on the champion config: HARD constraints + NEW exact-card pins, no passing
#    memory. The ceiling-only form was Path A's one win; pins should only add. vs -nohist.
run "tribute-lane (rollout 600)" \
  pnpm evald ismcts-rollout-trib ismcts-rollout-nohist 100 --auto --max-deals=600 --seed=10001

# 2. Passing lane ALONE (the suspect half of the old harmful bundle). vs -nohist.
run "pass-lane (rollout 600)" \
  pnpm evald ismcts-rollout-pass ismcts-rollout-nohist 100 --auto --max-deals=600 --seed=10001

# 3. Per-type candidate retention on the champion config (bombs/top-singles stay searchable).
run "pertype (rollout 600)" \
  pnpm evald ismcts-rollout-pertype ismcts-rollout-big 100 --auto --max-deals=600 --seed=10001

# 4. Match-aware objective, pinned to the situation it targets: every deal declarer-at-A, scored by
#    the match-aware metric (raw points UNDERVALUE correct A-play by construction).
run "matchaware @A (rollout 600)" \
  pnpm evald ismcts-rollout-matchaware ismcts-rollout-nohist 100 --auto --max-deals=600 --seed=10001 --level=14 --score=match

# 5. Match-aware no-regression check at DEFAULT levels/scoring (should be ~0; catches accidental harm).
run "matchaware default (no-regression)" \
  pnpm evald ismcts-rollout-matchaware ismcts-rollout-nohist 100 --auto --max-deals=400 --seed=10001

# 6. Exact-endgame rollouts: every leaf's rollout finishes with the alpha-beta solved value at
#    ≤8 cards (endgame.ts; ~0.25 ms median). The leaf-quality lever the run-out analysis wanted.
run "exact-endgame leaf (rollout 600)" \
  pnpm evald ismcts-rollout-endgame ismcts-rollout-big 100 --auto --max-deals=600 --seed=10001

echo ""
echo "QUEUE_COMPLETE"
