# Prior Art — Existing Guandan Bots & Research

Reference layer. These docs capture **everything we currently know about other people's
Guandan bots** — the two academic RL papers, the public code for one of them, and our
friend's competing site (guandan.cards). They exist so a future agent doing bot work can
get the full picture without re-reading papers and source trees.

Our north star is **the strongest Guandan bots anywhere** (`00-overview/vision.md`). You
cannot beat work you don't understand. Read this section before designing any bot past v1.

## What's here
- `danzero.md` — **DanZero** (arXiv 2210.17087, CoG 2023). The first published Guandan AI.
  Pure **Deep Monte-Carlo (DMC)** self-play. The foundational reference for state/action
  encoding. Read this first; the others build on it.
- `danzero-plus.md` — **DanZero+** (arXiv 2312.02561, 2023). The journal extension. Adds a
  **PPO refinement stage** on top of a frozen DMC model, using DMC to prune the action space.
- `reference-implementation.md` — notes on the **public code** for DanZero+
  (github.com/submit-paper/Danzero_plus): repo layout, exact encodings, the trained weights,
  and what it would take to port the ideas. The actual *rules engine* is a closed binary — a
  key gap that we fill ourselves.
- `guandan-cards-bot.md` — our friend's **"Strategist"** bot writeup on guandan.cards. NOT an
  RL bot — a hand-engineered interpretable policy with one small learned calibrator. Includes a
  blunt assessment of its (self-reported, unreproducible) claim to crush both papers.
- `our-edge.md` — **the opinionated synthesis.** Why all three fall short of "strongest
  anywhere," what they have in common, and the concrete openings we can exploit. This is the
  "how we do better" doc the human asked for. (Our *own* bot path is deferred — see the doc.)
- `landscape.md` — **the full map of Guandan-AI research** (not just the deep-dives): SDMC,
  GuanZero, the OpenGuanDan benchmark, LLM agents, competitions, and repos. Start here to decide
  what to read next for bot work past v1.
- `gs2.md` — deep dive on **GS2** (NeurIPS 2023 generative subgame solving): the serious
  game-theoretic Guandan work. Heavy (CFR on a DMC blueprint) — but its **diversity hand sampler**
  is a portable upgrade to PIMC determinization for our v2.
- `pimc-uct-2020.md` — deep dive on the **2020 PIMC+UCT** system: the earliest Guandan AI and our
  closest design precedent, but only *"marginally better than random."* The cautionary baseline —
  why naive PIMC needs ISMCTS + belief sampling + a leaf evaluator to be strong.

## The landscape at a glance

| Bot | Approach | Search? | Belief/opp. modeling? | Learns tribute? | Strength evidence |
|---|---|---|---|---|---|
| **DanZero** | DMC value net, self-play | ❌ none (reactive) | ❌ | ❌ heuristic | ~82–90% vs 2022 rule bots; ~60% vs 10 humans |
| **DanZero+** | DanZero + PPO over DMC's top-k | ❌ none (reactive) | ❌ | ❌ heuristic | ~86–93% vs rule bots; **only 55% vs DanZero**; 71/100 vs humans |
| **guandan.cards "Strategist"** | Hand-tuned heuristic + tiny MLP calibrator | ⚠️ "scaffolding", admits noise-dominated | ✅ belief matrix (rules + MLP) | ✅ uses tribute as deduction | self-reported **100–0 / 99–1** vs the public DanZero(+) checkpoints — unreproducible |
| **Ours (today)** | v1 heuristic | ❌ | ❌ | ❌ default policy | beats our v0 random 100% |

## The one-paragraph synthesis (full version in `our-edge.md`)
All three published/known systems are **reactive — they do no search at decision time.** The
two papers are opponent-blind self-play value nets; the friend's bot adds belief modeling and
admits its search layer is "noise-dominated." None of them learns the tribute phase. The
academic bots are validated only against weak 2022 rule bots and small human samples, and
DanZero+ improves on DanZero by a mere 55/45. **The clearest opening for a genuinely strong
bot is decision-time search over sampled hidden hands (PIMC/ISMCTS) plus real belief tracking
— exactly the things everyone here either skips or admits is their weak spot.** Our pure,
fast, deterministic engine (`03-engine/design.md`) is precisely the substrate that kind of
search needs.

## Confidence & sourcing notes
- Paper details were extracted from the **ar5iv HTML** renders (the arXiv PDFs are
  image-based). Two independent passes per paper agreed on the headline numbers. A few exact
  values (hidden-layer counts in DanZero, a "DMC vs DMC 46.55%" figure) are flagged **uncertain**
  in the per-doc notes. **Trust the code over the paper where they disagree** (the
  implementation reports state dims of 539/516, the paper says 513 — see
  `reference-implementation.md`).
- The guandan.cards numbers are **entirely self-reported** by the site owner; code and weights
  are not public, so they are unverified. Treat as marketing until reproduced.
- **"PerfectDan" does NOT exist** — it was an LLM hallucination in an early research pass (a blend
  of the real *PerfectDou* Doudizhu agent + DanZero), caught and corrected 2026-06-25. The real
  Guandan-AI field — including the genuine search-based work (GS2, a 2020 PIMC+UCT system) — is
  mapped in `landscape.md`.
