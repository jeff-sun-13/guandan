# Strategy decisions — where human steering is needed

The campaign so far has been driven by *measurable* choices an agent can settle alone ("build X, run
`pnpm eval`, keep it if it wins"). The decisions below are **not** like that — they trade off cost,
risk, and what "strong" even means, so they need the human (Jeff). This doc frames each fork with the
current evidence and a recommendation, so it's something to react to rather than a blank page.

_Last updated: 2026-06-28. Maintain this when a decision is made (record it as an ADR and note it here)._

## What we know right now (the evidence these decisions rest on)
- **The champion is a SEARCH bot, not a trained one.** No training loop, no GPU, no learned weights in
  the champion. It thinks at move time by simulating many guessed deals (PIMC → ISMCTS + belief +
  rollout leaf). Strategic basis: we win on *method, not compute* (`06-prior-art/our-edge.md`, ADR-0007).
- **NEW (2026-06-28): strength is strongly compute-elastic.** Giving the champion 4× the search budget
  (150→600 ISMCTS iters) beat the old champion **96.9%** (changelog 2026-06-28). The rollout leaf does
  NOT plateau like the old static-leaf search did. → *Cranking search budget is, right now, the
  cheapest strength lever we have* — bounded only by move-time.
- **We just made rollouts 1.29× faster** (purely, no strength change) → ~29% more iterations per
  move-budget. More throughput converts directly into more strength now.
- **The catch:** every result above is measured **only against our own bots**. We do not yet know how
  strong the champion is against *external / independent* opponents (the OpenGuanDan/DanZero yardstick).

---

## Decision 1 — Search-first forever, or invest in a learned bot? (the pivotal one)
**The fork.** Keep climbing with decision-time search (more budget, faster rollouts, better belief),
or commit to **Phase 2 of the learned leaf** — a trained net that scores positions in microseconds
(ADR-0010), i.e. the academic/DanZero direction, scoped down.

**Tradeoffs.**
- *Search-first:* no GPU, interpretable, already beats everything we have, and today's finding says it
  still has headroom via budget. But it's **slow** (~0.6–2 s/move) and its ceiling is bounded by the
  rollout policy's quality + how much compute you'll spend per move.
- *Learned leaf (Phase 2):* potentially **much stronger AND ~20× faster at play time** — but it's a
  real ML project (richer encoding, bigger net, probably self-play RL, a GPU box, iteration), and
  carries the overfitting risk (Decision 3).

**What today's findings change.** Two-sided. (a) Search-first looking more attractive *short-term*
(budget is paying off cheaply). (b) But the **goal needs both strong AND fast** (you + partner playing
the bots — memory `goal-bot-pair-vs-human-team`, `prefers-final-product`), and pure search can't give
both: 2 s/move strong vs fast-but-weaker. The learned leaf is the only known path to *both*. So
search-first is the better *near-term* spend; the learned leaf is likely the *eventual* requirement.

**Recommendation.** Keep harvesting the cheap search/budget/throughput wins now (they're paying off),
**but** treat Phase-2 learned leaf as the real ceiling-raiser and start it once the cheap search wins
flatten — *gated by Decision 3 first* (don't pour ML effort into beating ourselves). **Needs from you:**
appetite for an ML project (GPU spend + weeks of iteration) — yes / not yet / never.

## Decision 2 — How much compute and money to spend?
**The fork.** Bigger/longer cloud boxes (and maybe a GPU for training) cost real money + your attention.
The 8-vCPU Hetzner box is fine for first reads; high-power batches and any training want more.
**Recommendation.** Set a rough monthly compute budget (e.g. "$X/mo, occasional $Y burst"). It bounds
everything else — batch sizes, whether Phase 2 is feasible, how hard we can crank search budget.
**Needs from you:** a number (even loose), and "delete idle boxes" hygiene (the live box bills while up).

## Decision 3 — Build the external yardstick before spending more on "strength"? (I'd treat as urgent)
**The fork.** Every strength number is vs our own bots. ADR-0008 already says *measure off our own
baseline before more algorithm work* — and today we did more algorithm work (the budget crank) and got
a headline number that is, strictly, "we beat ourselves." That's the exact trap we mocked the
guandan.cards bot for. The plan (OpenGuanDan referee + DanZero opponent) needs **your machine**
(Java + downloads) — it's the one thing an agent can't fully do alone.
**Recommendation.** **Do this soon — likely before Decision 1's Phase 2.** Without an independent
opponent we can't tell real strength from baseline-overfit, and we'd be flying blind into expensive ML.
**Needs from you:** a session on your machine to stand up OpenGuanDan + a DanZero checkpoint (an agent
can drive it, but you run the Java/downloads).

## Decision 4 — Partner coordination / conventions (only a player can steer)
**The fork.** Your goal is a *coordinating bot PAIR* vs a human team. Today the bot models its partner
as either a greedy heuristic (PIMC) or a cooperative searcher (ISMCTS) — but there are **no conventions
or signaling** (real Guandan partners have understandings: "I led low to tell you X"). Related untapped
edge: **tribute-as-deduction** (the opening tribute leaks hand info we don't yet exploit; needs the
history-threading architecture, a separate ADR).
**Recommendation.** Lower priority than 1–3, but it's where a *human who plays the game* adds something
an agent can't infer. When ready, describe the conventions you and your partner would actually find
natural to play against, and we'll encode + measure them.
**Needs from you:** (later) a description of the partnership conventions worth modeling.

---

## Suggested order
1. **Decision 3** (external yardstick) — soon; unblocks honest measurement, needs your machine.
2. **Decision 2** (compute budget) — quick; bounds the rest.
3. **Decision 1** (search-first vs learned Phase 2) — after 3, so we invest with real feedback.
4. **Decision 4** (coordination) — when you want to bring play-knowledge in.

Meanwhile, the agent keeps harvesting the cheap, safe, measured wins (search budget + engine
throughput) that don't require any of these decisions — see `progress/status.md` for live state.
