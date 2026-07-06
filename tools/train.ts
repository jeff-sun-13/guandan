// Train the value/leaf net on a generated dataset (ADR-0010, step 3). Pure TS/Node — no Python.
// Loads the binary dataset, standardizes features, trains a small MLP with a train/val split, and
// exports the weights as JSON for the inference leaf.
//
// Usage:
//   pnpm train [dataPath] [outWeights] [--epochs N] [--lr X] [--hidden A,B]
//   pnpm train data/value.bin data/value-weights.json --epochs 40 --hidden 128,64

import { readFileSync, writeFileSync } from "node:fs";
import { makeRng } from "@guandan/engine";
import { initMLP, fit, predict, mlpToJSON } from "@guandan/nn";

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const opt = (k: string, d: number) => {
  const i = argv.indexOf(`--${k}`);
  return i !== -1 ? Number(argv[i + 1]) : d;
};
const dataPath = positional[0] ?? "data/value.bin";
const outPath = positional[1] ?? "data/value-weights.json";
const epochs = opt("epochs", 40);
const lr = opt("lr", 1e-3);
// Hidden layer widths. Phase-1's [64,32] was deliberately tiny and underfit the v2 encoding
// (ADR-0012 Stage 1 calls for a bigger net on the richer input); default is now wider.
const hiddenIdx = argv.indexOf("--hidden");
const hidden = (hiddenIdx !== -1 ? String(argv[hiddenIdx + 1]) : "128,64")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const meta = JSON.parse(readFileSync(`${dataPath}.meta.json`, "utf8"));
const inN: number = meta.featureSize;
const stride: number = meta.stride;
const n: number = meta.rows;

// Load the flat float32 [features…, label] rows and split into X / Y.
const raw = readFileSync(dataPath);
const all = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
const X = new Float32Array(n * inN);
const Y = new Float32Array(n);
for (let r = 0; r < n; r++) {
  for (let i = 0; i < inN; i++) X[r * inN + i] = all[r * stride + i];
  Y[r] = all[r * stride + inN];
}

// Feature standardization stats.
const mean = new Float32Array(inN);
const std = new Float32Array(inN);
for (let r = 0; r < n; r++) for (let i = 0; i < inN; i++) mean[i] += X[r * inN + i];
for (let i = 0; i < inN; i++) mean[i] /= n;
for (let r = 0; r < n; r++) for (let i = 0; i < inN; i++) { const d = X[r * inN + i] - mean[i]; std[i] += d * d; }
for (let i = 0; i < inN; i++) std[i] = Math.sqrt(std[i] / n) || 1; // guard constant features

// Standardized features + normalized labels (value ∈ ±3 → ±1).
const labelScale = 3;
const Xs = new Float32Array(n * inN);
for (let r = 0; r < n; r++) for (let i = 0; i < inN; i++) Xs[r * inN + i] = (X[r * inN + i] - mean[i]) / std[i];
const Yn = new Float32Array(n);
for (let r = 0; r < n; r++) Yn[r] = Y[r] / labelScale;

// Train/val split (val = last 10%).
const nVal = Math.floor(n * 0.1);
const nTr = n - nVal;

// Baseline: RMSE of always predicting the mean label (what the net must beat).
let yMean = 0;
for (let r = nTr; r < n; r++) yMean += Y[r];
yMean /= Math.max(1, nVal);
let baseSSE = 0;
for (let r = nTr; r < n; r++) baseSSE += (Y[r] - yMean) ** 2;
const baseRMSE = Math.sqrt(baseSSE / Math.max(1, nVal));

const valRMSE = (): number => {
  let sse = 0;
  for (let r = nTr; r < n; r++) sse += (predict(net, X.subarray(r * inN, (r + 1) * inN)) - Y[r]) ** 2;
  return Math.sqrt(sse / Math.max(1, nVal));
};

const net = initMLP([inN, ...hidden, 1], makeRng(1));
net.mean = mean;
net.std = std;
net.labelScale = labelScale;

console.log(
  `\nTraining [${net.sizes.join("→")}] on ${nTr} rows (val ${nVal}); baseline val RMSE ${baseRMSE.toFixed(3)} (predict-mean)\n`,
);
const t0 = Date.now();
// BEST-CHECKPOINTING (2026-07-06): the 2026-07-03 box run saved the LAST epoch, which had drifted
// to val RMSE 1.618 after bottoming at 1.548 around epoch 5 — classic overfit. Keep the weights
// snapshot from the best validation epoch and export THAT.
let bestVal = Infinity;
let bestJSON = "";
let bestEpoch = -1;
fit(net, Xs.subarray(0, nTr * inN), Yn.subarray(0, nTr), {
  epochs,
  batchSize: 256,
  lr,
  rng: makeRng(2),
  onEpoch: (e) => {
    const v = valRMSE();
    if (v < bestVal) {
      bestVal = v;
      bestJSON = mlpToJSON(net); // serialization IS the snapshot (deep copy)
      bestEpoch = e + 1;
    }
    if ((e + 1) % 5 === 0 || e === 0) console.log(`  epoch ${e + 1}/${epochs}  val RMSE ${v.toFixed(3)}  (best ${bestVal.toFixed(3)} @${bestEpoch})`);
  },
});

writeFileSync(outPath, bestJSON || mlpToJSON(net));
console.log(
  `\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s. BEST val RMSE ${bestVal.toFixed(3)} @epoch ${bestEpoch} ` +
    `(final ${valRMSE().toFixed(3)}, baseline ${baseRMSE.toFixed(3)}) → ${outPath} [best checkpoint]`,
);
