// Endgame-solver sizing probe: what positions solve within realistic node budgets? Informs the
// ISMCTS-leaf integration threshold (solve exactly when cardsRemaining <= K, else rollout).
// Usage: pnpm --filter @guandan/tools exec tsx bench-endgame.ts
import {
  makeRng,
  createDeal,
  applyMove,
  legalMoves,
  observe,
  isTerminal,
  nextInt,
  type GameState,
} from "@guandan/engine";
import { randomBot, solveEndgame, cardsRemaining } from "@guandan/bots";

function sample(band: [number, number], n: number, seed: number): GameState[] {
  const out: GameState[] = [];
  const rng = makeRng(seed);
  while (out.length < n) {
    let s = createDeal(2 + nextInt(rng, 13), rng);
    while (!isTerminal(s)) {
      const c = cardsRemaining(s);
      if (c >= band[0] && c <= band[1] && out.length < n) out.push(s);
      s = applyMove(s, randomBot(observe(s, s.toAct), legalMoves(s, s.toAct), rng));
    }
  }
  return out;
}

const N = 40;
const BUDGET = 100_000;
for (const band of [[6, 8], [9, 12], [13, 16], [17, 20], [21, 24]] as [number, number][]) {
  const states = sample(band, N, 1000 + band[0]);
  let solved = 0;
  const nodes: number[] = [];
  const t0 = Date.now();
  for (const s of states) {
    const r = solveEndgame(s, { maxNodes: BUDGET });
    if (r) {
      solved++;
      nodes.push(r.nodes);
    }
  }
  const ms = Date.now() - t0;
  nodes.sort((a, b) => a - b);
  const med = nodes[Math.floor(nodes.length / 2)] ?? -1;
  const p90 = nodes[Math.floor(nodes.length * 0.9)] ?? -1;
  console.log(
    `cards ${String(band[0]).padStart(2)}-${String(band[1]).padEnd(2)}: solved ${solved}/${N} @${BUDGET} nodes, ` +
      `median ${med} nodes, p90 ${p90}, ${(ms / N).toFixed(1)}ms/position avg (incl. aborts)`,
  );
}
