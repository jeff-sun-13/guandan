# guandan.cards — the "Strategist" bot

**Source:** https://www.guandan.cards/arena/bot-infrastructure (the site owner's own writeup,
fetched 2026-06-23). guandan.cards is the friend's site that inspired this project — it does
what we're doing (single player vs Guandan bots). Its two known weaknesses, and our reasons for
existing, are **bad mobile UX** and **bots that aren't actually that strong** in practice
(`00-overview/vision.md`).

> This doc is internal reference. Per the human, the assessment here is **blunt** — the goal is
> to understand the competition's design honestly, not to be polite. The writeup itself reads as
> AI-generated (the human's words: "ai generated… of dubious quality").

---

## 1. The headline: this is NOT an RL bot
The biggest surprise, and the thing that flips the expectation: the "Strategist" **explicitly
rejects the DanZero deep-RL approach.** It is a **hand-engineered, interpretable expert system**
with **one small learned MLP** bolted on for probability calibration. His stated philosophy
(verbatim): *"encode the structure that is known — legality, decomposition, hard public facts —
and reserve learning for the residual judgments."* He pitches **"no neural dependency"** and
**"fully interpretable policy"** as the differentiator vs. the academic RL line.

So the competitive landscape is: two academic teams went pure deep-RL (DanZero/+); the friend
went the opposite way — rules-first, learning only the residual.

## 2. Architecture, as he describes it
The page has 8 sections; the substantive components:

- **Hand decomposition + "all-cost value model."** Cards are partitioned into combos (singles,
  pairs, triples, full houses, straights, tubes, plates, bombs); the system "grades multiple
  decompositions to find the power-maximal partition." The valuation: ***only bombs are
  positive*; every non-bomb card is a liability** whose cost "diminish[es] as they become harder
  to beat." Formula (verbatim): `strength(hand) = Σ bomb_value(c) − Σ non_bomb_cost(c)`.
- **A four-state "explicit decision machine."** Every decision is classified as **LEADING /
  FOLLOW_PARTNER / BEAT_ENEMY / BLOCK (FORCED_BOMB)**, each with dedicated candidate-selection
  logic. Moves are chosen by "residual comparison" over two currencies: **TEMPO** ("emptying the
  hand in few plays") and **CONTROL** ("holding the lead and dictating the next trick's shape").
- **A layered belief engine.** Separates *"what is logically impossible from what is merely
  unlikely."* Hard layer = card accounting + tribute deductions (these "clamp" cells they prove).
  Soft layer = a **belief matrix** whose cells are `P(a hidden player can play a given combo at a
  given rank)`.
- **The one learned component — an MLP calibrator.** *"A small MLP that scores every cell of an
  opponent's belief matrix,"* trained *"on self-play ground truth,"* filling the genuinely
  uncertain cells that no hard deduction settles. **No architecture, size, or training numbers
  disclosed.** (A shown figure even labels a state "No trained calibrator available," implying it
  isn't always active.)
- **Tribute as information (a genuinely good idea).** *"A paid tribute is, by rule, the giver's
  single highest non-wild card. That pins the card to the recipient and imposes a hard rank
  ceiling on the giver."* He turns the tribute rules into a hard logical deduction about hidden
  hands — something *both* academic papers ignore entirely.
- **A "belief-sampled / determinized search"** layer — weighted determinized hand sampling into
  "concrete worlds" for keep-lead / win-out gating. **He admits it is currently "scaffolding"
  and the hand-crafted rollouts are "noise-dominated"** (see §5).

## 3. The strength claims (the entire sales pitch)
Benchmarked **only against the released DanZero checkpoints**, 100 games each:
- **vs DanZero (DMC):** *"100–0, 100% win rate, 95% CI [96.3%, 100%]"*, +1.70 levels/hand.
- **vs DanZero Augmented (DanZero+):** *"99–1, 99.0%"*, CI ~[94.6%, 99.8%], +1.74 levels/hand.

i.e. near-perfect domination of *both* published academic agents.

## 4. What's conspicuously missing
- **No difficulty tiers.** Nothing about how the easier bots you actually face on the site are
  made. The page is only about the single top "Strategist."
- **No infrastructure** — despite the page being *titled* "bot-infrastructure," there is nothing
  about where it runs (browser/WASM vs server), latency, model size, or deployment. *"Code and
  checkpoints are not yet public."* The title is a misnomer; it's an approach writeup.
- **No training numbers** — no compute, no self-play counts, no calibrator size/params. (Contrast
  DanZero: 160 CPUs × 30 days, fully stated.)

## 5. His own admitted weaknesses (verbatim)
He is unusually honest about the soft spots — worth quoting because they tell us exactly where
he's beatable:
- **Hand-set coefficients:** *"The valuation weights are tuned by self-play but remain hand-set."*
- **Learned value head is experimental, not shipped:** *"An experimental variant replaces the
  final valuation with a one-ply learned value net."*
- **Search is low quality:** *"the current hand-crafted rollouts are noise-dominated"* — the
  determinized search is "scaffolding for a future fast learned leaf evaluator."

---

## 6. Blunt assessment
**It's more credible than typical AI-slop, but the load-bearing claim is unsubstantiated and
probably misleading.**

**What's genuinely good (don't dismiss it):**
- The **design is coherent and domain-aware** — not generic LLM filler. The all-cost value model
  (only bombs are assets), the four-state decision machine, and especially **tribute-as-hard-
  deduction** are real Guandan-specific insights from someone who understands the game. The
  tribute insight in particular is something *we should adopt* (`our-edge.md`) — it's free, exact
  information that both papers throw away.
- He's **honest about his weak spots** in a way hype pieces aren't. Admitting your search is
  "noise-dominated" is not marketing.

**Why the 100–0 / 99–1 numbers should not be believed as evidence of true strength:**
1. **Entirely self-reported and unreproducible** — "code and checkpoints not yet public." No
   independent verification possible.
2. **He benchmarks only against the public `q_network.ckpt`** (`reference-implementation.md` §9),
   which **may be a weak/old/under-trained checkpoint, not the 30-day model** from the paper.
   Beating a public checkpoint 100–0 says little about absolute strength.
3. **Plausible overfitting to a fixed opponent.** Hand-tuning coefficients against *one specific,
   static, deterministic* released model is exactly the setup where you can reach ~100% by
   exploiting that model's quirks — without being strong in general. A frozen reactive net is the
   easiest possible thing to farm.
4. **Internal tension:** by his own account the weights are hand-set, the rollouts are
   noise-dominated, and the learned value head is "experimental." A policy that admits all three
   reaching 100–0 against *both* published RL agents is more consistent with "the public baselines
   are weak / I overfit them" than with "I built a SOTA bot."
5. **No human or cross-tier evaluation** — so there is **zero evidence** about how strong the bots
   a real user faces on the site actually are. (Matches the human's lived experience: "in
   practice I don't find them to be very good.")

**Strategic read for us:** His differentiator is *interpretability + beating the public DanZero
checkpoints*, not raw strength by compute or search. His own honesty maps his weaknesses:
hand-tuned valuation, a noise-dominated search layer, and a tiny calibrator doing the only real
learning. A bot with a **proper decision-time search** and a **real learned leaf evaluator**
targets precisely the components he says are weakest. His headline number is best read as
**marketing against a possibly-weak baseline**, not a strength benchmark — until reproduced.

**The one thing to copy:** **tribute-as-deduction.** It's correct, exact, and free, and nobody
else does it. See `our-edge.md`.
</content>
