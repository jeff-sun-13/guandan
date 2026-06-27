#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu (22.04/24.04) cloud box to run Guandan bot evals/data-gen headless, off
# the dev machine (ADR-0009). Installs Node 24 + pnpm + deps, runs the tests. Safe to run as root
# (Hetzner default) or a sudo user.
#
# Usage (on the box, after `apt-get install -y git && git clone <repo> guandan && cd guandan`):
#   bash tools/remote/setup.sh
# Then run work in a detachable session so it survives SSH drops:
#   tmux new -s run
#   pnpm eval ismcts-rollout pimc-static 16
# Detach with Ctrl-b then d; reattach with `tmux attach -t run`.
set -euo pipefail

# Use sudo only if we're not already root.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

echo "==> CPU"
nproc && (grep -m1 'model name' /proc/cpuinfo || true)

echo "==> Base packages (git, curl, tmux)"
$SUDO apt-get update -y
$SUDO apt-get install -y git curl tmux ca-certificates

echo "==> Node 24 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
node -v

echo "==> pnpm via corepack"
$SUDO corepack enable
corepack prepare pnpm@latest --activate

echo "==> Install dependencies"
pnpm install

echo "==> Sanity: typecheck + tests"
pnpm -r typecheck && pnpm -r test

cat <<'EOF'

==> Ready. The eval harness uses one worker per core automatically (override with --jobs=N).
    Examples (run inside tmux):
      pnpm eval ismcts-rollout pimc-static 16     # head-to-head, 16 mirrored matches
      pnpm gen-data 30000 10 data/value.bin       # self-play training data
      pnpm ladder 30                              # round-robin -> Elo ladder
    Pool independent batches with --seed. To stop billing, DELETE the server in the Hetzner console.
EOF
