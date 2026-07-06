// Prep the expert-iteration policy dataset (2026-07-06): stream the raw search-data JSONL
// (tools/data/search-data/part-*.jsonl.gz from the box), reconstruct each decision's concrete
// legal moves, encode (obs, actions, visit-count targets) and write ONE flat float32 binary:
//   per decision: [k] [obs × OBS_FEATURES] then k × ([act × ACT_FEATURES] [target])
// plus a .meta.json. The trainer loads the file into a single Float32Array and builds zero-copy
// subarray views, so a ~350k-decision set fits comfortably in memory.
//
// KNOWN BIAS (documented, accepted for round 1): targets exist only for the moves the champion's
// search actually expanded at the root (its candidate cap trims wide nodes cheapest-first, so
// bombs/top plays at wide nodes are usually ABSENT, not zero-weighted). We therefore train only
// over the moves present in the root stats — the net learns preferences among considered moves and
// stays agnostic (not suppressive) about never-considered ones. Round 2 of the loop should
// regenerate data with the perType candidate scheme to shrink this blind spot.
//
// Usage: pnpm --filter @guandan/tools exec tsx prep-policy-data.ts [--sample 0.25] [--out data/policy.bin]

import { createReadStream, createWriteStream, writeFileSync, readdirSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { join } from "node:path";
import {
  legalMoves,
  makeRng,
  nextFloat,
  type Card,
  type GameState,
  type Move,
  type Observation,
} from "@guandan/engine";
import { encodeObs, encodeAction, OBS_FEATURES, ACT_FEATURES } from "@guandan/nn";

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i !== -1 ? String(argv[i + 1]) : d;
};
const sample = Number(opt("sample", "0.25"));
const outPath = opt("out", "data/policy.bin");
const dir = opt("dir", "data/search-data");

/** Public move signature — must match ismcts.ts moveKey exactly (keys come from there). */
function moveKey(m: Move): string {
  if (m.kind === "pass") return "pass";
  return `${m.combo.type}:${m.combo.rank}:${m.combo.length}`;
}

/** Rebuild the mover's concrete legal moves from an observation (only hands[seat]+trick are read). */
function legalFromObs(obs: Observation): Move[] {
  const probe: GameState = {
    level: obs.level,
    hands: [[], [], [], []],
    toAct: obs.player,
    trick: obs.trick,
    finished: obs.finished,
    rng: makeRng(0),
    phase: "playing",
  };
  probe.hands[obs.player] = obs.hand as Card[];
  return legalMoves(probe, obs.player);
}

interface DecisionLine {
  seat: number;
  obs: Observation;
  root: { key: string; n: number; v: number }[];
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".jsonl.gz"))
  .sort()
  .map((f) => join(dir, f));
if (files.length === 0) {
  console.error(`no .jsonl.gz files in ${dir}`);
  process.exit(1);
}

const out = createWriteStream(outPath);
const rng = makeRng(20260706);
let decisions = 0;
let totalActions = 0;
let skippedKeyMiss = 0;
let seen = 0;

function processLine(line: string): void {
  if (!line || line.charCodeAt(0) !== 123 /* '{' */) return;
  let rec: DecisionLine;
  try {
    rec = JSON.parse(line) as DecisionLine;
  } catch {
    return;
  }
  if (!rec.root || rec.root.length < 2) return; // terminal lines / forced moves carry no signal
  seen++;
  if (nextFloat(rng) >= sample) return;

  const byKey = new Map<string, Move>();
  for (const m of legalFromObs(rec.obs)) byKey.set(moveKey(m), m);

  const k = rec.root.length;
  const row = new Float32Array(1 + OBS_FEATURES + k * (ACT_FEATURES + 1));
  row[0] = k;
  row.set(encodeObs(rec.obs), 1);

  let nSum = 0;
  for (const r of rec.root) nSum += r.n;
  if (nSum <= 0) return;

  let off = 1 + OBS_FEATURES;
  for (const r of rec.root) {
    const move = byKey.get(r.key);
    if (!move) {
      skippedKeyMiss++;
      return; // a root key we can't reconstruct — drop the whole decision, count it
    }
    row.set(encodeAction(move, rec.obs.hand.length), off);
    off += ACT_FEATURES;
    row[off++] = r.n / nSum;
  }
  out.write(Buffer.from(row.buffer, row.byteOffset, row.byteLength));
  decisions++;
  totalActions += k;
}

const t0 = Date.now();
let filesDone = 0;
function nextFile(): void {
  const f = files[filesDone];
  if (!f) {
    out.end(() => {
      writeFileSync(
        `${outPath}.meta.json`,
        JSON.stringify(
          { obsFeatures: OBS_FEATURES, actFeatures: ACT_FEATURES, decisions, totalActions, sample, skippedKeyMiss, seen },
          null,
          2,
        ),
      );
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(
        `\nDONE: ${decisions} decisions (${totalActions} actions, avg k=${(totalActions / Math.max(1, decisions)).toFixed(1)}) ` +
          `from ${seen} candidates (sample=${sample}), ${skippedKeyMiss} key-miss drops → ${outPath} in ${mins} min`,
      );
    });
    return;
  }
  const rl = createInterface({ input: createReadStream(f).pipe(createGunzip()), crlfDelay: Infinity });
  rl.on("line", (line) => {
    processLine(line);
    // Backpressure: if the output buffer is saturated, pause the reader until it drains —
    // otherwise a fast parse loop buffers hundreds of MB of pending writes in memory.
    if (out.writableNeedDrain) {
      rl.pause();
      out.once("drain", () => rl.resume());
    }
  });
  rl.on("close", () => {
    filesDone++;
    console.log(`  ${f}: cumulative ${decisions} decisions kept`);
    nextFile();
  });
}
nextFile();
