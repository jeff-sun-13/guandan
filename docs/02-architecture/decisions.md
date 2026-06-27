# Architecture Decision Log (ADRs)

Append-only. Newest at top. Each entry: date, decision, why, alternatives, status.

---
## ADR-0009 — Compute strategy: git → cloud eval boxes; optimize the TS engine (no native rewrite yet)
**Date:** 2026-06-26 · **Status:** Accepted
**Decision:** (a) Put the project under **git** and push to a remote, so any machine can clone it.
(b) Run heavy strength evals on **cloud CPU boxes**, not the dev machine — the parallel harness pins
every core (one worker per core) and the champion is seconds/move, so a real campaign overwhelms a
laptop. `tools/remote/setup.sh` bootstraps a fresh Ubuntu box (Node 24 + pnpm + install) to run
`pnpm eval`/`pnpm ladder` headless. (c) Cut compute *per game* by optimizing the **TypeScript**
engine (the `legalMoves` bitset re-encoding, task #4) and smarter evals (sequential testing/early
stopping) — **keep the one shared TS engine; do NOT rewrite it in a native language yet.**
**Why:** The bottleneck the human hit is real and worth solving for a long campaign, but the first
levers are *more cores* (cloud, ~$0.30–1.50/hr for 32–64 vCPU spot/auction; pay-per-use) and *less
work per game* (bitset), not a language change. A native/WASM hot-loop port is ~2–5× but forks the
"one engine runs in the browser AND Node" design (ADR-0001) and is real maintenance — premature while
algorithmic + horizontal scaling are untapped. The same cloud box later serves learned-leaf self-play
data generation + training.
**Alternatives:** (a) Keep evaluating only on the dev machine — rejected (strains it, caps campaign
throughput). (b) Rewrite the engine in Rust/Go now — rejected as premature (see above); revisit at
M4 if throughput still binds after bitset + cloud. (c) GPU box now — only needed once the learned
leaf (training) starts; CPU boxes suffice for search-bot eval.
**Revisit when:** bitset + cloud still bind (then a Rust/WASM headless engine for eval/training,
keeping TS for the browser), or the learned-leaf track needs GPUs.

---
## ADR-0008 — Bot-strength campaign: measurement-first, external benchmark before more algorithm work
**Date:** 2026-06-26 · **Status:** Accepted (governs the active bot-strength track)
**Decision:** Treat bot strength as a long campaign whose **instruments come before its experiments.**
Concretely: (a) the eval harness runs in **parallel across CPU cores** (child-process workers,
`tools/parallel.ts`), pooling additive counts into the exact single-thread numbers (`poolResults`);
(b) bot strength is summarized by a **Bradley-Terry rating ladder** (`pnpm ladder`, `rating.ts`) —
one Elo per bot on a shared scale, not just pairwise win rates — fit by Zermelo/MM iteration, chosen
over sequential Elo because it's order-independent and fits the whole round-robin at once; (c) before
investing in stronger search/learning we build an **external benchmark** (OpenGuanDan referee engine
+ DanZero opponent, over their WebSocket interface) so strength is validated **off our own heuristic
baseline.** A learned value/leaf net stays **deferred but explicitly on the table** (human, 2026-06-26),
to be reopened as its own ADR once pure search plateaus (extends ADR-0007's "revisit when").
**Why:** A months-long campaign that only ever measures vs our own v1 heuristic would risk the exact
failure we documented for the guandan.cards bot — a headline win rate that's **overfit to a weak
baseline** (`06-prior-art/our-edge.md` §1.5). An external, independent opponent is the only honest
yardstick for the "strongest anywhere" goal. Parallel eval + a shared-scale ladder make the
inner loop (run an experiment, see if it's really stronger and by how much) fast and unambiguous —
single-threaded eval capped strong-bot sweeps at ~30 games (`gotchas.md`, 2026-06-25).
**Alternatives:** (a) Jump straight to ISMCTS measured vs our own bots — rejected as the first step;
faster to a "stronger" number but can't tell real strength from baseline overfit. (b) Sequential Elo
for the ladder — rejected (order-dependent). (c) Reimplement an opponent's rules to benchmark
in-house — rejected; their engines are closed/Java, and OpenGuanDan refereeing both players over a
socket removes the rule-variant-mismatch risk entirely.
**Revisit when:** pure search plateaus below strong external opponents → the learned-leaf ADR opens
(reopening ADR-0007's deferred training question).

---
## ADR-0007 — Bot v2 = client-side determinized search (ISMCTS/PIMC); no training pipeline yet
**Date:** 2026-06-25 · **Status:** Accepted (this is the active bot-strength direction)
**Decision:** Bot v2 is **decision-time search that runs entirely client-side in TypeScript** — the
PIMC/ISMCTS family — with **no offline neural-net training pipeline for now.** It is built directly
on the pure engine's simulator (`legalMoves` + `applyMove` + cheap `cloneState`). To support it the
engine gains two small, pure additions: (a) a public **`outOfPlay: Card[]`** field on `Observation`
(cards no longer in any hand — needed to sample hidden hands), and (b) a **`determinize(obs, rng)`**
helper that returns a full `GameState` with the other seats' hidden hands sampled consistently with
the observation. Design + the research basis live in `docs/04-bots/v2-search-design.md`.
**Why:** The prior-art study (`docs/06-prior-art/`) showed the existing bots (DanZero/DanZero+, the
guandan.cards bot) are all **reactive — no real decision-time search** — and the academic ones are
**opponent-blind**. Search over sampled hidden hands attacks exactly those gaps and needs only a
fast engine, which we already have — no 30-CPU-week training run (DanZero's cost). It fits the
client-only M1/M2 product (ADR-0003) and the human's "document-now-decide-training-later" steer.
GS2 (NeurIPS 2023) confirms search beats the DMC line head-to-head, but its CFR machinery needs a
trained value net + server compute — out of scope; we borrow its *idea* (diversity hand sampling),
not its stack (`docs/06-prior-art/gs2.md`).
**Alternatives:** (a) Train a DanZero-style DMC/PPO net and ship weights — deferred; expensive and
the human hasn't opted in. (b) Keep iterating the v1 heuristic — lower ceiling; no lookahead. (c)
Put play-history/belief state in the engine `GameState` — rejected, keeps the rules pure (ADR-0002);
`outOfPlay` is *derived* in `observe()`, not stored, and determinization lives in its own file.
**Known risk (from prior art):** the 2020 PIMC+UCT Guandan system was only "marginally better than
random" (`docs/06-prior-art/pimc-uct-2020.md`). So **naive uniform-sample + random-rollout PIMC is
the floor to clear, not the goal** — plan for ISMCTS (over infosets, to fight strategy fusion in
2v2), belief-conditioned sampling, and a heuristic/learned leaf evaluator (v1 is the first leaf).
**Revisit when:** pure search plateaus below strong-human play — then a learned leaf evaluator
(offline-trained, weights shipped) becomes the next ADR, reopening the deferred training question.

---
## ADR-0006 — Web hand model uses stable card keys; table history lives in the controller
**Date:** 2026-06-23 · **Status:** Accepted
**Decision:** In `apps/web`, (a) the human's hand is modeled as `Slot = { key, card }` with a stable
key per physical card, and selection + manual groups are sets of keys; (b) per-trick table history
("who last played/passed", winning combo persisting) is derived and stored in the controller
(`useGuandanGame`), NOT in the engine. The engine remains untouched and pure.
**Why:** Grouping must survive re-sorts and other copies being played — sorted-position selection
(the prior approach) can't, since positions shift. Stable keys also keep the double-deck duplicate
fix. Table history is a presentation concern; the rules engine only needs the current trick top, so
adding history there would bloat `GameState` and violate the purity directive (ADR-0002). The
controller already sees every move (human via `play`/`pass`, bots via `stepBot`), so logging there
is free.
**Alternatives:** (a) Keep position-based selection — rejected, can't support persistent groups.
(b) Add a move/history log to engine `GameState` — rejected; couples rules to UI needs and grows the
state bots must clone millions of times. **Revisit when:** multiplayer needs a server-authoritative
move log — then a history layer belongs in the match/server layer, still above the pure deal engine.

---
## ADR-0005 — M1 web UI runs bots on the main thread (not a Web Worker yet)
**Date:** 2026-06-23 · **Status:** Accepted (revisit at bot v2)
**Decision:** The M1 web app drives bots on the main thread via a timed loop in
`useGuandanGame` (a `setTimeout` between plays, ~750ms, so moves are watchable). This deviates
from ADR-0003 / `05-frontend/design.md`, which call for bots in a Web Worker.
**Why:** v0/v1 bots compute effectively instantly, so a worker adds message-passing and
serialization complexity with no current benefit, and slows shipping a playable game. The
async/timed boundary is already isolated in one place (`stepBot`), so moving it behind a worker
later is a localized change.
**Alternatives:** Web Worker now — rejected as premature for instant bots.
**Revisit when:** bot v2 (determinized MCTS) lands and bot "thinking" could block the UI; move
`stepBot` into a worker then. Tracked in `gotchas.md` and `05-frontend/design.md`.
Also note: M1 auto-resolves tribute (incl. the human's) with the engine default return-card
policy and shows the result, rather than prompting the human — to be upgraded with bot v1.

---
## ADR-0004 — `legalMoves` emits one wild-minimal play per (type, rank, length)
**Date:** 2026-06-22 · **Status:** Accepted (revisit for v2+ bots)
**Decision:** The move generator (`packages/engine/moves.ts`) enumerates combos by TYPE (not by
subset), emitting each distinct (type, rank, length) play exactly once, formed with the FEWEST
wild cards necessary (naturals first). It does NOT also emit the wild-spending variant of a play
that is already formable without wilds, nor every choice of which pair to attach to a full house.
**Why:** Keeps the move list compact and generation fast (the hot path for search bots), avoids a
2^27-subset blowup, and conserves wilds by default — correct behavior for v0/v1. The classifier
(`classify`) still recognizes ALL interpretations, so legality/validation is unaffected.
**Alternatives:** (a) Enumerate every physical realization incl. wild-spend variants — rejected
now as combinatorially heavy and unnecessary for current bots. (b) Defer wild choice to the move
applier — rejected; the Move must carry concrete cards to stay a total `(state, move) -> state`.
**Revisit when:** a v2+ bot demonstrably benefits from deliberately spending a wild on an
otherwise-natural combo; then add opt-in wild-spend variants. Tracked in `moves.ts` + gotchas.

---
## ADR-0003 — Client-only for M1 (no server yet)
**Date:** 2026-06-22 · **Status:** Accepted
**Decision:** M1 ships as a fully client-side static web app; bots run in the browser
(in a Web Worker to keep the UI responsive). No backend, accounts, or DB until M3.
**Why:** Fastest path to something playable on the human's phone; forces engine correctness
first; free hosting.
**Alternatives:** Server-authoritative from day one — rejected as premature complexity.

---
## ADR-0002 — Engine is a pure, dependency-free TS package
**Date:** 2026-06-22 · **Status:** Accepted
**Decision:** All game rules live in `packages/engine` with no UI/network/IO and no runtime
dependencies. Randomness is injected via a seeded RNG. State is plain serializable data.
**Why:** A strong bot must simulate millions of games headlessly; rules tangled into UI make
that impossible. Purity also makes the engine exhaustively testable.
**Alternatives:** Rules inside React/server code — rejected (kills the bot goal).

---
## ADR-0001 — TypeScript everywhere, pnpm monorepo
**Date:** 2026-06-22 · **Status:** Accepted
**Decision:** Single TS codebase for engine/bots/web/server, managed as a pnpm workspace.
**Why:** One engine reused in browser and Node; best agent tooling; human can read TS.
**Alternatives:** Python engine + JS frontend (two languages, porting overhead) — rejected
since agents do the coding and a shared engine is worth more than the human's Python comfort.
