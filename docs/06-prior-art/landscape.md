# Guandan AI — the full research landscape

A map of *all* known Guandan-AI work, not just the three bots we studied in depth. Use this to
decide what to read next when pushing bot strength past v1. The deep-dive docs
(`danzero.md`, `danzero-plus.md`, `guandan-cards-bot.md`) cover the most important ones; this
doc places them in context and lists everything else.

> **Sourcing & confidence.** Compiled 2026-06-25 from a multi-search literature sweep (primary
> arXiv / journal / proceedings URLs cited inline). Items marked ⚠️ are **lower-confidence**:
> either behind JS-gated IEEE pages (author lists approximate) or unaccepted preprints. Treat the
> arXiv-primary items as solid; verify the ⚠️ ones before relying on details.

---

## ⚠️ First: "PerfectDan" is NOT real — do not cite it
An earlier research pass (and this is a cautionary tale) **hallucinated** a search-based Guandan
agent called "PerfectDan." Five independent searches confirm **no such paper, repo, competition
entry, or agent exists.** It was almost certainly a name-blend of two real things:
- **PerfectDou** — *"PerfectDou: Dominating DouDizhu with Perfect Information Distillation"*,
  NeurIPS 2022, arXiv **2203.16406** (NetEase Games AI Lab / SJTU / CMU). This is for **Doudizhu,
  NOT Guandan**, and it's **RL** (perfect-info distillation guiding PPO), not search.
- **DanZero** — the "Dan" half.

Lesson for future agents: an unverified name surfaced in an LLM's *own commentary* (vs. quoted
from a source) is a fabrication risk. Verify before documenting. We caught this one.

---

## The two dominant research clusters
1. **USTC — Houqiang Li group:** DanZero → DanZero+ (the Deep Monte-Carlo line). Deep dives:
   `danzero.md`, `danzero-plus.md`.
2. **Nanjing University (Yang Gao group) + NJUPT:** SDMC, GS2, the **OpenGuanDan** benchmark, and
   the **China AI Guandan Algorithm Competition** (CGAIAC). This cluster owns the
   search/game-theoretic line and the field's benchmarking.

---

## A. Deep Monte-Carlo / RL family (the SOTA mainstream)
- **DanZero** — arXiv 2210.17087, IEEE CoG 2023. DMC + distributed self-play. See `danzero.md`.
- **DanZero+** — arXiv 2312.02561, IEEE Transactions on Games 2024 (Xplore 10584299). DMC + PPO
  over DMC's top-k actions. See `danzero-plus.md`.
- **GuanZero** — *"Mastering the Game of Guandan with Deep RL and Behavior Regulating,"* arXiv
  **2402.13582** (2024). DMC plus a **"behavior-regulating" encoding to induce teammate
  cooperation** — i.e. directly targets the weak partner-coordination gap we noted in the DanZero
  critique. Worth reading for cooperation ideas. https://arxiv.org/abs/2402.13582
- **SDMC (Soft Deep Monte Carlo)** — *"Solving GuanDan Poker Games with Deep RL,"* J. Computer
  Research & Development 61(1):145–155 (2024), Ge Zhenxing et al. (Nanjing Univ.). DMC + **expert-
  strategy bootstrapping + online *soft* action sampling to resist exploitation.** **Won the 2nd
  CGAIAC competition.** Reports >80% vs rule-based and **~57.6% vs DanZero** (again: improvements
  over DanZero are *marginal*). The "soft sampling to resist exploitation" is the same
  mixed-strategy / anti-exploitability idea we flagged as an opening in `our-edge.md` §3.6 —
  someone already tried it; read how well it worked.
  https://crad.ict.ac.cn/en/article/doi/10.7544/issn1000-1239.202220697
- ⚠️ **"Application of Deep RL in Guandan Game"** — IEEE (Xplore 10033565, ~2022). PPO /
  policy-gradient. Details from snippets only (gated). https://ieeexplore.ieee.org/document/10033565/
- ⚠️ **"Multi-Personalities Guided Deep Monte Carlo Search … A Guandan Case Study"** — ICLR 2026
  submission (OpenReview E0Oy3u8lmD). DMC search with three rule-based "personality" priors.
  **Unaccepted preprint** — don't rely on it. https://openreview.net/forum?id=E0Oy3u8lmD

## B. Search / game-theoretic family (most relevant to our planned v2 — READ THESE)
This is the line we actually care about, since our edge is decision-time search (`our-edge.md`).
**Both now have full deep-dive docs.**
- **GS2** — *"Efficient Subgame Refinement for Extensive-form Games,"* **NeurIPS 2023**
  (OpenReview 8HzOyg1ngp), Zhenxing Ge et al. (Nanjing Univ.). **Generative subgame solving /
  CFR-family subgame refinement** on top of a DMC blueprint, with Guandan as the headline domain.
  Beats DanZero ~62% head-to-head (third-party benchmark) but needs a DanZero-class value net +
  seconds of CFR search. **→ deep dive: `gs2.md`.** The one portable idea: its **diversity hand
  sampler.** https://openreview.net/forum?id=8HzOyg1ngp
- **"Imperfect and Cooperative Guandan Game System"** — CCDC 2020 (IEEE Xplore 9164725),
  Shen/Wu/Li/Li. The **earliest** Guandan AI and the real "search-based" precedent:
  **PIMC determinization + UCT.** Essentially our planned v2, done in 2020 — but it landed only
  *"marginally better than random"* (per DanZero/DanZero+). **→ deep dive: `pimc-uct-2020.md`**
  (paywalled; abstract-only, confidence flags inside). The cautionary baseline: naive PIMC is the
  floor to clear, not the goal. https://ieeexplore.ieee.org/document/9164725/

## C. LLM family
- **Theory-of-Mind agent** — *"Evaluating and Enhancing LLMs Agent based on Theory of Mind in
  Guandan,"* arXiv **2408.02559** (2024). GPT-4 + 2nd-order ToM planning. Underperforms SOTA RL,
  but ToM (modeling what opponents think) helps — interesting for the *belief-modeling* angle.
  https://arxiv.org/abs/2408.02559
- **Commentary generation** — arXiv **2406.17807** (2024). LLM + ToM game commentary, **not a
  playing agent.** https://arxiv.org/abs/2406.17807

## D. Benchmark / infrastructure
- **OpenGuanDan** — *"A Large-Scale Imperfect Information Game Benchmark,"* arXiv **2602.00676**
  (2026), Chao Li et al. (NJUPT). Java/WebSocket 4-player simulator **with tribute/anti-tribute**;
  evaluates GS2, DanZero, SDMC + 4 rule-based agents; supports AI-vs-AI and human-vs-AI.
  **Headline conclusion: learning agents beat rule-based but remain sub-superhuman.** This is the
  closest thing to a standard Guandan benchmark — a candidate to evaluate our bot against (or at
  least to mine for its evaluation methodology). Repo:
  https://github.com/GameAI-NJUPT/OpenGuanDan · https://arxiv.org/abs/2602.00676
- **RLCard does NOT include Guandan** (it has Doudizhu, Mahjong, etc.). No standalone
  Gym/Gymnasium Guandan env found. So there's no off-the-shelf TS/JS env — consistent with us
  building our own engine. https://rlcard.org/games.html

## E. Competitions & code repos
- **China AI Guandan Algorithm Competition (CGAIAC)** — run by **NJUPT** Game AI group; source of
  OpenGuanDan's rule-based baselines; **SDMC won the 2nd edition.**
  https://gameai.njupt.edu.cn/gameaicompetition/index.html
  (No dedicated IJCAI Guandan competition — IJCAI's card-game track is Mahjong.)
- Repos: DanZero+ code https://github.com/submit-paper/Danzero_plus (on
  https://github.com/AltmanD/guandan_mcc — see `reference-implementation.md`); rule-based
  https://github.com/QinlinChen/guandan-ai; LLM-commentary https://github.com/heimy2000/guandan.

---

## What this changes for us
1. **The real search-based prior art is GS2 (CFR subgame solving) and the 2020 PIMC+UCT system** —
   not a mythical "PerfectDan." Both are directly relevant to bot v2; the 2020 system is
   essentially our planned approach, a generation earlier. **Read both before building v2.**
2. **Anti-exploitability has been tried (SDMC's soft sampling).** Before we lean on "mixed
   strategies beat their deterministic argmax" (`our-edge.md` §3.6), read how much SDMC's soft
   sampling actually bought — it only reached ~57.6% vs DanZero.
3. **No Guandan agent is superhuman** (OpenGuanDan's own conclusion). Our "strongest anywhere"
   north star is genuinely open territory, not a solved problem.
4. **OpenGuanDan is a ready benchmark** (it even models tribute/anti-tribute) — a possible external
   yardstick beyond our internal `pnpm eval` harness, if we ever want to compare against published
   agents on neutral ground.
5. **Improvements over DanZero are consistently marginal** (DanZero+ ~55%, SDMC ~57.6% vs DanZero).
   That reinforces the thesis: incremental RL tweaks plateau; the step-change lever is *method*
   (search + belief), not more-of-the-same self-play.
</content>
