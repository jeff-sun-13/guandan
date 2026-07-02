// Champion self-play SEARCH-DATA generator (2026-07-01) — the raw material for expert iteration
// (distill the champion's decisions into a fast policy net) and for policy-likelihood belief.
//
// Plays deals with the CHAMPION config (ISMCTS 600 iters + belief + rollout leaf) at all four
// seats and logs, per non-forced decision, one JSONL line with the full OBSERVATION (incl. the
// threaded public history) and the search's ROOT STATISTICS (visit counts + mean values — the
// policy target). Observations are stored RAW, not encoded: the policy encoder doesn't exist yet,
// and raw data can be re-encoded under any future scheme without re-running the search.
//
// Deal contexts mirror eval-deal.ts: level sampled 2..A, ~80% get a simulated tribute exchange.
// Each process is single-threaded — run one per core with disjoint seeds:
//   npx tsx gen-search-data.ts [deals] [seed] [out.jsonl] [--iterations N]
//   npx tsx gen-search-data.ts 3000 100000 ~/search-data/part0.jsonl

import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  makeRng,
  createDeal,
  applyMove,
  observe,
  legalMoves,
  isTerminal,
  result,
  planTribute,
  shuffle,
  nextInt,
  nextFloat,
  type GameState,
  type Player,
  type PublicHistory,
} from "@guandan/engine";
import { makeIsmctsSearcher, makeBeliefSampler, applyTributePlan, recordMove, dealValue } from "@guandan/bots";

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const deals = positional[0] ? Number(positional[0]) : 1000;
const seedBase = positional[1] ? Number(positional[1]) : 1;
const outPath = positional[2] ?? "data/search-data.jsonl";
const iterIdx = argv.indexOf("--iterations");
const iterations = iterIdx !== -1 ? Number(argv[iterIdx + 1]) : 600;

const search = makeIsmctsSearcher({ iterations, rollout: true, sampler: makeBeliefSampler() });

mkdirSync(dirname(outPath), { recursive: true });
const out = createWriteStream(outPath, { flags: "a" });

const t0 = Date.now();
let decisions = 0;
for (let d = 0; d < deals; d++) {
  const seed = seedBase + d;
  const rng = makeRng(seed);
  const level = 2 + nextInt(rng, 13);
  const state: GameState = createDeal(level, rng, nextInt(rng, 4) as Player);

  // ~80% of deals get a simulated previous finish → tribute/return + payer leads (mirrors matches).
  const history: PublicHistory = { passes: [], plays: [], tribute: [] };
  if (nextFloat(rng) < 0.8) {
    const declSeats: Player[] = nextInt(rng, 2) === 0 ? [0, 2] : [1, 3];
    const first = declSeats[nextInt(rng, 2)] as Player;
    const rest = shuffle(rng, ([0, 1, 2, 3] as Player[]).filter((p) => p !== first));
    const prevFinish: Player[] = [first, ...rest];
    const rec = applyTributePlan(state, planTribute(prevFinish, state.hands, level), prevFinish, level);
    history.tribute = rec.tribute;
    if (rec.resist) history.resist = rec.resist;
  }

  let s = state;
  let guard = 0;
  while (!isTerminal(s)) {
    const seat = s.toAct;
    const obs = {
      ...observe(s, seat),
      history: {
        passes: history.passes.slice(),
        plays: history.plays.slice(),
        tribute: history.tribute,
        ...(history.resist ? { resist: history.resist } : {}),
      },
    };
    const legal = legalMoves(s, seat);
    const r = search(obs, legal, rng);
    if (r.root.length > 0) {
      // One training example: what the champion SAW and how hard its search liked each root move.
      out.write(
        JSON.stringify({
          seed,
          seat,
          obs,
          root: r.root.map((st) => ({ key: st.key, n: st.selCount, v: st.meanValue })),
          chosen: r.root.find((st) => st.move === r.move)?.key ?? null,
        }) + "\n",
      );
      decisions++;
    }
    recordMove(history, s, seat, r.move);
    s = applyMove(s, r.move);
    if (++guard > 1000) throw new Error(`deal did not terminate (seed ${seed})`);
  }
  // Terminal outcome line — lets a later pipeline attach game-outcome values to the deal's decisions.
  out.write(JSON.stringify({ seed, finish: result(s), value0: dealValue(result(s), 0) }) + "\n");

  if ((d + 1) % 25 === 0) {
    const rate = ((d + 1) / ((Date.now() - t0) / 1000)).toFixed(3);
    console.log(`${d + 1}/${deals} deals, ${decisions} decisions, ${rate} deals/s`);
  }
}
out.end();
console.log(`DONE ${deals} deals, ${decisions} decisions → ${outPath} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
