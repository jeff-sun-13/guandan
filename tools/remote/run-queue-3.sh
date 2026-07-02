#!/usr/bin/env bash
# Overnight queue #3 (2026-07-01) — fills the remaining box days after queue-2:
#  A. Extend the two most decision-relevant A/Bs to high n (seeds 30001+, pool with earlier runs).
#  B. Generate the EXPERT-ITERATION dataset: champion self-play with root search statistics,
#     one gen-search-data process per core, sized to ~2.5 days. Data lands in ~/search-data/.
# Chained after queue-2 by a tmux waiter on QUEUE2_COMPLETE (24h fallback). Emits QUEUE3_COMPLETE.
set -uo pipefail
cd "$(dirname "$0")/../.."

run() {
  echo ""
  echo "===== [$(date -u +%F' '%T)] $1 ====="
  shift
  "$@"
}

# A1. Tribute lane, extended (queue-1 first batch read +0.23, z=1.84 — resolve it).
run "tribute-lane EXTENDED (rollout 600)" \
  pnpm evald ismcts-rollout-trib ismcts-rollout-nohist 200 --auto --max-deals=1400 --seed=30001

# A2. Combined challenger, extended.
run "combo endgame+pertype EXTENDED (rollout 600)" \
  pnpm evald ismcts-rollout-combo ismcts-rollout-big 200 --auto --max-deals=1400 --seed=30001

# B. Expert-iteration search data: 7 workers × 3000 deals ≈ ~21k champion deals / ~3M decisions.
#    Each worker is single-threaded; disjoint seed blocks; JSONL parts in ~/search-data/.
echo ""
echo "===== [$(date -u +%F' '%T)] search-data generation (7 workers × 3000 deals) ====="
mkdir -p ~/search-data
cd tools
PIDS=()
for i in 0 1 2 3 4 5 6; do
  seed=$((1000000 + i * 100000))
  nohup npx tsx gen-search-data.ts 3000 "$seed" ~/search-data/part-$i.jsonl \
    > ~/search-data/part-$i.log 2>&1 &
  PIDS+=($!)
done
echo "workers: ${PIDS[*]} — progress in ~/search-data/part-*.log"
wait

echo ""
echo "QUEUE3_COMPLETE"
