#!/usr/bin/env bash
# Night queue 2026-07-08: Gate 2 is CLOSED for now (nh-t pooled z≈0.94 over 1600 deals = parity at
# ~10x rollout cost — see status.md), so tonight resolves the two remaining below-resolution
# levers that gate real decisions:
#   1. Budget re-decision (ship-target latency/strength): 1800v1200 read +0.171, z=2.59 @400
#      (seeds 20001+, hit max-deals) — single-look significant, needs the pooled |z|>=3 read.
#   2. Exact-endgame rollout leaf: +0.073, z=1.32 @400 (seeds 10001+) — adopt or drop.
# Both poolable with the prior batches (fresh seed ranges).
#   tmux new-session -d -s nightq "bash tools/remote/run-queue-4.sh 2>&1 | tee ~/night-queue.log"
set -uo pipefail
cd "$(dirname "$0")/../.."
git pull -q || true

run() {
  echo ""
  echo "===== [$(date -u +%F' '%T)] $1 ====="
  shift
  "$@"
}

run "budget 1800 vs 1200 EXTENDED" \
  pnpm evald ismcts-rollout-huge ismcts-rollout-1200 200 --auto --max-deals=1200 --seed=44001

run "exact-endgame leaf EXTENDED (rollout 600)" \
  pnpm evald ismcts-rollout-endgame ismcts-rollout-big 200 --auto --max-deals=1600 --seed=45001

echo ""
echo "NIGHTQ_COMPLETE"
