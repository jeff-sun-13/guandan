// Engine speed benchmark — the perf gate for search bots (v2). PIMC/ISMCTS call legalMoves +
// applyMove + cloneState in their innermost loop and roll whole deals out millions of times, so
// we need to know the throughput before building on it. Run from repo root:
//   pnpm bench
//
// Reports: full random-playout (rollout) throughput, per-call costs for the hot functions, and a
// derived "rollouts per move budget" so the v2 design can pick K (determinizations) × rollouts.

import {
  makeRng,
  createDeal,
  legalMoves,
  applyMove,
  cloneState,
  isTerminal,
  nextInt,
  type GameState,
} from "@guandan/engine";

function now(): number {
  return Number(process.hrtime.bigint() / 1000n) / 1000; // ms, sub-ms precision
}

/** One full random self-play deal. Returns step + legalMoves call counts. */
function randomPlayout(start: GameState): { moves: number; legalCalls: number } {
  let s = start;
  let moves = 0;
  let legalCalls = 0;
  while (!isTerminal(s)) {
    const legal = legalMoves(s, s.toAct);
    legalCalls++;
    const m = legal[nextInt(s.rng, legal.length)]!;
    s = applyMove(s, m);
    moves++;
  }
  return { moves, legalCalls };
}

function bench(): void {
  // --- 1. Full random-playout throughput (the direct proxy for a PIMC rollout). ---
  {
    const N = 20000;
    // Warm up JIT.
    for (let i = 0; i < 500; i++) randomPlayout(createDeal(2, makeRng(i)));
    let totalMoves = 0;
    let totalLegal = 0;
    const t0 = now();
    for (let i = 0; i < N; i++) {
      const r = randomPlayout(createDeal(2, makeRng(i + 1000)));
      totalMoves += r.moves;
      totalLegal += r.legalCalls;
    }
    const ms = now() - t0;
    const perSec = N / (ms / 1000);
    console.log(`\n[1] Full random playouts (createDeal + play to terminal)`);
    console.log(`    ${N} deals in ${ms.toFixed(0)}ms`);
    console.log(`    ${perSec.toFixed(0)} deals/s   (${(1000 / perSec).toFixed(3)} ms/deal)`);
    console.log(`    avg ${(totalMoves / N).toFixed(1)} moves/deal, ${(totalLegal / N).toFixed(1)} legalMoves calls/deal`);
  }

  // --- 2. legalMoves cost on a FRESH 27-card hand (worst case: biggest enumeration). ---
  {
    const states = Array.from({ length: 200 }, (_, i) => createDeal(2, makeRng(i + 1)));
    const N = 200000;
    let sink = 0;
    // warm
    for (let i = 0; i < 5000; i++) sink += legalMoves(states[i % states.length]!, 0).length;
    const t0 = now();
    for (let i = 0; i < N; i++) sink += legalMoves(states[i % states.length]!, i & 3).length;
    const ms = now() - t0;
    console.log(`\n[2] legalMoves on a fresh 27-card hand (leading — full enumeration)`);
    console.log(`    ${N} calls in ${ms.toFixed(0)}ms   →  ${((ms * 1000) / N).toFixed(2)} µs/call   (sink ${sink})`);
  }

  // --- 3. applyMove + cloneState cost (the per-node search cost). ---
  {
    const base = createDeal(2, makeRng(7));
    const legal = legalMoves(base, base.toAct);
    const move = legal[0]!;
    const N = 500000;
    let sink = 0;
    for (let i = 0; i < 5000; i++) sink += applyMove(base, move).toAct;
    const t0 = now();
    for (let i = 0; i < N; i++) sink += applyMove(base, move).hands.length;
    const ms = now() - t0;
    console.log(`\n[3] applyMove (incl. internal cloneState) from a fresh deal`);
    console.log(`    ${N} calls in ${ms.toFixed(0)}ms   →  ${((ms * 1000) / N).toFixed(2)} µs/call   (sink ${sink})`);

    const t1 = now();
    for (let i = 0; i < N; i++) sink += cloneState(base).hands.length;
    const ms1 = now() - t1;
    console.log(`    cloneState alone: ${((ms1 * 1000) / N).toFixed(2)} µs/call`);
  }

  // --- 4. Derived budget: how many rollouts fit in a move-time budget? ---
  {
    const N = 5000;
    const t0 = now();
    for (let i = 0; i < N; i++) randomPlayout(createDeal(2, makeRng(i + 50000)));
    const ms = now() - t0;
    const perMs = N / ms;
    console.log(`\n[4] Budget guide (full random playouts per move-time budget)`);
    for (const budget of [50, 100, 200, 500]) {
      console.log(`    ${budget}ms budget  →  ~${Math.round(perMs * budget)} full rollouts`);
    }
  }
  console.log();
}

bench();
