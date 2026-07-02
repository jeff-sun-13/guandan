// Deal-outcome valuation — the objective every search bot optimizes. Two mappings:
//
// dealValue: the standard per-deal +3/+2/+1 by the winners' partner finish. This was copy-pasted
// in pimc/ismcts/gen-data; new code should import from here.
//
// dealValueCtx: the MATCH-AWARE mapping (2026-07-01). The standard mapping is materially WRONG at
// level A (rules.md §7 + match.ts): when the declarers are at A,
//   - a declarer 1-2 or 1-3 wins the WHOLE MATCH (they're equally terminal — the +3 vs +2
//     distinction vanishes);
//   - a declarer 1-4 is a STRIKE (no level progress — A is capped — and the 3rd strike demotes to
//     level 2), not a "+1 win";
//   - a declarer LOSS is that strike PLUS the opponents' promotion.
// The unconditioned search therefore prefers a safe, worthless 1-4 over gambling for the 1-2/1-3
// that actually wins — exactly backwards at the match-deciding deals. DanZero encodes the same
// correction in its reward (docs/06-prior-art/danzero.md §2: "at level A reward is 0 unless the
// partner finishes 2nd or 3rd"); ours keeps a small salvage/denial term instead of a flat 0
// because denying the opponents' promotion still has real match value.
//
// All outputs stay on the [-3, 3] scale — the ISMCTS leaf contract (see IsmctsOptions.leaf).

import { teamOf, MAX_LEVEL, type Player, type MatchContext } from "@guandan/engine";

/** Standard per-deal value from `team`'s view: ±3/±2/±1 by the winners' partner finish. */
export function dealValue(finish: Player[], team: number): number {
  const winTeam = teamOf(finish[0] as Player);
  const winSeats = [0, 1, 2, 3].filter((s) => teamOf(s) === winTeam);
  const winPos = winSeats.map((s) => finish.indexOf(s)).sort((a, b) => a - b);
  const partnerPos = winPos[1] as number;
  const mag = partnerPos === 1 ? 3 : partnerPos === 2 ? 2 : 1;
  return winTeam === team ? mag : -mag;
}

/**
 * Match-aware deal value from `team`'s view. Without a context (or away from a declarer-at-A
 * deal) it is exactly `dealValue`. When the declarers sit at A:
 *   declarer 1-2/1-3  → ±3    (match win/loss — both patterns identical and terminal)
 *   declarer 1-4      → ∓0.5  (a strike + zero progress: mildly BAD for the declarers,
 *                              mildly good for the defenders who forced it)
 *   defender win m    → ±(0.75·m + 0.75)  (their normal promotion PLUS the inflicted strike;
 *                              m=3 caps at ±3)
 */
export function dealValueCtx(finish: Player[], team: number, ctx?: MatchContext): number {
  if (!ctx || ctx.declarer < 0 || ctx.levels[ctx.declarer as 0 | 1] !== MAX_LEVEL) {
    return dealValue(finish, team);
  }
  const declarer = ctx.declarer;
  const winTeam = teamOf(finish[0] as Player);
  const raw = Math.abs(dealValue(finish, winTeam)); // 1 | 2 | 3, the winners' pattern magnitude

  let vDeclarer: number; // value from the DECLARING team's perspective
  if (winTeam === declarer) {
    vDeclarer = raw >= 2 ? 3 : -0.5; // 1-2/1-3 → match won; 1-4 → strike, nothing gained
  } else {
    vDeclarer = -Math.min(3, 0.75 * raw + 0.75); // opponents promote AND we take a strike
  }
  return team === declarer ? vDeclarer : -vDeclarer;
}
