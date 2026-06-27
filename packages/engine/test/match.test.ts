import { describe, it, expect } from "vitest";
import { makeRng } from "../src/rng";
import {
  createMatch,
  dealLevel,
  scoreDeal,
  applyDealResult,
  isMatchOver,
  MAX_LEVEL,
  type MatchState,
} from "../src/match";

/** Build a match state with explicit fields (test helper). */
function match(partial: Partial<MatchState>): MatchState {
  return {
    levels: [2, 2],
    declarer: null,
    aStrikes: [0, 0],
    winner: null,
    rng: makeRng(1),
    ...partial,
  };
}

describe("scoreDeal — finish pattern -> advance", () => {
  it("1-2 (partner 2nd) = +3", () => {
    const s = scoreDeal([0, 2, 1, 3]); // team0 took 1st & 2nd
    expect(s).toMatchObject({ winningTeam: 0, pattern: "1-2", advance: 3 });
  });
  it("1-3 (partner 3rd) = +2", () => {
    const s = scoreDeal([0, 1, 2, 3]); // team0 took 1st & 3rd
    expect(s).toMatchObject({ winningTeam: 0, pattern: "1-3", advance: 2 });
  });
  it("1-4 (partner 4th) = +1", () => {
    const s = scoreDeal([0, 1, 3, 2]); // team0 took 1st & 4th
    expect(s).toMatchObject({ winningTeam: 0, pattern: "1-4", advance: 1 });
  });
  it("works for team 1 too", () => {
    expect(scoreDeal([1, 3, 0, 2])).toMatchObject({ winningTeam: 1, pattern: "1-2" });
  });
});

describe("dealLevel", () => {
  it("first deal is played at level 2", () => {
    expect(dealLevel(createMatch(makeRng(1)))).toBe(2);
  });
  it("later deals are played at the declarers' level", () => {
    expect(dealLevel(match({ declarer: 1, levels: [4, 7] }))).toBe(7);
  });
});

describe("applyDealResult — promotion & declarer", () => {
  it("winners promote, losers stay put, winners become declarers", () => {
    const m0 = createMatch(makeRng(1)); // [2,2], no declarer
    const m1 = applyDealResult(m0, [0, 2, 1, 3]); // team0 1-2 (+3)
    expect(m1.levels).toEqual([5, 2]);
    expect(m1.declarer).toBe(0);
    expect(m1.winner).toBeNull();
  });

  it("promotion caps at A (cannot pass it)", () => {
    const m = match({ levels: [13, 5], declarer: 1 }); // team0 at K, declarer is team1 (not at A)
    const next = applyDealResult(m, [0, 2, 1, 3]); // team0 1-2 (+3) -> 16, capped to 14
    expect(next.levels[0]).toBe(MAX_LEVEL);
    expect(next.winner).toBeNull(); // declarers weren't on A, so no win
  });
});

describe("applyDealResult — winning the match (declarers on A)", () => {
  it("declarers on A finishing 1-2 win the match", () => {
    const m = match({ levels: [14, 6], declarer: 0 });
    const next = applyDealResult(m, [0, 2, 1, 3]); // team0 (declarers, on A) 1-2
    expect(next.winner).toBe(0);
    expect(isMatchOver(next)).toBe(true);
  });

  it("declarers on A finishing 1-3 win the match", () => {
    const m = match({ levels: [14, 6], declarer: 0 });
    expect(applyDealResult(m, [0, 1, 2, 3]).winner).toBe(0); // 1-3
  });

  it("declarers on A finishing only 1-4 do NOT win, and take a strike", () => {
    const m = match({ levels: [14, 6], declarer: 0, aStrikes: [0, 0] });
    const next = applyDealResult(m, [0, 1, 3, 2]); // team0 1-4
    expect(next.winner).toBeNull();
    expect(next.aStrikes[0]).toBe(1);
    expect(next.levels[0]).toBe(MAX_LEVEL); // stalls at A
  });

  it("a non-declarer on A does not win by finishing 1-2 (must be the declarers)", () => {
    // team0 is on A but team1 is the declarer (deal played at team1's level).
    const m = match({ levels: [14, 6], declarer: 1 });
    const next = applyDealResult(m, [0, 2, 1, 3]); // team0 finishes 1-2 but isn't declaring
    expect(next.winner).toBeNull();
    expect(next.levels[0]).toBe(MAX_LEVEL); // already capped
    expect(next.declarer).toBe(0); // now they become declarers, can win next time
  });
});

describe("applyDealResult — three-strikes demotion", () => {
  it("a third failed attempt on A demotes the declarers to level 2 and resets strikes", () => {
    const m = match({ levels: [14, 6], declarer: 0, aStrikes: [2, 0] });
    // declarers (team0) on A fail again (team1 wins this deal) -> 3rd strike -> demote.
    const next = applyDealResult(m, [1, 3, 0, 2]); // team1 1-2
    expect(next.levels[0]).toBe(2); // demoted
    expect(next.aStrikes[0]).toBe(0); // reset
    expect(next.levels[1]).toBe(9); // team1 promoted 6 -> +3
    expect(next.declarer).toBe(1);
    expect(next.winner).toBeNull();
  });

  it("strikes accumulate across separate A-attempts before demotion", () => {
    let m = match({ levels: [14, 6], declarer: 0 });
    m = applyDealResult(m, [0, 1, 3, 2]); // 1-4: strike 1, still declarer on A
    expect(m.aStrikes[0]).toBe(1);
    expect(m.declarer).toBe(0);
    m = applyDealResult(m, [0, 1, 3, 2]); // 1-4: strike 2
    expect(m.aStrikes[0]).toBe(2);
    expect(m.levels[0]).toBe(14);
    m = applyDealResult(m, [0, 1, 3, 2]); // 1-4: strike 3 -> demote
    expect(m.levels[0]).toBe(2);
    expect(m.aStrikes[0]).toBe(0);
  });
});
