// Micro-bench: the production heuristic-rollout fast-path vs the old path, head to head, same seeds.
// OLD = observe(full) + applyMove (re-validates every move, builds the unused outOfPlay array).
// NEW = observe({includeOutOfPlay:false}) + applyMoveTrusted (the wiring now used by pimc/ismcts
// rollout leaves). Confirms the docs/gotchas.md 2026-06-28 finding holds in the real code path.
// Run: pnpm --filter @guandan/tools exec tsx bench-rollout.ts
import {
  makeRng,
  nextInt,
  createDeal,
  applyMove,
  applyMoveTrusted,
  observe,
  legalMoves,
  isTerminal,
  result,
  type GameState,
  type Move,
} from "@guandan/engine";
import { heuristicBot } from "@guandan/bots";

function rolloutOld(s: GameState): Player8 {
  let st = s;
  while (!isTerminal(st)) {
    const seat = st.toAct;
    st = applyMove(st, heuristicBot(observe(st, seat), legalMoves(st, seat), st.rng));
  }
  return result(st)[0]!;
}
function rolloutNew(s: GameState): Player8 {
  let st = s;
  while (!isTerminal(st)) {
    const seat = st.toAct;
    const obs = observe(st, seat, { includeOutOfPlay: false });
    st = applyMoveTrusted(st, heuristicBot(obs, legalMoves(st, seat), st.rng));
  }
  return result(st)[0]!;
}
type Player8 = number;

function run(label: string, fn: (s: GameState) => Player8, N: number): number {
  // Fresh deals from a fixed seed sequence so both variants do identical work.
  let checksum = 0;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const rng = makeRng(1000 + i);
    const s = createDeal(2, rng, nextInt(rng, 4));
    checksum += fn(s);
  }
  const ms = performance.now() - t0;
  const perSec = Math.round((N / ms) * 1000);
  console.log(`${label.padEnd(6)} ${N} rollouts in ${ms.toFixed(0)}ms  → ${perSec} deals/s  (checksum ${checksum})`);
  return perSec;
}

const N = Number(process.argv[2] ?? 30000);
console.log(`Heuristic rollout bench, N=${N} (checksums must match → identical work)`);
run("warmup", rolloutNew, 2000);
run("warmup", rolloutOld, 2000);
const oldR = run("OLD", rolloutOld, N);
const newR = run("NEW", rolloutNew, N);
console.log(`\nspeedup: ${(newR / oldR).toFixed(2)}x  (NEW = applyMoveTrusted + lean observe)`);
