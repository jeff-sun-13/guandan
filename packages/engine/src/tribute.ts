// Tribute (进贡) and return tribute (还贡) between deals — rules.md §8. These are pure helpers
// over the freshly dealt hands of the NEXT deal plus the PREVIOUS deal's finishing order. The
// orchestrator (above the engine) applies the exchanges to the hands and starts the deal with
// the leader this computes.
//
// Forced parts are deterministic here: who pays, the tribute card (highest non-wild single),
// anti-tribute detection, and the leader. The RETURN card is a strategic choice; we expose a
// reasonable default (`defaultReturnCard`) that a smarter bot can later override.

import { type Card, BIG_JOKER, isWild, singleValue } from "./cards";
import { type Player, teamOf } from "./state";

export interface Tribute {
  payer: Player;
  receiver: Player;
  card: Card;
}

export interface TributePlan {
  /** True if anti-tribute (抗贡) cancels the whole exchange. */
  cancelled: boolean;
  /** The tribute(s) to pay (empty when cancelled). */
  tributes: Tribute[];
  /** Who leads the next deal: the (higher) tribute payer, or the previous 1st if cancelled. */
  leader: Player;
}

/** The card a player must pay as tribute: their highest single, excluding the wild. (-1 if none.) */
export function highestTributeCard(hand: Card[], level: number): Card {
  let best = -1;
  let bestVal = -1;
  for (const c of hand) {
    if (isWild(c, level)) continue;
    const v = singleValue(c, level);
    if (v > bestVal) {
      bestVal = v;
      best = c;
    }
  }
  return best;
}

function countBigJokers(hand: Card[]): number {
  let n = 0;
  for (const c of hand) if (c === BIG_JOKER) n++;
  return n;
}

/**
 * Work out the tribute for the upcoming deal from the previous deal's finishing order and the
 * new hands. Two shapes (rules.md §8):
 *   - "double down" (winners 1-2, losers 3rd & 4th): BOTH losers pay; the 1st-place finisher
 *     gets the higher card, their partner the other; the higher payer leads.
 *   - otherwise (1-3 / 1-4): the last-place player pays the 1st-place player and leads.
 * Anti-tribute cancels everything when the paying side holds both big jokers.
 */
export function planTribute(
  finishOrder: Player[],
  hands: Card[][],
  level: number,
): TributePlan {
  const first = finishOrder[0] as Player;
  const second = finishOrder[1] as Player;
  const third = finishOrder[2] as Player;
  const last = finishOrder[3] as Player;
  const winningTeam = teamOf(first);

  // "Double down" = the losing team took 3rd AND 4th (i.e. winners finished 1-2).
  const doubleDown = teamOf(third) !== winningTeam && teamOf(last) !== winningTeam;

  if (doubleDown) {
    const payerA = third;
    const payerB = last;
    // Anti-tribute: the paying side (both losers) holds both big jokers.
    const bigJokers =
      countBigJokers(hands[payerA] as Card[]) + countBigJokers(hands[payerB] as Card[]);
    if (bigJokers === 2) {
      return { cancelled: true, tributes: [], leader: first };
    }
    const cardA = highestTributeCard(hands[payerA] as Card[], level);
    const cardB = highestTributeCard(hands[payerB] as Card[], level);
    // Higher card -> 1st place; its payer leads. Ties: payerA (the higher finisher) leads.
    const aIsHigher = singleValue(cardA, level) >= singleValue(cardB, level);
    const higherPayer = aIsHigher ? payerA : payerB;
    const higherCard = aIsHigher ? cardA : cardB;
    const lowerPayer = aIsHigher ? payerB : payerA;
    const lowerCard = aIsHigher ? cardB : cardA;
    return {
      cancelled: false,
      tributes: [
        { payer: higherPayer, receiver: first, card: higherCard },
        { payer: lowerPayer, receiver: second, card: lowerCard },
      ],
      leader: higherPayer,
    };
  }

  // Single tribute: last place pays first place.
  if (countBigJokers(hands[last] as Card[]) === 2) {
    return { cancelled: true, tributes: [], leader: first };
  }
  const card = highestTributeCard(hands[last] as Card[], level);
  return {
    cancelled: false,
    tributes: [{ payer: last, receiver: first, card }],
    leader: last,
  };
}

/**
 * A default return-tribute card: the receiver's lowest-value card that isn't the tribute card
 * they just received (the only hard constraint — rules.md §8, no rank cap). A future bot can
 * choose differently.
 */
export function defaultReturnCard(hand: Card[], tributeCard: Card, level: number): Card {
  let best = -1;
  let bestVal = Infinity;
  let usedTribute = false;
  for (const c of hand) {
    if (!usedTribute && c === tributeCard) {
      usedTribute = true; // skip exactly one copy of the received tribute card
      continue;
    }
    const v = singleValue(c, level);
    if (v < bestVal) {
      bestVal = v;
      best = c;
    }
  }
  return best;
}
