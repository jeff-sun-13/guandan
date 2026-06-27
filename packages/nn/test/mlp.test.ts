import { describe, it, expect } from "vitest";
import { makeRng, nextFloat } from "@guandan/engine";
import { initMLP, fit, predict, mlpToJSON, mlpFromJSON } from "../src/index";

describe("MLP trainer", () => {
  it("learns a nonlinear target — train MSE drops sharply (validates forward+backprop+Adam)", () => {
    const rng = makeRng(42);
    const inN = 4;
    const n = 1500;
    const Xs = new Float32Array(n * inN);
    const Y = new Float32Array(n);
    for (let r = 0; r < n; r++) {
      const x: number[] = [];
      for (let i = 0; i < inN; i++) {
        const xi = nextFloat(rng) * 2 - 1; // ~[-1,1]
        x[i] = xi;
        Xs[r * inN + i] = xi;
      }
      // A target needing a nonlinearity (product + a relu term).
      Y[r] = 0.6 * x[0]! * x[1]! - 0.4 * x[2]! + 0.3 * Math.max(0, x[3]!);
    }
    const net = initMLP([inN, 32, 16, 1], rng); // mean 0 / std 1 default — Xs already ~[-1,1]
    let first = Infinity;
    let last = Infinity;
    fit(net, Xs, Y, {
      epochs: 80,
      batchSize: 64,
      lr: 5e-3,
      rng,
      onEpoch: (e, mse) => {
        if (e === 0) first = mse;
        last = mse;
      },
    });
    expect(last).toBeLessThan(first * 0.25); // learned a lot
    expect(last).toBeLessThan(0.02); // and fits well in absolute terms

    // Spot-check: prediction tracks the target on a fresh point.
    const tx = new Float32Array([0.5, 0.8, -0.3, 0.6]);
    const target = 0.6 * 0.5 * 0.8 - 0.4 * -0.3 + 0.3 * 0.6;
    expect(Math.abs(predict(net, tx) - target)).toBeLessThan(0.15);
  });

  it("round-trips through JSON with identical predictions", () => {
    const rng = makeRng(7);
    const net = initMLP([5, 8, 1], rng);
    net.mean = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5]);
    net.std = Float32Array.from([1, 2, 1, 2, 1]);
    net.labelScale = 3;
    const x = new Float32Array([1, 2, 3, 4, 5]);
    const before = predict(net, x);
    const after = predict(mlpFromJSON(mlpToJSON(net)), x);
    expect(after).toBeCloseTo(before, 6);
  });
});
