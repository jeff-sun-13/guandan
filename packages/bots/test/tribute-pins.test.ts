import { describe, it, expect } from "vitest";
import {
  makeRng,
  createDeal,
  observe,
  BIG_JOKER,
  type Observation,
  type PublicHistory,
  type Card,
  type Player,
} from "@guandan/engine";
import { makeBeliefSampler } from "../src/index";

/**
 * Build an observation for seat 0 of a fresh deal, with a synthetic public history attached.
 * The tribute pins reference real cards, so we pick them out of the actual dealt hands — the
 * sampler only sees the OBSERVATION (hand + counts + outOfPlay) and must re-derive who holds what.
 */
function freshObs(seed: number, history: PublicHistory): { obs: Observation; hands: Card[][] } {
  const state = createDeal(2, makeRng(seed), 0);
  const obs = { ...observe(state, 0), history };
  return { obs, hands: state.hands };
}

const sampler = makeBeliefSampler({ useTributeInfo: true });

describe("tribute exact-card pins in constrained determinization (2026-07-01)", () => {
  it("pins the tribute card into the receiver's sampled hand, every world", () => {
    // Seat 3 paid its top card to seat 1 and got a return card back. From seat 0's view, every
    // sampled world must place that exact tribute card in seat 1's hand (it's public knowledge).
    const { obs, hands } = freshObs(11, { passes: [], plays: [], tribute: [] });
    const tributeCard = (hands[3] as Card[])[26] as Card; // any card seat 3 actually holds
    const returnCard = (hands[1] as Card[])[0] as Card;
    obs.history = {
      passes: [],
      plays: [],
      tribute: [{ giver: 3, receiver: 1, card: tributeCard, returnCard }],
    };
    // NOTE: hands in the observation are the DEALT hands (we did not physically exchange), so the
    // pin targets cards that exist in the pool — which is all the sampler can check anyway.
    for (let k = 0; k < 20; k++) {
      const w = sampler(obs, makeRng(100 + k));
      expect(w.hands[1]).toContain(tributeCard);
      expect(w.hands[3]).toContain(returnCard);
    }
  });

  it("a 'single' resist pins BOTH big jokers to the resister", () => {
    const { obs } = freshObs(12, {
      passes: [],
      plays: [],
      tribute: [],
      resist: { kind: "single", holders: [2] },
    });
    for (let k = 0; k < 20; k++) {
      const w = sampler(obs, makeRng(200 + k));
      const bigJokers = (w.hands[2] as Card[]).filter((c) => c === BIG_JOKER);
      // Both copies not in seat 0's own hand / outOfPlay must be with the resister.
      const inMyHand = obs.hand.filter((c) => c === BIG_JOKER).length;
      expect(bigJokers.length).toBe(2 - inMyHand);
    }
  });

  it("a 'double' resist keeps big jokers OUT of the previous winners' hands", () => {
    // Winners were seats 0 (me) and 2; losers 1 and 3 resisted → they jointly hold the big jokers.
    const { obs } = freshObs(13, {
      passes: [],
      plays: [],
      tribute: [],
      resist: { kind: "double", holders: [1, 3] },
    });
    for (let k = 0; k < 20; k++) {
      const w = sampler(obs, makeRng(300 + k));
      expect((w.hands[2] as Card[]).includes(BIG_JOKER)).toBe(false); // the hidden winner
    }
  });

  it("a pin is consumed once the pinned card is seen played by that seat", () => {
    const { obs, hands } = freshObs(14, { passes: [], plays: [], tribute: [] });
    const tributeCard = (hands[3] as Card[])[26] as Card;
    const returnCard = (hands[1] as Card[])[0] as Card;
    obs.history = {
      passes: [],
      plays: [
        // Receiver (seat 1) already played the tribute card → the pin must NOT re-add it.
        {
          seat: 1,
          cards: [tributeCard],
          combo: { type: "single", rank: 2, cards: [tributeCard], length: 1 } as never,
        },
      ],
      tribute: [{ giver: 3, receiver: 1, card: tributeCard, returnCard }],
    };
    // Sampled worlds must still be COUNT-consistent (the real assertion: no crash, counts right,
    // and the consumed pin doesn't force the card back into seat 1's hand in every world).
    let seenWithout = false;
    for (let k = 0; k < 30; k++) {
      const w = sampler(obs, makeRng(400 + k));
      for (let p = 0; p < 4; p++) expect((w.hands[p] as Card[]).length).toBe(obs.handCounts[p]);
      if (!(w.hands[1] as Card[]).includes(tributeCard)) seenWithout = true;
    }
    expect(seenWithout).toBe(true);
  });

  it("worlds remain card-consistent with the observation under pins (full-deck check)", () => {
    const { obs, hands } = freshObs(15, { passes: [], plays: [], tribute: [] });
    const tributeCard = (hands[2] as Card[])[26] as Card;
    const returnCard = (hands[0] as Card[])[0] as Card; // giver is me → giver-side pin skipped
    obs.history = {
      passes: [],
      plays: [],
      tribute: [{ giver: 0, receiver: 2, card: tributeCard, returnCard }],
    };
    for (let k = 0; k < 10; k++) {
      const w = sampler(obs, makeRng(500 + k));
      const all = [...(w.hands[0] as Card[]), ...(w.hands[1] as Card[]), ...(w.hands[2] as Card[]), ...(w.hands[3] as Card[]), ...obs.outOfPlay]
        .sort((a, b) => a - b);
      // Every card id appears exactly twice across hands + outOfPlay (double deck, nothing lost).
      const counts = new Map<number, number>();
      for (const c of all) counts.set(c, (counts.get(c) ?? 0) + 1);
      for (const [, n] of counts) expect(n).toBe(2);
      expect(w.hands[2]).toContain(tributeCard);
    }
  });
});
