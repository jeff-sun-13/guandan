// Train the two-tower policy net on the prepped expert-iteration dataset (2026-07-06).
// Loads data/policy.bin (see prep-policy-data.ts) into ONE Float32Array and builds zero-copy
// subarray views per decision, so ~350k decisions train in-memory. Best-VALIDATION checkpointing
// from the start (the value-net run taught us: last-epoch weights were the overfit ones).
//
// Usage: pnpm --filter @guandan/tools exec tsx train-policy.ts [data/policy.bin] [data/policy-weights.json]
//        [--epochs 20] [--lr 3e-4] [--obs-hidden 128,64] [--act-hidden 32] [--embed 32]

import { readFileSync, writeFileSync } from "node:fs";
import { makeRng } from "@guandan/engine";
import {
  initPolicyNet,
  fitPolicy,
  policyCE,
  policyScores,
  policyToJSON,
  type PolicyExample,
} from "@guandan/nn";

const argv = process.argv.slice(2);
// Positionals = args that are neither a --flag nor the value following one.
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i]!.startsWith("--")) i++; // skip the flag's value too
  else positional.push(argv[i]!);
}
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i !== -1 ? String(argv[i + 1]) : d;
};
const dataPath = positional[0] ?? "data/policy.bin";
const outPath = positional[1] ?? "data/policy-weights.json";
const epochs = Number(opt("epochs", "20"));
const lr = Number(opt("lr", "3e-4"));
const sizes = (s: string) => s.split(",").map((x) => Number(x.trim())).filter((n) => n > 0);
const obsHidden = sizes(opt("obs-hidden", "128,64"));
const actHidden = sizes(opt("act-hidden", "32"));
const embed = Number(opt("embed", "32"));

const meta = JSON.parse(readFileSync(`${dataPath}.meta.json`, "utf8")) as {
  obsFeatures: number;
  actFeatures: number;
  decisions: number;
};
const OBS = meta.obsFeatures;
const ACT = meta.actFeatures;

const raw = readFileSync(dataPath);
const all = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));

// Build zero-copy views. Layout per decision: [k][obs×OBS][k × (act×ACT, target)].
const data: PolicyExample[] = [];
let off = 0;
while (off < all.length) {
  const k = all[off]!;
  if (!(k >= 2)) break; // trailing garbage guard
  const obs = all.subarray(off + 1, off + 1 + OBS);
  const acts: Float32Array[] = [];
  const target = new Float32Array(k);
  let p = off + 1 + OBS;
  for (let a = 0; a < k; a++) {
    acts.push(all.subarray(p, p + ACT));
    p += ACT;
    target[a] = all[p++]!;
  }
  data.push({ obs, acts, target });
  off = p;
}
if (data.length !== meta.decisions) {
  console.warn(`warning: parsed ${data.length} decisions, meta says ${meta.decisions}`);
}

// Split: last 5% validation (file order ≈ deal order; fine for a first pass).
const nVal = Math.floor(data.length * 0.05);
const train = data.slice(0, data.length - nVal);
const val = data.slice(data.length - nVal);

const valStats = (net: Parameters<typeof policyCE>[0]): { ce: number; top1: number } => {
  let ce = 0;
  let hit = 0;
  for (const ex of val) {
    ce += policyCE(net, ex);
    const s = policyScores(net, ex.obs, ex.acts);
    let bi = 0;
    for (let i = 1; i < s.length; i++) if (s[i]! > s[bi]!) bi = i;
    let ti = 0;
    for (let i = 1; i < ex.target.length; i++) if (ex.target[i]! > ex.target[ti]!) ti = i;
    if (bi === ti) hit++;
  }
  return { ce: ce / Math.max(1, val.length), top1: hit / Math.max(1, val.length) };
};

// Baseline: uniform-over-k CE (what "knows nothing" scores).
let uniCE = 0;
for (const ex of val) uniCE += Math.log(ex.acts.length);
uniCE /= Math.max(1, val.length);

const net = initPolicyNet(OBS, ACT, makeRng(1), obsHidden, actHidden, embed);
console.log(
  `\nPolicy: obs[${net.obs.sizes.join("→")}] · act[${net.act.sizes.join("→")}], ` +
    `${train.length} train / ${val.length} val decisions; uniform-CE baseline ${uniCE.toFixed(3)}\n`,
);

let bestCE = Infinity;
let bestJSON = "";
let bestEpoch = -1;
const t0 = Date.now();
fitPolicy(net, train, {
  epochs,
  lr,
  rng: makeRng(2),
  onEpoch: (e, trainCE) => {
    const { ce, top1 } = valStats(net);
    if (ce < bestCE) {
      bestCE = ce;
      bestJSON = policyToJSON(net);
      bestEpoch = e + 1;
    }
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(
      `  epoch ${e + 1}/${epochs}  train CE ${trainCE.toFixed(4)}  val CE ${ce.toFixed(4)}  ` +
        `top1 ${(top1 * 100).toFixed(1)}%  (best ${bestCE.toFixed(4)} @${bestEpoch})  [${mins}m]`,
    );
  },
});

writeFileSync(outPath, bestJSON || policyToJSON(net));
console.log(`\nSaved BEST checkpoint (val CE ${bestCE.toFixed(4)} @epoch ${bestEpoch}) → ${outPath}`);
