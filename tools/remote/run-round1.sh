#!/usr/bin/env bash
# Expert-iteration ROUND 1 on the box (2026-07-06): prep from the on-box raw dataset, train the
# two-tower policy net (best-val checkpoint), then run both gates. Emits ROUND1_COMPLETE.
#   tmux new-session -d -s round1 "bash tools/remote/run-round1.sh 2>&1 | tee ~/round1.log"
# Results flow to the repo via box-sync (round1.log is in its pull list).
set -uo pipefail
cd "$(dirname "$0")/../.."
git pull -q || true

run() {
  echo ""
  echo "===== [$(date -u +%F' '%T)] $1 ====="
  shift
  "$@"
}

# 1. Prep: stream ~/search-data (raw 21k-deal dataset), reconstruct moves, encode. ~2 min.
run "prep policy data (sample 0.25)" \
  pnpm --filter @guandan/tools exec tsx prep-policy-data.ts --sample 0.25 --out data/policy.bin --dir /root/search-data

# 2. Train with best-val checkpointing. ~15-30 min single-core.
run "train policy net [142,128,64,32]x[30,32,32]" \
  pnpm --filter @guandan/tools exec tsx train-policy.ts data/policy.bin data/policy-weights.json --epochs 20

# 3. GATE 1 (sanity): the apprentice must CRUSH the v1 heuristic it replaces — it distills a
#    searched champion. If this fails, the distillation is broken; stop and diagnose.
run "GATE 1: policy vs heuristic" \
  pnpm evald policy heuristic 300 --auto --max-deals=900 --seed=40001

# 4. GATE 2 (the loop's real test): champion config with apprentice rollouts vs heuristic rollouts,
#    IDENTICAL otherwise (fixed 600 iterations — this measures leaf QUALITY; the net rollout is
#    ~10x slower per move, so a wall-clock-fair comparison comes later if quality wins).
run "GATE 2: ismcts-rollout-net vs ismcts-rollout-big" \
  pnpm evald ismcts-rollout-net ismcts-rollout-big 100 --auto --max-deals=400 --seed=40001

echo ""
echo "ROUND1_COMPLETE"
