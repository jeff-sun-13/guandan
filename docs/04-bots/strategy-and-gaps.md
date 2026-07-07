# Guandan strategy & our bot's gaps (2026-06-30)

> **2026-07-06 addendum — read with the measured results.** The paired harness (ADR-0013) re-tested
> this doc's priority list: the cheap hand-coded levers (Part 3 #1–#3) measured null-to-small
> (tribute pins suggestive +0.05 @z≈1.9; run-out/perType/endgame-solve individually below
> resolution; pass-history HURTS), value-leaf distillation failed decisively (z=−3.91, ADR-0015),
> and the search-budget lever RE-OPENED (1200>600 at z=3.04 — the "tapped out" claim was partly
> instrument artifact). The active route is now **expert iteration** (ADR-0015): the learned-policy
> route this doc's Part 3 #4 pointed at, entered via search-stat distillation rather than RL.
> Strategy content below (Parts 1–2, the run-out framework) remains the reference.

Why this exists: after the search-budget curve plateaued (knee ~1200–1800 iters, changelog 2026-06-29)
we started the information axis (history threading, ADR-0011) and got a *sobering, narrow* first result
(cross-trick passing = no gain). To avoid drawing the wrong conclusion, we did first-principles thinking
about Guandan strategy and a code-grounded audit of what our bot actually uses. This is the synthesis —
the guiding reference for bot work from here. Grounded in the frozen rules (`docs/01-rules/rules.md`).

## The one-sentence gap
**A weak player optimizes their own hand trick-by-trick; a strong player treats the deal as a
collapsing perfect-information puzzle — counting every card, reading every play AND pass, tracking the
bomb ladder and the jokers — and spends all of it to control which of their PAIR finishes 1st and 2nd.**
Our bot does the counting (at the set level) and searches well, but does almost none of the per-opponent
reading, bomb/endgame craft, or partnership coordination beyond "don't beat partner."

---

## Part 1 — What strong Guandan actually requires (ranked by win-rate impact)

Two rules shape everything: (a) **you win by your PAIR's joint finishing order** (1-2=+3, 1-3=+2,
1-4=+1) — not by winning tricks or going out first yourself; (b) **two decks** ⇒ exactly 2 of each card,
4 jokers, 2 wilds ⇒ card-counting is tractable and decisive.

1. **Partnership objective — optimize the PAIR's joint position, not your own.** The scoring is steeply
   convex in coordination. The biggest weak-play error is racing yourself out while partner heads to 4th.
   Route tempo/bombs to whichever partner is better placed; sometimes *don't* go out so you can escort
   partner (turn a 1-4 into a 1-2/1-3). Also defensive: spend material to break the *opponents'* 1-2.
2. **Endgame control / tempo.** "Control" = the right to lead. Whoever leads the thinned-out endgame with
   low-but-unbeatable cards just runs them and goes out. Track, per combo+rank, **who can still beat it**
   (counting twos makes "is my pair of Ks unbeatable now?" knowable) and each opponent's remaining
   *stoppers*. Take a trick only when it changes finishing order or denies an opponent a winning run;
   don't win a trick that strands you on lead with a bad shape.
3. **Bomb economy & the over-bombed trap.** A bomb only buys control if **nothing can over-bomb it**
   (hierarchy: 4<5<straight-flush<6..<10<joker bomb). The named failure mode: fire your bomb to grab a
   lead, get over-bombed, and be left holding one beatable card → stranded into 4th. Avoid it by (a)
   tracking which bigger bombs are still *live* (census of jokers/copies), (b) firing a bomb only when it
   **converts to a finishing position** (yours or partner's) or defensively, (c) not entering the endgame
   in a "lone high card + bomb" shape, (d) baiting out a bigger bomb with a small one to make yours the nut.
4. **Per-opponent hand modeling from plays AND passes.** Maintain a live per-seat belief, weighted by
   reliability:
   - *Near-certain (treat as facts):* dead ranks (both copies seen ⇒ no pair/bomb there); a pass on a
     contested low lead ⇒ no higher single they'll spend; tribute pins an exact card + caps the giver's
     top; joker/wild census.
   - *Strong priors:* high-card depletion ("dumped tops early ⇒ weak up top late"); combo-family voids
     (never plays pairs ⇒ pair-poor); exit-shape from count + style.
   - Reliability scales with how much the passer *wanted* the trick — engineer cheap leads to force
     informative passes (active probing).
5. **Card-counting discipline** (the substrate under 2–4): jokers (4), wilds (2), live bombs per rank,
   which of your own cards are now unbeatable.
6. **Tribute as information** (highest-density, once per deal): exact card pinned to receiver; rank
   ceiling on the giver (non-joker tribute ⇒ no joker ⇒ your singles run); the resist/anti-tribute
   outcome leaks big-joker locations; the return card pins another exact card.
7. **Signalling conventions** (real but lower, opponent-dependent, and they leak to opponents): low-lead =
   "help me / take over", high-lead = "I've got it"; high-low choices encoding remaining strength;
   deliberate passes as "this is yours, partner." For OUR bot pair these are a big edge vs any
   non-coordinating opponent — but determinized search structurally can't *send* them (see Part 3).

---

## The "run-out" framework (human player, 2026-06-30) — the core concept for leaf evaluation

The strongest single framing the human gave, and the spine of the leaf/endgame work:

- **The core question every turn is "can I make a RUN for the win?"** — seize tempo with bombs + high
  cards, shed everything else, and **go out** before anyone interrupts. A hand wins out when it has
  **enough bombs (tempo control) and few enough "garbage" cards (loose singles/odd cards that must be
  shed)**. So **(bombs) vs (garbage/loose cards) is the key ratio** for "runnability."
- **Bombs are mostly a LATE-game asset — hold them, but not absolutely.** You sometimes bomb **early for
  tempo**; most of the time you hold for the endgame run. The policy must be contextual, not a fixed
  threshold (today's heuristic bombs only on `opponent ≤ 4` — too crude).
- **Track bombs AND *potential* bombs others may have — this information is significant.** Whether your
  bomb is safe (won't be over-bombed) depends on which bigger bombs can still exist; compute the live
  bomb/joker census from `outOfPlay`. This is what avoids the **over-bomb trap** (bomb for the lead, get
  over-bombed, stranded with garbage → 4th).
- **The tail risk is interruption:** your run gets cut off and you're stuck with garbage. Weighing this
  risk (how likely is an opponent to interrupt, given the bomb census + their likely holdings) is central.
- **TEAM play overrides solo runs:** sometimes you **sacrifice-bomb when you're nowhere near winning**, to
  yank tempo back **for your partner's** run. The leaf objective is already the pair's +3/+2/+1, but the
  *rollout policy* must actually play this way (bomb to rescue/enable partner, not just self).
- Open question (human): how predictable is an opponent's singles/pairs/garbage-vs-bombs balance, and how
  much does modeling it help? (Unknown — measure if/when per-opponent modeling is revisited.)

**How this maps to code:** the static leaf (`static-eval.ts`) should value a hand by its **run-out
potential** — reward bombs *more* when the hand is otherwise close to running out (low loose-card count),
penalize garbage, and fold in the live-bomb census (is my tempo safe?) — not a flat `+0.6/bomb`. The
rollout policy (`heuristic.ts`) should bomb **to start/continue a winning run, to seize the final lead, or
to rescue partner's run** — and **avoid bombing into a likely over-bomb that strands it**. Gate every
change on the ladder vs the current champion.

## ⚠️ History threading is REQUIRED — we MUST revisit it (do not read "parked" as "abandoned")
Per-opponent modeling, tribute-deduction, and signalling are essential to world-class play. Our first
hand-coded attempt (Path A) was neutral-to-harmful and we don't fully understand why (impl bug vs a
structural mismatch with determinized-reweighting search). It is **parked, not dropped — a future agent
MUST come back to it.** Full methodology + the open question + the likely learned-route home are in
**ADR-0011** (see its MUST-REVISIT notice). Do not let this fall off the roadmap.

## Part 2 — What our bot uses vs ignores (code-grounded)

**Uses:**
- **Set-level card counting** — `determinize()` samples hidden hands from `fullDeck − myHand − outOfPlay`
  by per-seat count. It knows *which cards are gone*, but `outOfPlay` is **unattributed** (no who-played-what).
- **Hard tribute ceiling** — `determinizeWithTribute()` (belief.ts): a giver can't be dealt a non-wild card
  above what they paid; constructive constrained dealing. The one genuinely per-player, sharp constraint.
- **Soft passing plausibility** — `makeBeliefSampler()` reweights 6 uniform worlds by a cross-team
  "could-have-followed" penalty (current-trick always; cross-trick when history is threaded).
- **Search** — ISMCTS over public move signatures, partner modeled as a cooperative co-searcher; objective
  = team +3/+2/+1 (correct). Leaf = heuristic rollout (bomb only if an opponent ≤4 cards) or static eval.

**Ignores (the gaps):**
1. **Per-player attribution of played cards** → no opponent depletion/void model. *The single largest
   blind spot.* (`outOfPlay` is a set; `PublicHistory` records passes+tribute but **not plays**.)
   *(2026-07-01: plays are now RECORDED per seat (ADR-0014) — consumption beyond pin-tracking is
   still open; the planned consumer is policy-likelihood belief, see status.md.)*
2. Voids/shortages as *hard accumulated* constraints (only used as a weak soft reweight).
3. Play-shape inference (what leading a single vs pair vs triple reveals).
4. **Partner hand-modeling & signalling** (partner sampled like an opponent; can't read or send signals).
5. **Endgame bomb management** beyond the single `opponentMinCount ≤ 4` threshold; no bomb sequencing,
   no go-out-bomb, no counting opponents' live bombs.
6. Tribute **exact pinning** — ✅ **DONE 2026-07-01** (ADR-0014): tribute card pinned into the
   receiver's sampled hand, return card into the giver's, resist pins/excludes the big jokers; pins
   consumed as seen played. Gated A/B (`ismcts-rollout-trib`) in the experiment queue.
7. Rollout opponents are a fixed weak heuristic; no mixed strategy.

---

## Part 3 — Priorities & the honest meta-take

**The mechanism matters as much as the signal.** Reweighting 6 uniform determinizations cannot represent
a sharp, conjunctive, per-player posterior — under uniform sampling the constraints are almost always
violated, so the penalty is ~constant and the reweight is ~a no-op. **That is why cross-trick passing
scored 0**, and why the one win (tribute) works: it *abandons* reweighting for **constructive constrained
dealing**. So "use more history" via the current sampler is largely a dead end; it must be rebuilt
constructively, and even then the upside is uncertain.

Recommended sequence (strength-per-effort):
1. **Leaf / rollout quality — especially endgame bomb management.** Cheap, architecture-free, evaluated
   every iteration, and per the 2026-06-29 note a better leaf "shifts the curve up AND moves the knee
   right" — i.e. *re-opens the tapped-out budget lever*. Concrete: endgame-scaled bomb value,
   bomb-to-go-out, count live bombs/jokers from `outOfPlay`, credit straights/tubes in `playsToEmpty`.
2. **Tribute exact pinning** (gap #6) + let the running rollout tribute A/B conclude. Near-free; settles
   whether the hand-coded belief route has any remaining payoff.
3. **Per-player constructive belief** (gaps #1/#2) — ONLY if rebuilt as constrained dealing (generalize
   the tribute dealer to arbitrary per-seat exclusions), and ONLY if gated on a measured win on the
   *rollout champion*.
4. **The learned policy (ADR-0010) is the real home for the information + coordination + signalling axis.**
   A net ingests the full public history for free (counting, tribute, play-attribution) and self-play can
   *discover* the partnership conventions that determinized search cannot even send. This is where the
   "strongest coordinating bot pair" goal ultimately points.

**Meta-take:** hand-coded belief-sampling has ~one cheap exact win left (tribute pinning); beyond that the
information/signalling axis favors learning. The cheap, certain win *right now* is **leaf/endgame quality**
(it doesn't touch belief at all). See ADR-0011 (history threading) and ADR-0010 (learned leaf) — they are
tightly coupled, and this analysis strengthens the case that the info axis wants the learned route.
