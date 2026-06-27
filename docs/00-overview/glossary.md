# Glossary

Use these exact terms in code and docs to avoid confusion.

## Guandan game terms
- **Level (级牌 / level card):** the rank a team is currently "playing at" (starts at 2,
  goes up toward A). The card of that rank is specially powerful this deal.
- **Wild card (逢人配 / 红桃级牌):** the Heart-suit card of the current level rank. Acts as a
  wildcard that can substitute for (almost) any card. There are two in the double deck.
- **Tribute (进贡):** at the start of a deal, the losing side gives its best card to the
  winning side, based on last deal's finishing order.
- **Return tribute (还贡):** the receiver gives back a low card.
- **Deal / round:** one full play-out of 108 cards until 3 players have emptied their hands.
- **Match / game:** a sequence of deals; ends when a team wins at level A.
- **Trick / play:** the unit of play — a player leads a combo, others beat it or pass.
- **Combo types:** Single, Pair, Triple, Triple+Pair (full house), Straight (顺子),
  Consecutive Pairs (三连对 / "tube"), Consecutive Triples (钢板 / "steel plate"), Bomb,
  Straight Flush, Joker Bomb. Authoritative definitions: `01-rules/rules.md`.
- **Bomb:** 4+ of a kind (and straight flushes); beats any non-bomb and bombs of lower rank.
- **Going out:** emptying your hand. Finish order (1st/2nd/3rd/4th) drives scoring & tribute.
- **Double down (双下):** the losing team's two players finish 3rd and 4th — biggest loss.

## Project terms
- **Engine:** the pure rules library (`packages/engine`). No UI, no I/O.
- **GameState:** the full serializable state of a deal at a point in time.
- **Move / Action:** a legal thing a player can do (play a combo, or pass).
- **Bot:** a function `(observableState) -> Action`. Lives in `packages/bots`.
- **Observable state:** what a single player can legally see (their hand + public info),
  as opposed to the full GameState. Bots must only use observable state.

## Bot / RL terms (for prior-art & bot work — see `06-prior-art/`)
- **DanZero / DanZero+:** the two published academic Guandan RL bots, and our main prior art.
  See `06-prior-art/danzero.md` and `danzero-plus.md`.
- **DMC (Deep Monte-Carlo):** the RL method both papers use — a neural net regresses Q(state,
  action) toward the *final episodic return* (no bootstrapping). Cheap, high-variance, reactive.
- **PPO (Proximal Policy Optimization):** the policy-gradient method DanZero+ adds on top of a
  frozen DMC net, choosing among DMC's top-k candidate actions.
- **Reactive bot:** picks a move by scoring the current state only, with **no lookahead/search**.
  All three known Guandan bots are essentially reactive — our planned edge is to *not* be.
- **Determinization:** sampling a concrete full-information world (a specific assignment of the
  hidden cards) consistent with what's been observed, so a perfect-information search can run on
  it. Aggregate over many samples to act under uncertainty.
- **PIMC (Perfect-Information Monte-Carlo):** run a perfect-info search on many determinizations
  and vote. **ISMCTS (Information-Set MCTS):** MCTS that searches over information sets directly.
  These are the search families behind our intended bot v2 (`04-bots/roadmap.md`).
- **Belief / opponent modeling:** inferring the distribution over opponents' hidden hands from
  the public record (plays, passes, **tribute**). The academic bots skip this; we want it.
- **Tribute-as-deduction:** the tribute card is, by rule, the payer's highest non-wild single, so
  it pins a known card to the receiver and caps the payer's rank — *exact* hidden-hand info. The
  friend's bot uses it; the papers ignore it; we should adopt it (`06-prior-art/our-edge.md`).
