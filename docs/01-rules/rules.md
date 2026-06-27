# Guandan Rules — Authoritative Spec

> **Status: CONFIRMED (2026-06-22).** The engine implements THIS document. All previously-open
> questions were resolved with the human and against the source of truth, Pagat
> (https://www.pagat.com/climbing/guan_dan.html). History of how each was decided lives in
> `open-questions.md`. If a rule needs to change, change it here and add a test.

## 1. Setup
- 4 players in 2 partnerships; partners sit **opposite** each other (seats N/S vs E/W).
- **Two standard 54-card decks** combined = **108 cards** (two physical copies of every card,
  including 2 small jokers and 2 big jokers).
- Each player is dealt **27 cards**.
- Each team tracks a **level**, starting at **2**, running **2 → 3 → … → 10 → J → Q → K → A**.
- The match is won only from level **A** (see §7).

## 2. Card ranking
Normal singles rank low → high:
`2 3 4 5 6 7 8 9 10 J Q K A` → **current level rank** → **small joker** → **big joker**.
- The **level rank** card is elevated to just below the jokers for **singles, pairs, triples,
  full houses, and bombs** (e.g., when the level is 7, a pair of 7s beats a pair of Aces).
- **Inside a straight, tube, or plate the level card counts at its NATURAL value, never
  elevated** (when the level is 7, a 7 can sit in 6-7-8-9-10 but not "above the Ace").
- Suits are irrelevant to rank **except** for the Straight Flush.

## 3. The Wild Card (红桃级牌 / Heart level card)
- The wild card is the **Heart-suit card of the current level rank**. With two decks there are
  **two** wild cards in play each deal.
- A wild may substitute for **any card except a joker** when forming a combo, including helping
  to form **bombs** and **straight flushes** (where it also takes whatever suit is needed).
- **Two wilds may be used in a single combo.**
- A wild played as a bare **single** counts as the level-rank single (just below the jokers).

## 4. Combinations (legal "plays")
A trick is led with one combo; each later play must be the **same type and strictly higher**,
or **a bomb** (§5). Combo families:
- **Single** — 1 card.
- **Pair** — 2 cards of the same rank.
- **Triple** — 3 cards of the same rank.
- **Full House (三带二)** — a triple + a pair; compared by the **triple's** rank.
- **Straight (顺子)** — **exactly 5** consecutive single ranks. The Ace may be **high**
  (10-J-Q-K-A) or **low** (A-2-3-4-5). **No wrap-around** (Q-K-A-2-3 is illegal). Suits need
  not match.
- **Tube / Consecutive Pairs (三连对)** — **exactly 3** consecutive pairs (e.g., 7-7-8-8-9-9).
- **Plate / Consecutive Triples (钢板)** — **exactly 2** consecutive triples (e.g.,
  8-8-8-9-9-9).
- **Bombs** — see §5.

Straight/tube/plate use the same Ace-high-or-low, no-wrap rule.

## 5. Bombs
A bomb beats any non-bomb. Among themselves bombs rank, **weakest → strongest**:

1. **4-of-a-kind** (4-card bomb)
2. **5-of-a-kind**
3. **Straight Flush (同花顺)** — 5 consecutive cards of one suit
4. **6-of-a-kind**
5. **7-of-a-kind**
6. **8-of-a-kind**
7. **9-of-a-kind**
8. **10-of-a-kind**
9. **Joker Bomb (四王 / 天王炸)** — all four jokers (2 big + 2 small) — the highest play

- So the straight flush sits **above the 5-card bomb and below the 6-card bomb.**
- Numeric bomb sizes range **4 to 10**.
- Among two numeric bombs of the **same size**, the higher rank wins (level rank elevated as in
  §2). Among two straight flushes, the higher top card wins.
- The joker bomb is unique and unbeatable.
- Wild cards may complete any bomb or straight flush.

## 6. Playing a deal
- **Leader of the first trick:** for the **very first deal of a match**, chosen by the seeded
  RNG. For every later deal, set by tribute (§8) — the tribute payer leads, or if tribute was
  cancelled, the player who finished 1st in the previous deal leads.
- The leader plays any legal combo. Going clockwise, each player plays a strictly higher combo
  of the **same type** (or any bomb), or **passes**.
- When all other active players pass in succession, the last player who played **wins the
  trick** and leads the next one with any combo. (A player who has gone out is skipped.)
- Emptying your hand = **going out**; play continues among the rest.
- The deal ends when **3 players are out**; the remaining player finishes **4th**.

## 7. Finishing order, scoring, winning the match
The winning team's two finishing positions set how many levels they advance:
- **1st & 2nd** ("double down" on the opponents, 双下) → **+3 levels**
- **1st & 3rd** → **+2 levels**
- **1st & 4th** → **+1 level**

("1st" = the team that took first place; the partner's finishing position sets the bonus.)

- **Winning the match:** only a team **already at level A** that finishes **1-2 or 1-3** wins.
  Reaching A is not enough — you must then score a 1-2 or 1-3 from A.
- **Stalling at A:** a team at A that does not finish 1-2/1-3 stays at A (it cannot advance
  past A).
- **A-level demotion:** if a team is the declarer at level A **three times** (not necessarily
  consecutive) without winning, after the third failure it is **demoted to level 2** and its
  failure count resets.

## 8. Tribute (进贡) and Return (还贡) — between deals
Determined by the previous deal's finishing order:
- **1-2 finish (双下, the winners took 1st & 2nd):** **both** losing opponents pay tribute. The
  player who finished **1st** receives the **higher-ranked** of the two tribute cards; their
  partner receives the other.
- **1-3 or 1-4 finish:** the player who finished **last (4th)** pays one tribute card to the
  player who finished **1st**.
- **Tribute card:** the payer's **highest-ranked single card, excluding the wild Heart-level
  card**, given face up.
- **Return tribute:** each receiver gives one unwanted card back to the opponent they received
  from. It must be **different from the tribute card**; **no rank cap** otherwise.
- **Anti-tribute / resist (抗贡):**
  - After a **1-2** finish, tribute is cancelled if **each** opponent holds one big (red) joker,
    **or** one opponent holds **both** big jokers.
  - After a **1-3 / 1-4** finish, tribute is cancelled if the **last-place** player holds
    **both** big jokers.
- **Leadership:** the tribute payer (the higher-ranked payer in a 1-2 finish) leads the first
  trick of the next deal. If tribute is cancelled, the previous 1st-place finisher leads.

---
### Source & confidence
All rules above are **confirmed** against Pagat (cited) plus human product decisions, recorded
in `open-questions.md` (resolved 2026-06-22). Where guandan.cards is later observed to differ
on a fine point (e.g., tube/plate Ace handling), note it in `gotchas.md` and decide case by
case — Pagat is canonical by default.
