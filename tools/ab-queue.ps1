# One-shot A/B experiment queue (2026-07-01) — run detached, appends to tools/ab-queue.log.
# Each line below is one gated experiment on the paired-deal harness (see eval-deal.ts).
# Safe to re-run; edit the list and re-launch for the next round.
#   Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','tools\ab-queue.ps1' -WindowStyle Hidden
$ErrorActionPreference = "Continue"
Set-Location (Join-Path $PSScriptRoot "..")
$log = "tools\ab-queue.log"

function Run($label, $cmd) {
  Add-Content $log ("`n===== [{0}] {1} =====" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $label)
  # Append per line (open/close each write) so the log stays READABLE while the queue runs —
  # a single piped Add-Content holds an exclusive handle for the whole multi-minute eval.
  & powershell -NoProfile -Command $cmd 2>&1 | ForEach-Object { Add-Content $log $_ }
}

Add-Content $log ("`n########## queue started {0} ##########" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))

# 1. ADR-0011 retest: bundled history (passes + tribute incl. NEW exact pins) on the fixed bounded
#    static leaf, 1200 iters. The old 47.9%/n=96 "no gain" ran on the broken leaf without pins.
Run "hist-vs-nohist (static 1200)" "pnpm evald ismcts-hist ismcts-nohist 100 --auto --max-deals=300 --jobs=6"

# 2. Candidate-scheme A/B, cheap config first: per-type retention vs cheapest-only (600 static, uniform).
Run "pertype-vs-cheapest (static 600)" "pnpm evald ismcts-pertype ismcts-fast 150 --auto --max-deals=600 --jobs=6"

# 3. Tribute lane ALONE (hard constraints + pins, no passing memory) on the champion config (rollout 600).
Run "tribute-lane (rollout 600)" "pnpm evald ismcts-rollout-trib ismcts-rollout-nohist 100 --auto --max-deals=200 --jobs=6"

# 4. Candidate scheme on the champion config (rollout 600 + belief).
Run "pertype (rollout 600)" "pnpm evald ismcts-rollout-pertype ismcts-rollout-big 100 --auto --max-deals=200 --jobs=6"

Add-Content $log ("`n########## queue finished {0} ##########" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
