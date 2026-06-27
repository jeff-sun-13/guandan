# Engine Design

The engine is the crown jewel. Read `01-rules/rules.md` first — the engine implements it.
This doc describes the *shape* of the code, not the rules themselves.

## Design principles
1. **Pure & deterministic.** No I/O, no globals, no wall-clock, no `Math.random()`. All
   randomness comes from an injected seeded RNG. Same seed + same moves ⇒ identical game.
2. **Serializable state.** `GameState` is plain data (no class instances/closures) so it can
   be snapshotted, cloned cheaply, sent over a wire, and saved.
3. **Fast.** Bots will clone-and-simulate states millions of times. Favor compact
   representations (e.g., cards as small integers, hands as counts/bitsets) and cheap cloning.
4. **Total functions over state.** Transitions are `(state, move) -> state`. Validation is
   explicit. Illegal moves are impossible to apply (throw or are never generated).

## Core types (sketch — finalize in code)
- `Card` — compact encoding (rank + suit + which-deck). Likely a small integer.
- `Hand` — a player's cards (probably rank-count arrays for speed).
- `Combo` — a recognized play: `{ type, rank, cards, length }`.
- `Move` — `{ kind: 'play', combo } | { kind: 'pass' }`.
- `GameState` — `{ level, hands, currentTrick, leader, toAct, finishOrder, phase, rng, ... }`.
- `Observation` — the subset of `GameState` a single player may legally see.

## Key functions (public API surface)
- `createDeal(level, rng): GameState` — shuffle (seeded), deal 27 each, set leader.
- `legalMoves(state, player): Move[]` — all legal plays + pass for the player to act.
- `applyMove(state, move): GameState` — advance state; resolves trick wins, going out.
- `isTerminal(state): boolean` and `result(state): FinishOrder` — deal end + outcome.
- `observe(state, player): Observation` — hide other players' hidden cards. The `Observation`
  includes `outOfPlay` (cards no longer in any hand — public; derived, not stored) so bots can
  reason about the live-card pool. Also `outOfPlayCards(hands)` as a standalone helper.
- `determinize(obs, rng): GameState` — sample a full state consistent with an observation (the
  other seats' hidden hands drawn uniformly from the live pool, sized by `handCounts`). The
  foundation for PIMC/ISMCTS search bots (ADR-0007, `04-bots/v2-search-design.md`).
- Combo utilities: `detectCombo(cards)`, `beats(a, b)`, `enumerateCombos(hand)`.

## Why this enables strong bots
- `legalMoves` + `applyMove` + cheap clone = a simulator. A search bot (MCTS) and self-play
  training both need exactly this and nothing more.
- Because state is serializable, we can record games, build datasets, and replay
  deterministically for debugging.

## Testing strategy (most rigor goes here)
- Unit-test every combo type's detection and comparison, including wild-card substitution and
  every bomb-ordering edge case from `rules.md`.
- Property tests: `applyMove` never produces an illegal state; `legalMoves` are all actually
  legal; a full random game always terminates with a valid finish order.
- Golden/replay tests: record full games by seed and assert stable outcomes.
- Resolve every ⚠️ in `rules.md` with a corresponding test once confirmed.

## Performance (measured 2026-06-25 via `pnpm bench`, `tools/bench.ts`)
- Full random playout: **~1.58 ms/deal** (~143 moves) → **635 deals/s** single-threaded (Node).
- `legalMoves` on a fresh 27-card hand: **21.5 µs/call** — the hot path (confirms the `gotchas.md`
  wild-enumeration prediction); cheaper as hands deplete.
- `applyMove` 0.68 µs · `cloneState` 0.09 µs — cheap; cloning is not the bottleneck, enumeration is.
- Budget guide: ~127 full rollouts per 200 ms move. Enough to start PIMC; full random rollouts are
  the cost driver, so search uses a heuristic leaf and caps candidates (`04-bots/v2-search-design.md`).

## Open design questions
- Exact card/hand encoding (integers vs bitsets) — **now benchmarkable** (`pnpm bench`). The lever
  for faster search is `legalMoves`/wild enumeration (rank-count/bitset). Not blocking v2.
- How to represent wild-card combos canonically (a wild can stand for many things).
- Where tribute/return logic lives (likely a `match.ts` layer above single-deal `deal.ts`).
  *(Resolved: `match.ts` + `tribute.ts` exist.)*
- Belief-conditioned determinization (weight samples by the public record + tribute deductions) —
  `determinize` is currently uniform; this is a v2 upgrade (`04-bots/v2-search-design.md` step 4).
