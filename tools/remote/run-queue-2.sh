#!/usr/bin/env bash
# Overnight queue #2 (2026-07-01) — chained after run-queue.sh by a tmux waiter:
#   tmux new-session -d -s abq2 "bash -c 'n=0; until grep -q QUEUE_COMPLETE ~/ab-queue.log || [ \$n -ge 1080 ]; do sleep 60; n=\$((n+1)); done; cd ~/guandan && git pull -q; bash tools/remote/run-queue-2.sh 2>&1 | tee ~/ab-queue-2.log'"
# Includes the experiments migrated off the dev machine (it shuts down overnight) + Stage-1
# training on the box + first budget-curve probes on the paired harness. Emits QUEUE2_COMPLETE.
set -uo pipefail
cd "$(dirname "$0")/../.."

run() {
  echo ""
  echo "===== [$(date -u +%F' '%T)] $1 ====="
  shift
  "$@"
}

# 1. MIGRATED from the dev machine: hist-vs-nohist retest on the fixed bounded leaf (static 1200).
#    Partial local result before shutdown: batch 1 = -0.095 pts/deal, z=-0.66 (seeds 1..100).
#    Seeds here start at 20001 (disjoint from local 1..N and queue-1's 10001+).
run "hist-vs-nohist retest (static 1200)" \
  pnpm evald ismcts-hist ismcts-nohist 100 --auto --max-deals=400 --seed=20001

# 2. MIGRATED: per-type candidate scheme, cheap static config (directional read for the rollout A/B).
run "pertype-vs-cheapest (static 600)" \
  pnpm evald ismcts-pertype ismcts-fast 150 --auto --max-deals=600 --seed=20001

# 3. The combined challenger: exact-endgame + perType together vs the plain champion config.
run "combo endgame+pertype (rollout 600)" \
  pnpm evald ismcts-rollout-combo ismcts-rollout-big 100 --auto --max-deals=600 --seed=20001

# 4. Stage-1 retrain ON THE BOX (the dev machine's run dies with it tonight): fresh v3 data
#    (levels 2..A + tribute contexts) then the wider net. Weights land where the registry looks.
run "gen-data v3 (600k rows)" pnpm gen-data 30000 10 data/value-v3.bin
run "train value net [144,128,64,1]" pnpm train data/value-v3.bin data/value-weights.json --epochs 30 --hidden 128,64

# 5. Stage-1 GATE: learned leaf (600 iters, ~us leaf) vs the rollout champion config.
#    Honest expectation: parity-at-speed is a WIN (ADR-0012 corrected); beating it is a bonus.
run "ismcts-learned gate (vs rollout 600)" \
  pnpm evald ismcts-learned ismcts-rollout-big 100 --auto --max-deals=600 --seed=20001

# 6. Budget-curve probes on the high-power harness (the old knee came from n=24 Elo fits):
#    is 1200 really > 600, and is 1800 really ~= 1200?
run "budget probe 1200 vs 600" \
  pnpm evald ismcts-rollout-1200 ismcts-rollout-big 100 --auto --max-deals=600 --seed=20001
run "budget probe 1800 vs 1200" \
  pnpm evald ismcts-rollout-huge ismcts-rollout-1200 100 --auto --max-deals=400 --seed=20001

echo ""
echo "QUEUE2_COMPLETE"
