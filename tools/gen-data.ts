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
  applyMove,
  isTerminal,
  observe,
  legalMoves,
  result,
  teamOf,
  nextInt,
  type GameState,
  type Player,
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

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const seedIdx = argv.indexOf("--seed");
const seed = seedIdx !== -1 ? Number(argv[seedIdx + 1]) : 1;

const deals = positional[0] ? Number(positional[0]) : 20000;
const samplesPerDeal = positional[1] ? Number(positional[1]) : 10;
const outPath = positional[2] ?? "data/value.bin";

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

  // Sample positions from this deal and emit one example per team (the encoder is team-relative,
  // so (state, team0) and (state, team1) are two distinct, equally-valid training rows).
  const n = snapshots.length;
  const take = Math.min(samplesPerDeal, n);
  for (let k = 0; k < take; k++) {
    const st = snapshots[nextInt(rng, n)] as GameState;
    for (let team = 0; team < 2; team++) {
      const base = rows * stride;
      buf.set(encodeState(st, team), base);
      buf[base + FEATURE_SIZE] = dealValue(finish, team);
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
