#!/usr/bin/env bash
# Task 9 diagnosis (2026-07-10, ADR-0016): the policy-likelihood gate FAILED (−0.1325, z=−3.66
# @1400 — see box-results/plb-gate.log). The challenger bundled TWO changes; separate them:
#   1. plb-u vs big  — SAME pool machinery, likelihood OFF (uniform weights). Reads the cost of
#      reused-pool sampling alone (world-diversity loss vs ~600 fresh worlds/decision).
#   2. plb-r vs big  — likelihood ON, pool refreshed every 150 draws (diversity bought back).
#   3. plb-soft vs big — gentler posterior (power .5, mix .25, window 24; ESS p50 48/64 vs 17).
# Decision tree: plb-u ≈ −0.13 ⇒ the POOL is the harm (then plb-r is the key read);
# plb-u ≈ 0 ⇒ the SIGNAL is the harm (then plb-soft is the key read; if also negative → park).
#   tmux new-session -d -s plbdiag "bash tools/remote/run-plb-diag.sh 2>&1 | tee ~/plb-diag.log"
set -uo pipefail
cd "$(dirname "$0")/../.."
git pull -q || true

run() {
  echo ""
  echo "===== [$(date -u +%F' '%T)] $1 ====="
  shift
  "$@"
}

run "diag 1: pooled worlds, likelihood OFF (mechanism cost)" \
  pnpm evald ismcts-rollout-plb-u ismcts-rollout-big 200 --auto --max-deals=1200 --seed=48001

run "diag 2: likelihood + pool refresh every 150 draws (diversity restored)" \
  pnpm evald ismcts-rollout-plb-r ismcts-rollout-big 200 --auto --max-deals=1200 --seed=49001

run "diag 3: gentler posterior (power .5, mix .25, window 24)" \
  pnpm evald ismcts-rollout-plb-soft ismcts-rollout-big 200 --auto --max-deals=1200 --seed=50001

echo ""
echo "PLBDIAG_COMPLETE"
