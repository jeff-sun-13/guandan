// Self-play data generation for the learned value/leaf net (ADR-0010, step 2).
//
// Plays many self-play deals with the fast heuristic, samples positions, and labels each with the
// ACTUAL deal outcome (the +3/+2/+1 value) for each team — exactly the signal the heuristic-rollout
// leaf estimates, so a net regressed on this learns to BE that rollout, instantly. Output is a flat
// binary of float32 rows `[FEATURE_SIZE features, 1 label]`, plus a small .meta.json, loadable by the
// TS trainer (or numpy: np.fromfile(...).reshape(-1, FEATURE_SIZE+1)).
//
// Runs on the dev machine (heuristic play is fast; the engine is ~1635 deals/s/core). Usage:
//   pnpm gen-data [deals] [samplesPerDeal] [out] [--seed N]
//   pnpm gen-data 20000 10 tools/data/value.bin

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  makeRng,
  createDeal,
  cloneState,
  applyMove,
  isTerminal,
  observe,
  legalMoves,
  result,
  teamOf,
  nextInt,
  type GameState,
  type Player,
  type Rng,
} from "@guandan/engine";
import { heuristicBot } from "@guandan/bots";
import { encodeState, FEATURE_SIZE } from "@guandan/nn";

/** Deal value from `team`'s view: +3/+2/+1 if our side won (by partner finishing 2nd/3rd/4th), else −. */
function dealValue(finish: Player[], team: number): number {
  const winTeam = teamOf(finish[0] as Player);
  const winSeats = [0, 1, 2, 3].filter((s) => teamOf(s) === winTeam);
  const winPos = winSeats.map((s) => finish.indexOf(s)).sort((a, b) => a - b);
  const partnerPos = winPos[1] as number;
  const mag = partnerPos === 1 ? 3 : partnerPos === 2 ? 2 : 1;
  return winTeam === team ? mag : -mag;
}

/** One heuristic playout from `st` to the deal's end; returns team 0's deal value. */
function rolloutValue0(st: GameState, rng: Rng): number {
  let s = cloneState(st);
  let guard = 0;
  while (!isTerminal(s)) {
    const seat = s.toAct;
    s = applyMove(s, heuristicBot(observe(s, seat), legalMoves(s, seat), rng));
    if (++guard > 100000) throw new Error("rollout did not terminate");
  }
  return dealValue(result(s), 0);
}

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const seedIdx = argv.indexOf("--seed");
const seed = seedIdx !== -1 ? Number(argv[seedIdx + 1]) : 1;

const deals = positional[0] ? Number(positional[0]) : 20000;
const samplesPerDeal = positional[1] ? Number(positional[1]) : 10;
const outPath = positional[2] ?? "data/value.bin";
// K heuristic rollouts per sampled state → averaged label (distills the rollout leaf's expected
// value; much cleaner than the single self-play outcome). 0 = use the single actual deal outcome.
const rolloutIdx = argv.indexOf("--rollouts");
const rollouts = rolloutIdx !== -1 ? Number(argv[rolloutIdx + 1]) : 0;

const stride = FEATURE_SIZE + 1;
const maxRows = deals * samplesPerDeal * 2; // 2 team perspectives per sampled position
const buf = new Float32Array(maxRows * stride);
let rows = 0;

const t0 = Date.now();
for (let d = 0; d < deals; d++) {
  const rng = makeRng(seed + d);
  let s = createDeal(2, rng, nextInt(rng, 4));
  const snapshots: GameState[] = [];
  let guard = 0;
  while (!isTerminal(s)) {
    snapshots.push(s); // applyMove returns a fresh state, so each snapshot is an independent object
    const seat = s.toAct;
    s = applyMove(s, heuristicBot(observe(s, seat), legalMoves(s, seat), rng));
    if (++guard > 100000) throw new Error("deal did not terminate");
  }
  const finish = result(s);

  // Sample positions and emit one example per team. The label is either the single actual deal
  // outcome (cheap, noisy) or the average of K fresh rollouts from THAT state (cleaner; distills the
  // rollout leaf). team-1 value is exactly −(team-0 value), so one label set covers both rows.
  const n = snapshots.length;
  const take = Math.min(samplesPerDeal, n);
  for (let k = 0; k < take; k++) {
    const st = snapshots[nextInt(rng, n)] as GameState;
    let v0: number;
    if (rollouts > 0) {
      const rrng = makeRng(1_000_000 + d * 131 + k * 977);
      let acc = 0;
      for (let j = 0; j < rollouts; j++) acc += rolloutValue0(st, rrng);
      v0 = acc / rollouts;
    } else {
      v0 = dealValue(finish, 0);
    }
    for (let team = 0; team < 2; team++) {
      const base = rows * stride;
      buf.set(encodeState(st, team), base);
      buf[base + FEATURE_SIZE] = team === 0 ? v0 : -v0;
      rows++;
    }
  }
  if ((d + 1) % 2000 === 0) {
    process.stdout.write(`\r  ${d + 1}/${deals} deals, ${rows} rows…`);
  }
}

const out = buf.subarray(0, rows * stride);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
writeFileSync(
  `${outPath}.meta.json`,
  JSON.stringify({ featureSize: FEATURE_SIZE, rows, stride, deals, samplesPerDeal, seed }, null, 2),
);

const secs = (Date.now() - t0) / 1000;
console.log(
  `\nWrote ${rows} rows (${FEATURE_SIZE} features + 1 label) → ${outPath}  ` +
    `[${(out.byteLength / 1e6).toFixed(1)} MB, ${secs.toFixed(1)}s, ${(deals / secs).toFixed(0)} deals/s]`,
);
