import { describe, it, expect } from "vitest";
import { makeRng, singleValue, isWild, type Observation } from "@guandan/engine";
import { playMatch, randomBot, makeBeliefSampler, type Bot } from "../src/index";

// Path A / ADR-0011: the match runner (arena) threads a public play history into every bot
// observation — the cross-trick passing record + the tribute exchange the memoryless engine drops.
describe("public history threading (ADR-0011)", () => {
  it("attaches a growing pass history + tribute to each bot observation", () => {
    const seen: Observation[] = [];
    const spy: Bot = (obs, legal, rng) => {
      seen.push(obs);
      return randomBot(obs, legal, rng);
    };
    playMatch([spy, randomBot, randomBot, randomBot], makeRng(5));

    // History is always present (the orchestrator fills it; the engine leaves it undefined).
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((o) => o.history !== undefined)).toBe(true);
    // The spy faced accumulated passes at least once (cross-trick signal exists).
    expect(seen.some((o) => (o.history?.passes.length ?? 0) > 0)).toBe(true);
    // Every recorded pass references a concrete top + a real seat/topPlayer.
    for (const o of seen)
      for (const p of o.history!.passes) {
        expect(p.top).toBeDefined();
        expect(p.seat).toBeGreaterThanOrEqual(0);
        expect(p.topPlayer).toBeGreaterThanOrEqual(0);
      }
    // Tribute is recorded for the deals that have one (after deal 1).
    expect(seen.some((o) => (o.history?.tribute.length ?? 0) > 0)).toBe(true);
  });

  it("belief sampler conditioned on history still produces card-consistent worlds", () => {
    let checked = 0;
    const sampler = makeBeliefSampler();
    const spy: Bot = (obs, legal, rng) => {
      if (obs.history && obs.history.passes.length > 0) {
        const w = sampler(obs, makeRng(99));
        expect(w.hands[obs.player]!.slice().sort()).toEqual(obs.hand.slice().sort()); // my hand preserved
        for (let p = 0; p < 4; p++) expect(w.hands[p]!.length).toBe(obs.handCounts[p]); // counts match
        checked++;
      }
      return randomBot(obs, legal, rng);
    };
    playMatch([spy, randomBot, randomBot, randomBot], makeRng(8));
    expect(checked).toBeGreaterThan(0);
  });

  it("tribute-aware sampling never deals a giver a non-wild card above their ceiling", () => {
    // Hard deduction (ADR-0011 Path A): a tribute giver paid their highest non-wild single, so a
    // sampled world must never put a higher non-wild card in their hand. Checked on real game obs
    // (where a feasible constrained deal always exists, since the actual deal is one).
    let checkedWorlds = 0;
    const sampler = makeBeliefSampler();
    const spy: Bot = (obs, legal, rng) => {
      if (obs.history && obs.history.tribute.length > 0) {
        for (let trial = 0; trial < 8; trial++) {
          const w = sampler(obs, makeRng(1000 + trial));
          for (const t of obs.history.tribute) {
            const ceil = singleValue(t.card, obs.level);
            for (const c of w.hands[t.giver]!) {
              if (!isWild(c, obs.level)) expect(singleValue(c, obs.level)).toBeLessThanOrEqual(ceil);
            }
          }
        }
        checkedWorlds++;
      }
      return randomBot(obs, legal, rng);
    };
    playMatch([spy, randomBot, randomBot, randomBot], makeRng(8));
    expect(checkedWorlds).toBeGreaterThan(0);
  });
});
