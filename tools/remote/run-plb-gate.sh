#!/usr/bin/env bash
# Task 9 gate (2026-07-09, ADR-0016): policy-likelihood belief vs the champion's sampler.
#   1. HEADLINE: ismcts-rollout-plb vs ismcts-rollout-big — identical 600-iter rollout configs,
#      differing ONLY in the world sampler (policy-likelihood pool vs current-trick reweight).
#   2. SECONDARY: plb-trib vs plb — do the HARD tribute pins still add anything as the base
#      dealer once the soft likelihood weighting is in? (Runs only if it still matters — cheap.)
# Fresh seed ranges (46001+/47001+), sequential |z|>=3 discipline, poolable later.
#   tmux new-session -d -s plbgate "bash tools/remote/run-plb-gate.sh 2>&1 | tee ~/plb-gate.log"
set -uo pipefail
cd "$(dirname "$0")/../.."
git pull -q || true

run() {
  echo ""
  echo "===== [$(date -u +%F' '%T)] $1 ====="
  shift
  "$@"
}

run "task 9 HEADLINE: policy-likelihood belief vs champion sampler (600 iters)" \
  pnpm evald ismcts-rollout-plb ismcts-rollout-big 200 --auto --max-deals=1600 --seed=46001

run "task 9 secondary: tribute-pin base under the likelihood sampler" \
  pnpm evald ismcts-rollout-plb-trib ismcts-rollout-plb 200 --auto --max-deals=1200 --seed=47001

echo ""
echo "PLBGATE_COMPLETE"
