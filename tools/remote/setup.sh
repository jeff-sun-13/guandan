#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu (22.04/24.04) cloud box to run Guandan bot evals headless, off the dev
# machine (ADR-0009). Installs Node 24 + pnpm, installs deps, and prints how to run evals.
#
# Usage (on the cloud box, after `git clone <repo> guandan && cd guandan`):
#   bash tools/remote/setup.sh
# Then run evals in a detachable session so they survive SSH drops, e.g.:
#   tmux new -s eval
#   pnpm eval ismcts-rollout pimc-static 16
#   pnpm ladder 30
# Detach with Ctrl-b d; reattach with `tmux attach -t eval`.
set -euo pipefail

echo "==> CPU info"
nproc && (grep -m1 'model name' /proc/cpuinfo || true)

echo "==> Installing Node 24 (NodeSource) + tmux"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get install -y tmux

echo "==> Enabling pnpm via corepack"
sudo corepack enable
corepack prepare pnpm@latest --activate

echo "==> Installing dependencies (approve the esbuild build script if prompted)"
pnpm install

echo "==> Sanity: typecheck + tests"
pnpm -r typecheck && pnpm -r test

cat <<'EOF'

==> Ready. The eval harness uses one worker per core automatically (override with --jobs=N).
    Strong-bot sweeps are CPU-bound; more cores = faster. Examples:
      pnpm eval ismcts-rollout pimc-static 16        # head-to-head, 16 mirrored matches
      pnpm ladder 30                                 # full round-robin -> Elo ladder
    Run inside `tmux` so jobs survive disconnects. Pool independent batches with --seed.
EOF
