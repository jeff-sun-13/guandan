// Two-tower policy net (expert iteration, 2026-07-06). Learns to imitate the champion's SEARCH —
// targets are the root visit-count distributions from gen-search-data — so it plays like the
// searched champion at a tiny fraction of the cost, and then goes back INSIDE the search as the
// rollout policy (better leaf fidelity → stronger search → regenerate → retrain: the loop).
//
// Architecture: score(obs, action) = dot( obsTower(obsVec), actTower(actVec) ), softmax over the
// legal actions. The split is the whole point: inside a rollout the observation embedding is
// computed ONCE per decision (~30k MACs) and each legal move costs only the tiny action tower
// (~2k MACs) + a dot product — affordable at ~140 plies × ~10 moves per rollout, where a single
// joint net per (obs, action) pair would be ~50× more expensive.
//
// Pure TS like mlp.ts: hand-written forward/backward/Adam, JSON serialization, no dependencies.
// Gradient correctness is pinned by a finite-difference test (policy.test.ts).

import { type Rng, nextFloat, nextInt } from "@guandan/engine";

/** One MLP tower: ReLU hidden layers, LINEAR output (the embedding). */
export interface Tower {
  sizes: number[];
  /** W[l] is sizes[l+1] × sizes[l], row-major. */
  W: Float32Array[];
  b: Float32Array[];
}

export interface PolicyNet {
  obs: Tower;
  act: Tower;
  /** Embedding dim = obs.sizes.at(-1) = act.sizes.at(-1). */
  embed: number;
}

function gaussian(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = nextFloat(rng);
  while (v === 0) v = nextFloat(rng);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function initTower(sizes: number[], rng: Rng): Tower {
  const W: Float32Array[] = [];
  const b: Float32Array[] = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const inN = sizes[l]!;
    const outN = sizes[l + 1]!;
    const w = new Float32Array(outN * inN);
    const scale = Math.sqrt(2 / inN);
    for (let i = 0; i < w.length; i++) w[i] = gaussian(rng) * scale;
    W.push(w);
    b.push(new Float32Array(outN));
  }
  return { sizes, W, b };
}

/** Fresh policy net. `obsHidden`/`actHidden` are the hidden widths; `embed` the shared output dim. */
export function initPolicyNet(
  obsIn: number,
  actIn: number,
  rng: Rng,
  obsHidden: number[] = [128, 64],
  actHidden: number[] = [32],
  embed = 32,
): PolicyNet {
  return {
    obs: initTower([obsIn, ...obsHidden, embed], rng),
    act: initTower([actIn, ...actHidden, embed], rng),
    embed,
  };
}

/** Forward one tower; if `acts` is given, cache every layer's activation there (for backward). */
export function towerForward(t: Tower, x: Float32Array, acts?: Float32Array[]): Float32Array {
  let cur = x;
  if (acts) acts[0] = x;
  const L = t.W.length;
  for (let l = 0; l < L; l++) {
    const inN = t.sizes[l]!;
    const outN = t.sizes[l + 1]!;
    const W = t.W[l]!;
    const b = t.b[l]!;
    const out = new Float32Array(outN);
    for (let j = 0; j < outN; j++) {
      let s = b[j]!;
      const row = j * inN;
      for (let i = 0; i < inN; i++) s += W[row + i]! * cur[i]!;
      out[j] = l < L - 1 && s < 0 ? 0 : s; // ReLU hidden, linear last
    }
    cur = out;
    if (acts) acts[l + 1] = out;
  }
  return cur;
}

/** Per-tower Adam state (moment buffers per weight/bias array). */
interface AdamState {
  mW: Float32Array[];
  vW: Float32Array[];
  mB: Float32Array[];
  vB: Float32Array[];
}

function initAdam(t: Tower): AdamState {
  return {
    mW: t.W.map((w) => new Float32Array(w.length)),
    vW: t.W.map((w) => new Float32Array(w.length)),
    mB: t.b.map((b) => new Float32Array(b.length)),
    vB: t.b.map((b) => new Float32Array(b.length)),
  };
}

/**
 * Backward through a tower given dL/d(output); ACCUMULATES parameter grads into `gW`/`gB` and
 * returns dL/d(input) (unused for the obs tower but cheap). `acts` from towerForward.
 */
function towerBackward(
  t: Tower,
  acts: Float32Array[],
  gradOut: Float32Array,
  gW: Float32Array[],
  gB: Float32Array[],
): Float32Array {
  let g = gradOut;
  for (let l = t.W.length - 1; l >= 0; l--) {
    const inN = t.sizes[l]!;
    const outN = t.sizes[l + 1]!;
    const W = t.W[l]!;
    const aIn = acts[l]!;
    const aOut = acts[l + 1]!;
    const gwl = gW[l]!;
    const gbl = gB[l]!;
    const gIn = new Float32Array(inN);
    for (let j = 0; j < outN; j++) {
      // ReLU derivative on hidden layers (last layer is linear).
      const gj = l < t.W.length - 1 && aOut[j] === 0 ? 0 : g[j]!;
      if (gj === 0) continue;
      gbl[j] = gbl[j]! + gj;
      const row = j * inN;
      for (let i = 0; i < inN; i++) {
        gwl[row + i] = gwl[row + i]! + gj * aIn[i]!;
        gIn[i] = gIn[i]! + gj * W[row + i]!;
      }
    }
    g = gIn;
  }
  return g;
}

function adamStep(t: Tower, gW: Float32Array[], gB: Float32Array[], st: AdamState, lr: number, step: number): void {
  const b1 = 0.9;
  const b2 = 0.999;
  const eps = 1e-8;
  const c1 = 1 - Math.pow(b1, step);
  const c2 = 1 - Math.pow(b2, step);
  for (let l = 0; l < t.W.length; l++) {
    const w = t.W[l]!;
    const g = gW[l]!;
    const m = st.mW[l]!;
    const v = st.vW[l]!;
    for (let i = 0; i < w.length; i++) {
      const gi = g[i]!;
      m[i] = b1 * m[i]! + (1 - b1) * gi;
      v[i] = b2 * v[i]! + (1 - b2) * gi * gi;
      w[i] = w[i]! - (lr * (m[i]! / c1)) / (Math.sqrt(v[i]! / c2) + eps);
      g[i] = 0; // clear for the next accumulation
    }
    const bb = t.b[l]!;
    const gb = gB[l]!;
    const mb = st.mB[l]!;
    const vb = st.vB[l]!;
    for (let i = 0; i < bb.length; i++) {
      const gi = gb[i]!;
      mb[i] = b1 * mb[i]! + (1 - b1) * gi;
      vb[i] = b2 * vb[i]! + (1 - b2) * gi * gi;
      bb[i] = bb[i]! - (lr * (mb[i]! / c1)) / (Math.sqrt(vb[i]! / c2) + eps);
      gb[i] = 0;
    }
  }
}

/** Softmax in place over the first `k` entries; returns the same array. */
function softmax(scores: Float32Array, k: number): Float32Array {
  let max = -Infinity;
  for (let i = 0; i < k; i++) if (scores[i]! > max) max = scores[i]!;
  let sum = 0;
  for (let i = 0; i < k; i++) {
    const e = Math.exp(scores[i]! - max);
    scores[i] = e;
    sum += e;
  }
  for (let i = 0; i < k; i++) scores[i] = scores[i]! / sum;
  return scores;
}

/**
 * Score every action for one observation: 1 obs-tower forward + k act-tower forwards + k dots.
 * Returns raw scores (apply `softmaxScores` for probabilities).
 */
export function policyScores(net: PolicyNet, obsVec: Float32Array, actVecs: Float32Array[]): Float32Array {
  const oe = towerForward(net.obs, obsVec);
  const out = new Float32Array(actVecs.length);
  for (let a = 0; a < actVecs.length; a++) {
    const ae = towerForward(net.act, actVecs[a]!);
    let s = 0;
    for (let e = 0; e < net.embed; e++) s += oe[e]! * ae[e]!;
    out[a] = s;
  }
  return out;
}

/** Softmax over a scores array (copy; original untouched). */
export function softmaxScores(scores: Float32Array): Float32Array {
  return softmax(scores.slice(), scores.length);
}

export interface PolicyFitOptions {
  epochs?: number;
  lr?: number;
  /** Decisions per Adam step (grad accumulation). Default 8. */
  batchDecisions?: number;
  rng: Rng;
  /** Called after each epoch with (epoch, meanTrainCE). */
  onEpoch?: (epoch: number, trainCE: number) => void;
}

/**
 * One decision's supervised example: the obs vector, its k action vectors, and the k-target
 * distribution (visit fractions, sums to 1).
 */
export interface PolicyExample {
  obs: Float32Array;
  acts: Float32Array[];
  target: Float32Array;
}

/** Cross-entropy of the net's softmax vs the target for one example (evaluation). */
export function policyCE(net: PolicyNet, ex: PolicyExample): number {
  const p = softmax(policyScores(net, ex.obs, ex.acts), ex.acts.length);
  let ce = 0;
  for (let i = 0; i < ex.acts.length; i++) {
    if (ex.target[i]! > 0) ce -= ex.target[i]! * Math.log(Math.max(p[i]!, 1e-12));
  }
  return ce;
}

/** Zero-initialized gradient buffers matching a net's parameters. */
export interface PolicyGrads {
  obsW: Float32Array[];
  obsB: Float32Array[];
  actW: Float32Array[];
  actB: Float32Array[];
}

export function initPolicyGrads(net: PolicyNet): PolicyGrads {
  return {
    obsW: net.obs.W.map((w) => new Float32Array(w.length)),
    obsB: net.obs.b.map((b) => new Float32Array(b.length)),
    actW: net.act.W.map((w) => new Float32Array(w.length)),
    actB: net.act.b.map((b) => new Float32Array(b.length)),
  };
}

/**
 * Forward + backward for ONE example; ACCUMULATES parameter gradients into `grads` and returns the
 * example's cross-entropy. Exported so the finite-difference test can pin analytic gradients.
 */
export function accumulateExample(net: PolicyNet, ex: PolicyExample, grads: PolicyGrads): number {
  const k = ex.acts.length;
  const obsActs: Float32Array[] = [];
  const oe = towerForward(net.obs, ex.obs, obsActs);
  const actCaches: Float32Array[][] = [];
  const aes: Float32Array[] = [];
  const scores = new Float32Array(k);
  for (let a = 0; a < k; a++) {
    const cache: Float32Array[] = [];
    const ae = towerForward(net.act, ex.acts[a]!, cache);
    actCaches.push(cache);
    aes.push(ae);
    let s = 0;
    for (let e = 0; e < net.embed; e++) s += oe[e]! * ae[e]!;
    scores[a] = s;
  }
  const p = softmax(scores, k); // in place

  let ce = 0;
  for (let i = 0; i < k; i++) {
    if (ex.target[i]! > 0) ce -= ex.target[i]! * Math.log(Math.max(p[i]!, 1e-12));
  }

  // dL/dscore_i = p_i − t_i. Through the dot: obs-embed grad accumulates Σ g_i·ae_i; each
  // action-embed grad is g_i·oe.
  const gOe = new Float32Array(net.embed);
  for (let a = 0; a < k; a++) {
    const g = p[a]! - ex.target[a]!;
    if (g === 0) continue;
    const ae = aes[a]!;
    for (let e = 0; e < net.embed; e++) gOe[e] = gOe[e]! + g * ae[e]!;
    const gAe = new Float32Array(net.embed);
    for (let e = 0; e < net.embed; e++) gAe[e] = g * oe[e]!;
    towerBackward(net.act, actCaches[a]!, gAe, grads.actW, grads.actB);
  }
  towerBackward(net.obs, obsActs, gOe, grads.obsW, grads.obsB);
  return ce;
}

/** Train with softmax cross-entropy on visit-count targets. Mutates `net` in place. */
export function fitPolicy(net: PolicyNet, data: PolicyExample[], opts: PolicyFitOptions): void {
  const epochs = opts.epochs ?? 10;
  const lr = opts.lr ?? 3e-4;
  const batch = Math.max(1, opts.batchDecisions ?? 8);
  const rng = opts.rng;

  const grads = initPolicyGrads(net);
  const stObs = initAdam(net.obs);
  const stAct = initAdam(net.act);

  const order = data.map((_, i) => i);
  let step = 0;

  for (let ep = 0; ep < epochs; ep++) {
    // Fisher–Yates with the injected rng (reproducible).
    for (let i = order.length - 1; i > 0; i--) {
      const j = nextInt(rng, i + 1);
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    let ceSum = 0;
    let inBatch = 0;
    for (const idx of order) {
      ceSum += accumulateExample(net, data[idx]!, grads);
      if (++inBatch >= batch) {
        step++;
        adamStep(net.obs, grads.obsW, grads.obsB, stObs, lr, step);
        adamStep(net.act, grads.actW, grads.actB, stAct, lr, step);
        inBatch = 0;
      }
    }
    if (inBatch > 0) {
      step++;
      adamStep(net.obs, grads.obsW, grads.obsB, stObs, lr, step);
      adamStep(net.act, grads.actW, grads.actB, stAct, lr, step);
      inBatch = 0;
    }
    opts.onEpoch?.(ep, ceSum / Math.max(1, data.length));
  }
}

// ---- Serialization (JSON, same style as mlp.ts) ----

function towerToJSON(t: Tower): object {
  return {
    sizes: t.sizes,
    W: t.W.map((w) => Array.from(w)),
    b: t.b.map((b) => Array.from(b)),
  };
}

function towerFromJSON(o: { sizes: number[]; W: number[][]; b: number[][] }): Tower {
  return {
    sizes: o.sizes,
    W: o.W.map((w) => Float32Array.from(w)),
    b: o.b.map((b) => Float32Array.from(b)),
  };
}

export function policyToJSON(net: PolicyNet): string {
  return JSON.stringify({ obs: towerToJSON(net.obs), act: towerToJSON(net.act), embed: net.embed });
}

export function policyFromJSON(json: string): PolicyNet {
  const o = JSON.parse(json) as { obs: never; act: never; embed: number };
  return { obs: towerFromJSON(o.obs), act: towerFromJSON(o.act), embed: o.embed };
}
