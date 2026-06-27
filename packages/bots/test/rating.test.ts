import { describe, it, expect } from "vitest";
import { fitBradleyTerry, formatLadder } from "../src/index";

describe("fitBradleyTerry", () => {
  it("gives equal Elo to a perfectly balanced round-robin", () => {
    // Everyone splits 50/50 with everyone → equal strength → equal Elo, centred on the base.
    const names = ["a", "b", "c"];
    const wins = [
      [0, 50, 50],
      [50, 0, 50],
      [50, 50, 0],
    ];
    const ladder = fitBradleyTerry(names, wins, { base: 1500 });
    for (const e of ladder) expect(e.elo).toBeCloseTo(1500, 6);
  });

  it("orders bots by a transitive dominance chain (a > b > c)", () => {
    const names = ["strong", "mid", "weak"];
    const wins = [
      [0, 70, 90], // strong beats mid 70/30, weak 90/10
      [30, 0, 70], // mid beats weak 70/30
      [10, 30, 0],
    ];
    const ladder = fitBradleyTerry(names, wins);
    expect(ladder.map((e) => e.name)).toEqual(["strong", "mid", "weak"]);
    expect(ladder[0]!.elo).toBeGreaterThan(ladder[1]!.elo);
    expect(ladder[1]!.elo).toBeGreaterThan(ladder[2]!.elo);
  });

  it("centres Elo on the base (mean rating ≈ base)", () => {
    const names = ["a", "b", "c", "d"];
    const wins = [
      [0, 60, 80, 95],
      [40, 0, 65, 85],
      [20, 35, 0, 70],
      [5, 15, 30, 0],
    ];
    const ladder = fitBradleyTerry(names, wins, { base: 1500 });
    const mean = ladder.reduce((s, e) => s + e.elo, 0) / ladder.length;
    expect(mean).toBeCloseTo(1500, 4);
  });

  it("recovers a known Elo gap (≈54% ⇒ ~28 Elo)", () => {
    // A wins 54% of decisive games vs B. BT on a 2-player pool ⇒ elo gap = 400·log10(.54/.46).
    const ladder = fitBradleyTerry(["a", "b"], [
      [0, 540],
      [460, 0],
    ]);
    const gap = ladder[0]!.elo - ladder[1]!.elo;
    const expected = 400 * Math.log10(540 / 460);
    expect(gap).toBeCloseTo(expected, 1);
  });

  it("keeps ratings finite for an undefeated bot (smoothing)", () => {
    const ladder = fitBradleyTerry(["god", "mortal"], [
      [0, 100],
      [0, 0],
    ]);
    for (const e of ladder) expect(Number.isFinite(e.elo)).toBe(true);
    expect(ladder[0]!.name).toBe("god");
    expect(ladder[0]!.elo).toBeGreaterThan(ladder[1]!.elo);
  });

  it("tallies wins/losses/games from the matrix", () => {
    const ladder = fitBradleyTerry(["a", "b"], [
      [0, 30],
      [10, 0],
    ]);
    const a = ladder.find((e) => e.name === "a")!;
    expect(a.wins).toBe(30);
    expect(a.losses).toBe(10);
    expect(a.games).toBe(40);
  });

  it("formatLadder renders a row per bot, header included", () => {
    const ladder = fitBradleyTerry(["a", "b"], [
      [0, 30],
      [10, 0],
    ]);
    const lines = formatLadder(ladder).split("\n");
    expect(lines.length).toBe(2 + ladder.length); // header + rule + rows
    expect(lines[0]).toContain("elo");
  });
});
