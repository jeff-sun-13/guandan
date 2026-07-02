import { describe, it, expect } from "vitest";
import {
  randomBot,
  heuristicBot,
  evaluateDealsPaired,
  poolDealResults,
  type NamedBot,
} from "../src/index";

const RANDOM: NamedBot = { name: "random", bot: randomBot };
const HEURISTIC: NamedBot = { name: "heuristic", bot: heuristicBot };

describe("evaluateDealsPaired", () => {
  it("is deterministic for the same bots + options", () => {
    const a = evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 10 });
    const b = evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 10 });
    expect(a).toEqual(b);
  });

  it("a bot vs itself gives d = 0 on EVERY paired deal (exact deal-luck cancellation)", () => {
    // The core guarantee: same deal + same rng stream + same bot at both seatings ⇒ the two
    // replays are identical games, so the differential is exactly 0 — zero variance, not just
    // zero mean. This is what makes the harness immune to deal luck and positional bias.
    const r = evaluateDealsPaired(HEURISTIC, HEURISTIC, { deals: 25 });
    expect(r.sumD).toBe(0);
    expect(r.sumD2).toBe(0);
    expect(r.decisive).toBe(0);
    expect(r.meanEdge).toBe(0);
    expect(r.z).toBe(0);
    expect(r.histogram).toEqual({ "0": 25 });
  });

  it("differentials stay in the legal range [-6, 6] and counts are consistent", () => {
    const r = evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 30 });
    let total = 0;
    for (const [k, v] of Object.entries(r.histogram)) {
      const d = Number(k);
      expect(Math.abs(d)).toBeLessThanOrEqual(6);
      expect(Number.isInteger(d)).toBe(true);
      total += v;
    }
    expect(total).toBe(r.deals);
  });

  it("heuristic decisively beats random with a large z at modest n", () => {
    // Match-level eval needed ~60 games for significance; the paired harness should scream at n=30.
    const r = evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 30 });
    expect(r.meanEdge).toBeGreaterThan(0.5); // a big per-deal point edge
    expect(r.z).toBeGreaterThan(3);
  });

  it("samples levels across the range (wild card moves with level)", () => {
    // Restricting the range must change play (different wilds ⇒ different games) — a smoke test
    // that the level knob is actually wired into deal setup.
    const low = evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 30, levelMin: 2, levelMax: 2 });
    const high = evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 30, levelMin: 14, levelMax: 14 });
    expect(low.histogram).not.toEqual(high.histogram);
  });

  it("tributeProb=0 disables tribute contexts; tributeProb=1 forces them", () => {
    // Different contexts ⇒ different games; compare full d-histograms (scalar sums of small
    // integers can collide by chance at modest n — they did at n=12).
    const none = evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 30, tributeProb: 0 });
    const always = evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 30, tributeProb: 1 });
    expect(none.histogram).not.toEqual(always.histogram);
  });
});

describe("poolDealResults", () => {
  it("throws on empty input and mismatched lineups", () => {
    expect(() => poolDealResults([])).toThrow();
    const ab = evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 4 });
    const ba = evaluateDealsPaired(RANDOM, HEURISTIC, { deals: 4 });
    expect(() => poolDealResults([ab, ba])).toThrow();
  });

  it("pooling disjoint seed chunks equals one combined run (the parallelism guarantee)", () => {
    const whole = evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 12, startSeed: 1 });
    const pooled = poolDealResults([
      evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 4, startSeed: 1 }),
      evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 4, startSeed: 5 }),
      evaluateDealsPaired(HEURISTIC, RANDOM, { deals: 4, startSeed: 9 }),
    ]);
    expect(pooled.deals).toBe(whole.deals);
    expect(pooled.sumD).toBe(whole.sumD);
    expect(pooled.sumD2).toBe(whole.sumD2);
    expect(pooled.decisive).toBe(whole.decisive);
    expect(pooled.histogram).toEqual(whole.histogram);
    expect(pooled.meanEdge).toBeCloseTo(whole.meanEdge, 12);
    expect(pooled.se).toBeCloseTo(whole.se, 12);
    expect(pooled.z).toBeCloseTo(whole.z, 12);
  });
});
