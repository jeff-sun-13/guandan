# Rules — Open Questions

Resolve these with the human (and by observing guandan.cards) before locking the M1 engine.
Mark each ✅ confirmed / ❌ rejected / ✏️ revised with the answer and date.

**Source of truth:** https://www.pagat.com/climbing/guan_dan.html (Pagat). Cited as [Pagat]
throughout. Resolved 2026-06-22 (human answers + Pagat reading by agent).

## Combos
- ✅ **Straight = exactly 5 cards.** No other lengths. (human + [Pagat])
- ✅ **A-low (A-2-3-4-5) and A-high (10-J-Q-K-A) both legal.** (human + [Pagat])
- ✅ **Tube = exactly 3 consecutive pairs; Plate = exactly 2 consecutive triples.** (human +
  [Pagat])
- ✅ **No wrap-around straights** (Q-K-A-2-3 illegal; A only at the two ends above). (human +
  [Pagat])

## Level rank & wild cards
- ✅ **Level rank sits above Ace, below the small (black) joker** for singles/pairs — i.e. the
  trump rank order top is: big joker > small joker > level rank > A > K > … (human + [Pagat])
- ✅ **Inside straights/tubes/plates the level card counts at its NATURAL value, never
  elevated.** (human + [Pagat])
- ✅ **Wild card = the level-rank card of Hearts (2 copies in the 2-deck game).** It can
  substitute for any card EXCEPT a (big/small) joker, and CAN be used to form bombs and
  straight flushes. (human + [Pagat])
- ✅ **Two wilds in one combo allowed** (e.g. both Heart-level wilds in one bomb). (human +
  [Pagat])

## Bombs
- ✅ **Bomb power ordering, weakest → strongest:**
  4-card < 5-card < **straight flush (同花顺)** < 6-card < 7-card < 8-card < 9-card < 10-card
  < four-joker bomb. Straight flush sits above 4- and 5-card bombs and below the 6-card bomb;
  four-joker is the absolute top. (human + [Pagat])
- ✅ **Bomb sizes range from 4 up to 10 cards.** (human + [Pagat])
- ✅ **Joker bomb = exactly all four jokers** (both big + both small). No 3-joker special.
  (human + [Pagat])

## Flow, scoring, tribute
- ✅ **First deal of the MATCH — leader = seeded-random.** [Pagat]'s physical "drew the
  face-up card" rule has no digital analog, so deal 1's leader is chosen via the injected
  seeded RNG (human, 2026-06-22). All SUBSEQUENT deals: leader determined by tribute (below).
- ✅ **Level-up mapping: 1-2 finish = +3, 1-3 = +2, 1-4 = +1** levels for the winning team.
  ("1-x" = winning team took 1st and partner took x-th place.) (human + [Pagat])
- ✅ **Match win:** only by a team that is ON level A scoring a **1-2 or 1-3** finish. A team
  can reach A but cannot win except via 1-2/1-3 at A. **Demotion:** a team that is declarers on
  level A three times (not necessarily consecutive) without winning is demoted to level 2 and
  the failure count resets. **Demotion IS implemented** (human, 2026-06-22). Match starts both
  teams at level 2; levels run 2→3→…→10→J→Q→K→A (human, 2026-06-22).
- ✅ **Tribute (进贡) — who pays & to whom:**
  - **1-2 finish (双下 / "double down"):** BOTH losing opponents pay tribute (their highest
    single, non-wild). The player who finished 1st last hand receives the higher-ranked of the
    two tribute cards; their partner receives the other.
  - **1-3 and 1-4 finish:** the player who finished LAST pays one tribute card to the player
    who finished 1st.
  - **Tribute card** = payer's highest-ranked single card, face up, **excluding the wild
    Heart-level card.**
  - **Return tribute:** each receiver gives one unwanted card back to the opponent they
    received from; it must differ from the tribute card. **No rank cap** — any card other than
    the tribute card may be returned (the ≤10 variant is NOT used; human, 2026-06-22).
  - **Anti-tribute (抗贡):** after a 1-2 win, tribute is cancelled if each opponent holds one
    big (red) joker, or one opponent holds both big jokers. After a 1-3/1-4 win, cancelled if
    the last-place player holds both big jokers. (human "two big jokers" ✓ + [Pagat])
- ✅ **Tribute changes the next deal's leader:** the player who PAYS the (higher-ranked)
  tribute leads the first trick of the next deal. If tribute was cancelled (anti-tribute), the
  player who finished 1st last hand leads. (human + [Pagat])

## Source-of-truth strategy
- ✅ **Canonical reference = Pagat's Guan Dan page** (https://www.pagat.com/climbing/guan_dan.html).
  Where guandan.cards visibly differs, note it and decide case-by-case. (human)

---

**All open questions resolved 2026-06-22.** The remaining product choices (first-deal leader,
return-tribute cap, A-demotion, level range) were decided by the human and folded into the
answers above. The rules are ready to freeze into `01-rules/rules.md` and drive the M1 engine.
