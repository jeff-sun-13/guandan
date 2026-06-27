// A small multi-layer perceptron with a hand-written trainer (ADR-0010, step 3). The value net is
// tiny, so we train it in pure TS/Node — no Python/PyTorch/GPU, no external deps — which keeps the
// whole stack in one language and lets the data→train→infer→eval loop run autonomously.
//
// Architecture: ReLU hidden layers, single linear output. Inputs are standardized (mean/std stored in
// the net, computed from the training set); the label is trained in normalized units and multiplied
// by `labelScale` at inference to recover the deal-value scale. Trained with Adam + MSE.

import { type Rng, nextFloat } from "@guandan/engine";

export interface MLP {
  /** Layer sizes, input → … → 1, e.g. [86, 64, 32, 1]. */
  sizes: number[];
  /** W[l] is sizes[l+1] × sizes[l], row-major ([out][in]). */
  W: Float32Array[];
  /** b[l] is sizes[l+1]. */
  b: Float32Array[];
  /** Per-feature input standardization (length sizes[0]). */
  mean: Float32Array;
  std: Float32Array;
  /** Output multiplier to recover the value scale (e.g. 3 if labels were trained as value/3). */
  labelScale: number;
}

/** Standard-normal sample via Box–Muller, driven by the seeded engine RNG (reproducible init). */
function gaussian(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = nextFloat(rng);
  while (v === 0) v = nextFloat(rng);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Fresh net with He-initialized weights, identity standardization, labelScale 1. */
export function initMLP(sizes: number[], rng: Rng): MLP {
  const W: Float32Array[] = [];
  const b: Float32Array[] = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const inN = sizes[l]!;
    const outN = sizes[l + 1]!;
    const w = new Float32Array(outN * inN);
    const scale = Math.sqrt(2 / inN); // He init for ReLU
    for (let i = 0; i < w.length; i++) w[i] = gaussian(rng) * scale;
    W.push(w);
    b.push(new Float32Array(outN));
  }
  return { sizes, W, b, mean: new Float32Array(sizes[0]!), std: new Float32Array(sizes[0]!).fill(1), labelScale: 1 };
}

// In-range typed-array reads use `!` (compile-time only, zero runtime cost) so this numeric module
// stays clean under noUncheckedIndexedAccess regardless of which package compiles it.

/** Forward pass writing each layer's activation into `acts` (acts[0] = standardized input). */
function forward(net: MLP, xStd: Float32Array, acts: Float32Array[]): number {
  acts[0]!.set(xStd);
  const L = net.W.length;
  for (let l = 0; l < L; l++) {
    const inN = net.sizes[l]!;
    const outN = net.sizes[l + 1]!;
    const W = net.W[l]!;
    const b = net.b[l]!;
    const a = acts[l]!;
    const z = acts[l + 1]!;
    for (let o = 0; o < outN; o++) {
      let s = b[o]!;
      const row = o * inN;
      for (let i = 0; i < inN; i++) s += W[row + i]! * a[i]!;
      z[o] = l < L - 1 && s < 0 ? 0 : s; // ReLU on hidden layers, linear output
    }
  }
  return acts[L]![0]!;
}

/** Inference: standardize raw features, forward, and rescale to the value range. ~microseconds. */
export function predict(net: MLP, x: Float32Array): number {
  const acts = net.sizes.map((n) => new Float32Array(n));
  const inN = net.sizes[0]!;
  const xStd = new Float32Array(inN);
  for (let i = 0; i < inN; i++) xStd[i] = (x[i]! - net.mean[i]!) / net.std[i]!;
  return forward(net, xStd, acts) * net.labelScale;
}

export interface FitOptions {
  epochs?: number;
  batchSize?: number;
  lr?: number;
  /** L2 weight decay. Default 0. */
  weightDecay?: number;
  rng: Rng;
  /** Called once per epoch with (epoch, trainMSE) for progress. */
  onEpoch?: (epoch: number, mse: number) => void;
}

/**
 * Train `net` in place on standardized inputs `Xs` (n × in, row-major) and normalized targets `Y`
 * (length n), with Adam + MSE. `Xs` must already be standardized with the net's stored mean/std.
 */
export function fit(net: MLP, Xs: Float32Array, Y: Float32Array, opts: FitOptions): void {
  const epochs = opts.epochs ?? 20;
  const batchSize = opts.batchSize ?? 256;
  const lr = opts.lr ?? 1e-3;
  const wd = opts.weightDecay ?? 0;
  const rng = opts.rng;
  const inN = net.sizes[0]!;
  const n = Y.length;
  const L = net.W.length;

  // Adam state + gradient buffers, one per weight/bias tensor.
  const mW = net.W.map((w) => new Float32Array(w.length));
  const vW = net.W.map((w) => new Float32Array(w.length));
  const mB = net.b.map((b) => new Float32Array(b.length));
  const vB = net.b.map((b) => new Float32Array(b.length));
  const gW = net.W.map((w) => new Float32Array(w.length));
  const gB = net.b.map((b) => new Float32Array(b.length));
  const acts = net.sizes.map((s) => new Float32Array(s));
  const delta = net.sizes.map((s) => new Float32Array(s)); // per-layer error signal
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  let t = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Shuffle indices (Fisher–Yates with the seeded RNG).
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(nextFloat(rng) * (i + 1));
      const tmp = idx[i]!;
      idx[i] = idx[j]!;
      idx[j] = tmp;
    }
    let sse = 0;
    for (let start = 0; start < n; start += batchSize) {
      const end = Math.min(start + batchSize, n);
      const bs = end - start;
      for (let l = 0; l < L; l++) {
        gW[l]!.fill(0);
        gB[l]!.fill(0);
      }
      for (let bi = start; bi < end; bi++) {
        const row = idx[bi]!;
        const xOff = row * inN;
        const xStd = Xs.subarray(xOff, xOff + inN);
        const out = forward(net, xStd, acts);
        const err = out - Y[row]!; // d(0.5*err^2)/dout = err
        sse += err * err;
        // Backprop. Output layer is linear, single unit.
        delta[L]!.fill(0);
        delta[L]![0] = err;
        for (let l = L - 1; l >= 0; l--) {
          const inS = net.sizes[l]!;
          const outS = net.sizes[l + 1]!;
          const a = acts[l]!;
          const dz = delta[l + 1]!;
          const gw = gW[l]!;
          const gb = gB[l]!;
          const W = net.W[l]!;
          const dPrev = delta[l]!;
          if (l > 0) dPrev.fill(0);
          for (let o = 0; o < outS; o++) {
            const d = dz[o]!;
            if (d === 0) continue;
            gb[o] = gb[o]! + d;
            const wrow = o * inS;
            for (let i = 0; i < inS; i++) {
              gw[wrow + i] = gw[wrow + i]! + d * a[i]!;
              if (l > 0) dPrev[i] = dPrev[i]! + W[wrow + i]! * d;
            }
          }
          // Apply ReLU derivative to the previous layer's error (a[l] > 0 ⇔ pre-activation > 0).
          if (l > 0) for (let i = 0; i < inS; i++) if (a[i]! <= 0) dPrev[i] = 0;
        }
      }
      // Adam update (gradients are summed over the batch → scale by 1/bs).
      t++;
      const bc1 = 1 - Math.pow(beta1, t);
      const bc2 = 1 - Math.pow(beta2, t);
      for (let l = 0; l < L; l++) {
        adam(net.W[l]!, gW[l]!, mW[l]!, vW[l]!, bs, lr, wd, beta1, beta2, eps, bc1, bc2);
        adam(net.b[l]!, gB[l]!, mB[l]!, vB[l]!, bs, lr, 0, beta1, beta2, eps, bc1, bc2);
      }
    }
    if (opts.onEpoch) opts.onEpoch(epoch, sse / n);
  }
}

function adam(
  p: Float32Array,
  g: Float32Array,
  m: Float32Array,
  v: Float32Array,
  bs: number,
  lr: number,
  wd: number,
  b1: number,
  b2: number,
  eps: number,
  bc1: number,
  bc2: number,
): void {
  for (let i = 0; i < p.length; i++) {
    const grad = g[i]! / bs + wd * p[i]!;
    const mi = b1 * m[i]! + (1 - b1) * grad;
    const vi = b2 * v[i]! + (1 - b2) * grad * grad;
    m[i] = mi;
    v[i] = vi;
    p[i] = p[i]! - (lr * (mi / bc1)) / (Math.sqrt(vi / bc2) + eps);
  }
}

/** Serialize to plain JSON (arrays), for shipping weights to the inference path. */
export function mlpToJSON(net: MLP): string {
  return JSON.stringify({
    sizes: net.sizes,
    W: net.W.map((w) => Array.from(w)),
    b: net.b.map((b) => Array.from(b)),
    mean: Array.from(net.mean),
    std: Array.from(net.std),
    labelScale: net.labelScale,
  });
}

/** Inverse of `mlpToJSON`. */
export function mlpFromJSON(json: string): MLP {
  const o = JSON.parse(json);
  return {
    sizes: o.sizes,
    W: o.W.map((w: number[]) => Float32Array.from(w)),
    b: o.b.map((b: number[]) => Float32Array.from(b)),
    mean: Float32Array.from(o.mean),
    std: Float32Array.from(o.std),
    labelScale: o.labelScale,
  };
}
