import { describe, it, expect } from "vitest";
import {
  makeRng,
  cloneRng,
  nextU32,
  nextFloat,
  nextInt,
  shuffle,
} from "../src/rng";

describe("rng — determinism", () => {
  it("same seed => identical sequence", () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const seqA = Array.from({ length: 20 }, () => nextU32(a));
    const seqB = Array.from({ length: 20 }, () => nextU32(b));
    expect(seqA).toEqual(seqB);
  });

  it("different seeds => different sequences", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    const seqA = Array.from({ length: 20 }, () => nextU32(a));
    const seqB = Array.from({ length: 20 }, () => nextU32(b));
    expect(seqA).not.toEqual(seqB);
  });

  it("cloneRng snapshots state so simulations don't disturb the original", () => {
    const original = makeRng(99);
    nextU32(original); // advance a bit
    const snapshot = cloneRng(original);
    const branch = cloneRng(original);
    // Consume from the branch; original/snapshot must be unaffected.
    Array.from({ length: 10 }, () => nextU32(branch));
    expect(original.s).toBe(snapshot.s);
    // Resuming from the snapshot reproduces what the original would have produced.
    expect(nextU32(cloneRng(snapshot))).toBe(nextU32(original));
  });
});

describe("rng — distributions", () => {
  it("nextFloat stays in [0, 1)", () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const f = nextFloat(r);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("nextInt stays in [0, n) and rejects bad n", () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const x = nextInt(r, 54);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(54);
      expect(Number.isInteger(x)).toBe(true);
    }
    expect(() => nextInt(r, 0)).toThrow();
    expect(() => nextInt(r, -3)).toThrow();
    expect(() => nextInt(r, 1.5)).toThrow();
  });

  it("nextInt covers the whole range and is roughly uniform", () => {
    const r = makeRng(42);
    const counts = new Array(6).fill(0);
    const N = 60000;
    for (let i = 0; i < N; i++) counts[nextInt(r, 6)]++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(0);
      // within ~10% of the expected N/6 — loose, just catches gross bias
      expect(Math.abs(c - N / 6)).toBeLessThan(N / 6 * 0.1);
    }
  });
});

describe("rng — shuffle", () => {
  it("is a permutation (no cards lost or duplicated)", () => {
    const r = makeRng(2024);
    const arr = Array.from({ length: 108 }, (_, i) => i);
    const shuffled = shuffle(r, arr.slice());
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual(arr);
  });

  it("same seed => same shuffle; and it actually reorders", () => {
    const arr = Array.from({ length: 108 }, (_, i) => i);
    const s1 = shuffle(makeRng(5), arr.slice());
    const s2 = shuffle(makeRng(5), arr.slice());
    expect(s1).toEqual(s2);
    expect(s1).not.toEqual(arr); // astronomically unlikely to be identity
  });
});
