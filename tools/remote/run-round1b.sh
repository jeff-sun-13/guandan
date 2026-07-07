#!/usr/bin/env bash
# Round 1b (2026-07-06 overnight): Gate-2 DIAGNOSIS. Round 1 read Gate 1 PASS (policy crushes
# heuristic, z=12.98) but Gate 2 FAIL (apprentice rollouts hurt the champion, z=−8.64). Two
# suspects, two cheap fixes, gated separately then together:
#   A. argmax rollouts have no diversity → temperature-1 sampling (ismcts-rollout-net-t)
#   B. history features are all-zero inside rollouts but the net trained WITH them → retrain a
#      NOHIST net on the same prepped data (--zero-history 1) (ismcts-rollout-net-nh-t)
# Then a fill job: tribute-lane extension toward ~5k pooled deals (2026-07-03: pooled +0.05, z≈1.9).
#   tmux new-session -d -s round1b "bash tools/remote/run-round1b.sh 2>&1 | tee ~/round1b.log"
# Results flow to the repo via box-sync (round1b.log is in its pull list).
set -uo pipefail
cd "$(dirname "$0")/../.."
git pull -q || true

run() {
  echo ""
  echo "===== [$(date -u +%F' '%T)] $1 ====="
  shift
  "$@"
}

# 0. The prepped dataset should still be on the box from round 1; re-prep only if missing.
[ -f tools/data/policy.bin ] || run "prep policy data (policy.bin missing)" \
  pnpm --filter @guandan/tools exec tsx prep-policy-data.ts --sample 0.25 --out data/policy.bin --dir /root/search-data

# 1. Train the NOHIST net (same data, history feature blocks zeroed). ~16 min.
run "train NOHIST policy net (--zero-history)" \
  pnpm --filter @guandan/tools exec tsx train-policy.ts data/policy.bin data/policy-weights-nohist.json --epochs 20 --zero-history 1

# 2. Sanity (seconds): the nohist apprentice must still beat v1 on the outOfPlay fallback alone.
#    If this fails, skip reading Gate 2b as meaningful.
run "SANITY: policy-nohist vs heuristic" \
  pnpm evald policy-nohist heuristic 300 --auto --max-deals=900 --seed=41001

# 3. GATE 2a — temperature alone (round-1 net, sampled rollouts). Fixed 600 iters, quality test.
run "GATE 2a: ismcts-rollout-net-t vs ismcts-rollout-big" \
  pnpm evald ismcts-rollout-net-t ismcts-rollout-big 100 --auto --max-deals=400 --seed=41001

# 4. GATE 2b — both fixes (nohist net + sampled rollouts). The headline: if this reaches parity or
#    better, the expert-iteration loop is unblocked (then weigh the ~10x rollout cost).
run "GATE 2b: ismcts-rollout-net-nh-t vs ismcts-rollout-big" \
  pnpm evald ismcts-rollout-net-nh-t ismcts-rollout-big 100 --auto --max-deals=400 --seed=41001

echo ""
echo "ROUND1B_GATES_DONE"

# 5. Fill until collected: tribute-lane extension (poolable with seeds 10001+/30001+ batches; this
#    adds up to 3000 deals at fresh seeds — enough to resolve the pooled z≈1.9 either way).
run "tribute-lane FILL (toward ~5k pooled)" \
  pnpm evald ismcts-rollout-trib ismcts-rollout-nohist 200 --auto --max-deals=3000 --seed=42001

echo ""
echo "ROUND1B_COMPLETE"
