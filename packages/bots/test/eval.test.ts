import { describe, it, expect } from "vitest";
import {
  randomBot,
  heuristicBot,
  evaluateHeadToHead,
  poolResults,
  wilsonInterval,
  type NamedBot,
} from "../src/index";

const RANDOM: NamedBot = { name: "random", bot: randomBot };
const HEURISTIC: NamedBot = { name: "heuristic", bot: heuristicBot };

describe("wilsonInterval", () => {
  it("returns [0,0] for no samples", () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 0]);
  });

  it("stays within [0,1] and brackets the point estimate", () => {
    const [lo, hi] = wilsonInterval(30, 50);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeLessThanOrEqual(0.6);
    expect(hi).toBeGreaterThanOrEqual(0.6);
  });

  it("excludes 50% for a strong, well-sampled win rate", () => {
    const [lo] = wilsonInterval(58, 60); // ~97% over 60 games
    expect(lo).toBeGreaterThan(0.5);
  });
});

describe("evaluateHeadToHead", () => {
  it("is deterministic for the same bots + options", () => {
    const a = evaluateHeadToHead(HEURISTIC, RANDOM, { matches: 8 });
    const b = evaluateHeadToHead(HEURISTIC, RANDOM, { matches: 8 });
    expect(a).toEqual(b);
  });

  it("mirroring doubles the game count", () => {
    const mirrored = evaluateHeadToHead(HEURISTIC, RANDOM, { matches: 10, mirror: true });
    const single = evaluateHeadToHead(HEURISTIC, RANDOM, { matches: 10, mirror: false });
    expect(mirrored.games).toBe(20);
    expect(single.games).toBe(10);
  });

  it("counts are consistent (wins + draws == games)", () => {
    const r = evaluateHeadToHead(HEURISTIC, RANDOM, { matches: 12 });
    expect(r.winsA + r.winsB + r.draws).toBe(r.games);
    expect(r.ci95[0]).toBeLessThanOrEqual(r.winRateA);
    expect(r.ci95[1]).toBeGreaterThanOrEqual(r.winRateA);
  });

  it("the heuristic bot beats the random bot decisively", () => {
    const r = evaluateHeadToHead(HEURISTIC, RANDOM, { matches: 30 });
    // Mirrored over 60 games; v1 measured ~100% vs v0 historically. Demand a clear, significant edge.
    expect(r.winRateA).toBeGreaterThan(0.8);
    expect(r.ci95[0]).toBeGreaterThan(0.5); // significant at 95%
  });
});

describe("poolResults", () => {
  it("throws on empty input", () => {
    expect(() => poolResults([])).toThrow();
  });

  it("rejects mismatched lineups", () => {
    const ab = evaluateHeadToHead(HEURISTIC, RANDOM, { matches: 4 });
    const ba = evaluateHeadToHead(RANDOM, HEURISTIC, { matches: 4 });
    expect(() => poolResults([ab, ba])).toThrow();
  });

  it("pooling disjoint seed chunks equals one combined run (the parallelism guarantee)", () => {
    // The whole point: splitting a run across workers by seed range and recombining must give the
    // SAME counts/win rate/CI as running it single-threaded. Seeds 1..12 == [1..4]+[5..8]+[9..12].
    const whole = evaluateHeadToHead(HEURISTIC, RANDOM, { matches: 12, startSeed: 1 });
    const chunks = [
      evaluateHeadToHead(HEURISTIC, RANDOM, { matches: 4, startSeed: 1 }),
      evaluateHeadToHead(HEURISTIC, RANDOM, { matches: 4, startSeed: 5 }),
      evaluateHeadToHead(HEURISTIC, RANDOM, { matches: 4, startSeed: 9 }),
    ];
    const pooled = poolResults(chunks);
    expect(pooled.games).toBe(whole.games);
    expect(pooled.winsA).toBe(whole.winsA);
    expect(pooled.winsB).toBe(whole.winsB);
    expect(pooled.draws).toBe(whole.draws);
    expect(pooled.winRateA).toBeCloseTo(whole.winRateA, 12);
    expect(pooled.ci95[0]).toBeCloseTo(whole.ci95[0], 12);
    expect(pooled.ci95[1]).toBeCloseTo(whole.ci95[1], 12);
    expect(pooled.avgDeals).toBeCloseTo(whole.avgDeals, 9);
  });
});
