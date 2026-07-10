import { describe, it, expect } from "vitest";
import { makeRng, nextFloat } from "@guandan/engine";
import {
  initPolicyNet,
  initPolicyGrads,
  accumulateExample,
  fitPolicy,
  policyScores,
  softmaxScores,
  policyCE,
  policyToJSON,
  policyFromJSON,
  towerForward,
  towerPre1,
  towerForwardFromPre1,
  encodeObs,
  handRankCounts,
  type PolicyExample,
  type PolicyNet,
} from "../src/index";

/** Random small example: obsIn-dim obs, k actions of actIn dims, random normalized target. */
function randomExample(rng: ReturnType<typeof makeRng>, obsIn: number, actIn: number, k: number): PolicyExample {
  const obs = new Float32Array(obsIn);
  for (let i = 0; i < obsIn; i++) obs[i] = nextFloat(rng) * 2 - 1;
  const acts: Float32Array[] = [];
  for (let a = 0; a < k; a++) {
    const v = new Float32Array(actIn);
    for (let i = 0; i < actIn; i++) v[i] = nextFloat(rng) * 2 - 1;
    acts.push(v);
  }
  const target = new Float32Array(k);
  let sum = 0;
  for (let a = 0; a < k; a++) {
    target[a] = nextFloat(rng);
    sum += target[a]!;
  }
  for (let a = 0; a < k; a++) target[a] = target[a]! / sum;
  return { obs, acts, target };
}

/** Total CE over a batch under the current parameters (loss function for finite differences). */
function batchCE(net: PolicyNet, data: PolicyExample[]): number {
  let ce = 0;
  for (const ex of data) ce += policyCE(net, ex);
  return ce;
}

describe("two-tower policy net", () => {
  it("analytic gradients match finite differences (the load-bearing check)", () => {
    // Tiny net + double-checkable epsilon. Sample a spread of parameters from EVERY weight/bias
    // array of BOTH towers and compare dCE/dθ analytic vs numeric. This is what certifies the
    // hand-written backprop through dot-product + softmax-CE + ReLU.
    const rng = makeRng(7);
    const net = initPolicyNet(6, 4, rng, [5], [4], 3);
    const data = [randomExample(rng, 6, 4, 3), randomExample(rng, 6, 4, 5)];

    const grads = initPolicyGrads(net);
    for (const ex of data) accumulateExample(net, ex, grads);

    const eps = 1e-3;
    const checks: { arr: Float32Array; g: Float32Array; label: string }[] = [];
    net.obs.W.forEach((w, l) => checks.push({ arr: w, g: grads.obsW[l]!, label: `obs.W${l}` }));
    net.obs.b.forEach((b, l) => checks.push({ arr: b, g: grads.obsB[l]!, label: `obs.b${l}` }));
    net.act.W.forEach((w, l) => checks.push({ arr: w, g: grads.actW[l]!, label: `act.W${l}` }));
    net.act.b.forEach((b, l) => checks.push({ arr: b, g: grads.actB[l]!, label: `act.b${l}` }));

    for (const { arr, g, label } of checks) {
      // A handful of indices per array, spread across it.
      const idxs = [0, Math.floor(arr.length / 2), arr.length - 1];
      for (const i of idxs) {
        const orig = arr[i]!;
        arr[i] = orig + eps;
        const up = batchCE(net, data);
        arr[i] = orig - eps;
        const down = batchCE(net, data);
        arr[i] = orig;
        const numeric = (up - down) / (2 * eps);
        expect(g[i]!, `${label}[${i}]`).toBeCloseTo(numeric, 2);
      }
    }
  });

  it("training drives cross-entropy down and learns a planted rule", () => {
    // LEARNABLE toy (random soft targets have an entropy floor CE can't beat): the target is
    // one-hot on the action whose first two features sum highest, modulated by the obs's first
    // feature sign (so BOTH towers must contribute). The net must discover the rule.
    const rng = makeRng(11);
    const net = initPolicyNet(6, 4, rng, [12], [8], 6);
    const data: PolicyExample[] = [];
    for (let i = 0; i < 80; i++) {
      const ex = randomExample(rng, 6, 4, 4);
      const sign = (ex.obs[0] as number) >= 0 ? 1 : -1;
      let best = 0;
      let bestV = -Infinity;
      ex.acts.forEach((a, j) => {
        const v = sign * ((a[0] as number) + (a[1] as number));
        if (v > bestV) {
          bestV = v;
          best = j;
        }
      });
      ex.target.fill(0);
      ex.target[best] = 1;
      data.push(ex);
    }

    const before = batchCE(net, data) / data.length;
    fitPolicy(net, data, { epochs: 120, lr: 3e-3, rng: makeRng(2) });
    const after = batchCE(net, data) / data.length;
    expect(after).toBeLessThan(before * 0.5);

    let agree = 0;
    for (const ex of data) {
      const p = softmaxScores(policyScores(net, ex.obs, ex.acts));
      const pick = p.indexOf(Math.max(...Array.from(p)));
      if (pick === ex.target.indexOf(1)) agree++;
    }
    expect(agree / data.length).toBeGreaterThan(0.8);
  });

  it("serialization roundtrips exactly (scores identical)", () => {
    const rng = makeRng(3);
    const net = initPolicyNet(6, 4, rng);
    const ex = randomExample(rng, 6, 4, 5);
    const restored = policyFromJSON(policyToJSON(net));
    const a = Array.from(policyScores(net, ex.obs, ex.acts));
    const b = Array.from(policyScores(restored, ex.obs, ex.acts));
    expect(b).toEqual(a);
  });
});

// towerPre1 + towerForwardFromPre1 (task 9): completing a forward pass from a cached first-layer
// pre-activation, with the changed input slots applied as column deltas, must match a plain
// towerForward on the fully-assembled input.
describe("delta forward from cached pre-activation", () => {
  it("towerForwardFromPre1(template, deltas) ≈ towerForward(template + deltas)", () => {
    const rng = makeRng(77);
    const net = initPolicyNet(40, 10, rng, [24, 16], [8], 12);
    for (let trial = 0; trial < 20; trial++) {
      // Template: random input with the first 15 slots zeroed (the "own hand" block).
      const template = new Float32Array(40);
      for (let i = 15; i < 40; i++) template[i] = nextFloat(rng) * 2 - 1;
      const pre1 = towerPre1(net.obs, template);
      // Sparse deltas in the zeroed block (integer counts, like a hand).
      const idx: number[] = [];
      const val: number[] = [];
      const full = template.slice();
      for (let s = 0; s < 15; s++) {
        if (nextFloat(rng) < 0.5) {
          const c = 1 + Math.floor(nextFloat(rng) * 2);
          idx.push(s);
          val.push(c);
          full[s] = c;
        }
      }
      const viaDelta = towerForwardFromPre1(net.obs, pre1, idx, val);
      const direct = towerForward(net.obs, full);
      expect(viaDelta.length).toBe(direct.length);
      for (let i = 0; i < direct.length; i++) {
        expect(Math.abs(viaDelta[i]! - direct[i]!)).toBeLessThan(1e-4);
      }
      // pre1 is a shared cache — it must not be mutated by the delta pass.
      const pre1Again = towerPre1(net.obs, template);
      expect(Array.from(pre1)).toEqual(Array.from(pre1Again));
    }
  });

  it("handRankCounts equals the own-hand block of encodeObs", () => {
    const hand = [0, 0, 5, 9, 13, 52, 53, 53]; // duplicates + jokers
    const counts = handRankCounts(hand);
    const obs = {
      level: 5,
      player: 0,
      hand,
      handCounts: [8, 27, 27, 27],
      outOfPlay: [],
      trick: null,
      toAct: 0,
      finished: [],
      phase: "playing" as const,
    };
    const f = encodeObs(obs);
    for (let s = 0; s < 15; s++) expect(f[s]).toBe(counts[s]);
  });
});
