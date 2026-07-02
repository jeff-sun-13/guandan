import { describe, it, expect } from "vitest";
import type { MatchContext, Player } from "@guandan/engine";
import { dealValue, dealValueCtx } from "../src/index";

// Team 0 = seats {0,2}, team 1 = seats {1,3}.
const F_12: Player[] = [0, 2, 1, 3]; // team 0 wins 1-2 (+3)
const F_13: Player[] = [0, 1, 2, 3]; // team 0 wins 1-3 (+2)
const F_14: Player[] = [0, 1, 3, 2]; // team 0 wins 1-4 (+1)

const atA = (declarer: number, other = 5): MatchContext => ({
  levels: declarer === 0 ? [14, other] : [other, 14],
  declarer,
  aStrikes: [0, 0],
});

describe("dealValue (standard mapping)", () => {
  it("maps partner finish to ±3/±2/±1 and is team-antisymmetric", () => {
    expect(dealValue(F_12, 0)).toBe(3);
    expect(dealValue(F_13, 0)).toBe(2);
    expect(dealValue(F_14, 0)).toBe(1);
    for (const f of [F_12, F_13, F_14]) expect(dealValue(f, 1)).toBe(-dealValue(f, 0));
  });
});

describe("dealValueCtx (match-aware, rules.md §7 + match.ts)", () => {
  it("without a context, or away from a declarer-at-A deal, equals dealValue", () => {
    expect(dealValueCtx(F_13, 0)).toBe(dealValue(F_13, 0));
    const midMatch: MatchContext = { levels: [7, 9], declarer: 1, aStrikes: [0, 0] };
    for (const f of [F_12, F_13, F_14]) {
      expect(dealValueCtx(f, 0, midMatch)).toBe(dealValue(f, 0));
    }
    const firstDeal: MatchContext = { levels: [2, 2], declarer: -1, aStrikes: [0, 0] };
    expect(dealValueCtx(F_12, 0, firstDeal)).toBe(dealValue(F_12, 0));
  });

  it("declarer at A: 1-2 and 1-3 are EQUAL match wins (+3), not +3 vs +2", () => {
    expect(dealValueCtx(F_12, 0, atA(0))).toBe(3);
    expect(dealValueCtx(F_13, 0, atA(0))).toBe(3);
  });

  it("declarer at A: a 1-4 'win' is a STRIKE — slightly negative, and WORSE than the standard +1", () => {
    const v = dealValueCtx(F_14, 0, atA(0));
    expect(v).toBeLessThan(0);
    expect(v).toBeGreaterThan(-1); // mild: still better than losing outright
  });

  it("declarer at A must prefer gambling for 1-2/1-3 over banking a 1-4 (the whole point)", () => {
    // A 50/50 between match-win and narrow loss must beat a certain 1-4 under the new mapping —
    // under the OLD mapping the certain +1 wins and the bot plays for the strike.
    const ctx = atA(0);
    const gamble = 0.5 * dealValueCtx(F_12, 0, ctx) + 0.5 * dealValueCtx([1, 0, 2, 3], 0, ctx);
    const bank = dealValueCtx(F_14, 0, ctx);
    expect(gamble).toBeGreaterThan(bank);
    const oldGamble = 0.5 * dealValue(F_12, 0) + 0.5 * dealValue([1, 0, 2, 3], 0);
    expect(oldGamble).toBeLessThan(dealValue(F_14, 0) + 1); // sanity: old mapping made banking look close
  });

  it("defenders vs a declarer-at-A get the inflicted strike as a bonus, capped at ±3", () => {
    const ctx = atA(0); // team 0 declares at A; value from team 1's view
    expect(dealValueCtx(F_14, 1, ctx)).toBeGreaterThan(0); // forcing the 1-4 = forcing a strike
    const win1 = dealValueCtx([1, 0, 2, 3], 1, ctx); // team 1 wins 1-4 (mag 1)
    expect(win1).toBeGreaterThan(dealValue([1, 0, 2, 3], 1)); // better than the standard +1
    const win3 = dealValueCtx([1, 3, 0, 2], 1, ctx); // team 1 wins 1-2 (mag 3)
    expect(win3).toBe(3); // capped
  });

  it("stays on the [-3, 3] leaf scale and is team-antisymmetric for every finish", () => {
    const finishes: Player[][] = [F_12, F_13, F_14, [1, 3, 0, 2], [1, 0, 2, 3], [3, 0, 1, 2]];
    for (const declarer of [0, 1]) {
      const ctx = atA(declarer);
      for (const f of finishes) {
        const v0 = dealValueCtx(f, 0, ctx);
        expect(Math.abs(v0)).toBeLessThanOrEqual(3);
        expect(dealValueCtx(f, 1, ctx)).toBeCloseTo(-v0, 10);
      }
    }
  });
});
