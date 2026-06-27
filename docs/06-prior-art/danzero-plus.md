# DanZero+ (arXiv 2312.02561)

**Paper:** *DanZero+: Dominating the GuanDan Game through Reinforcement Learning*
**Authors:** Youpeng Zhao, Yudong Lu, Jian Zhao, Wengang Zhou, Houqiang Li (USTC).
**Relationship to DanZero:** the **extended journal version**. The authors state plainly: *"The
major technical improvement is applying the PPO algorithm to the GuanDan game."* Everything in
`danzero.md` still applies — DanZero+ keeps the DMC system intact and **adds a second stage on
top.** Read `danzero.md` first.

> Sourcing: ar5iv HTML, two agreeing passes. A "DMC vs DMC 46.55%" figure appeared once and
> could not be re-confirmed — treat as **unverified**. Code-vs-paper dim mismatches: see
> `reference-implementation.md`.

---

## 1. What's actually new vs DanZero
The original = DMC + distributed self-play (opponent-blind reactive value net). DanZero+ adds a
**PPO refinement layer on top of a frozen DMC model**, plus the trick that makes PPO feasible:

1. **DMC-as-teacher action pruning (the headline idea).** Naive PPO over Guandan's ~5000-wide,
   variable action space is intractable. So they freeze the trained DMC net, use it to score all
   legal actions, keep only the **top-k by Q-value**, and have PPO learn a policy over **just
   those k candidates.** The strong-but-slow value net prunes the space; the cheap policy net
   picks among the survivors.
2. **A claimed-transferable recipe** ("pretrained value model as teacher to guide policy
   learning") for other large-action imperfect-info games — *claimed*, not demonstrated
   elsewhere.
3. **Complexity argument:** filtering keeps actors ~O(n) and makes the PPO learner ~O(k) instead
   of blowing up with the action space.
4. Expanded evaluation (k-sweep ablation, PPO-vs-DMC head-to-head, human study).

**How big is the improvement? Marginal.** Best PPO config (**k=2**) beats the DMC engine only
**55.13%** head-to-head — a 55/45 edge, not a step change. DMC already crushed the rule-bot
field; PPO is a small polish on a strong core.

---

## 2. Algorithm — two stages
### Stage 1 — DMC (inherited, unchanged)
Exactly `danzero.md` §2: MC return regression, `Q(s,a)` scored per legal action, ε-greedy,
MSE loss to the realized return, no bootstrapping.

### Stage 2 — PPO over the DMC-filtered top-k
- **Pipeline:** frozen DMC scores all legal actions → take **top-k** → PPO learns a policy over
  the k candidates.
- **PPO input:** `(state, a₁, …, a_k)`. **Output:** `(logits(a₁..a_k), V(s))` → softmax policy
  over k + a value estimate.
- If a state has fewer than k legal actions, missing slots are encoded as **all −1** (outside the
  {0,1,2} card encoding) so they're maskable.
- **Standard PPO objective:**
  - Clipped surrogate `L_clip = E[min(rₜÂ, clip(rₜ,1−ε,1+ε)Â)]`, `rₜ = π_θ/π_θ_old`.
  - Value loss `L_v = E[(V_φ−R)²]`; entropy bonus `H(π)`.
  - Total `L = L_p + c_v·L_v` with policy/value/entropy weights **1 / 0.5 / 0.05**.
  - Advantages via **GAE**, **γ=0.99, λ=0.95**, clip **ε=0.2**.
  *(The public code adds an unusual extra `clamp(ratio, 0, 3)` on top of standard clipping — see
  `reference-implementation.md` §7.)*

### NOT present
No distributional RL, no behavior cloning (the DMC "pretrain" is RL, not imitation), no
curriculum, and — notably — **no opponent modeling** (§7).

---

## 3. State & action encoding
**Same as DanZero** (`danzero.md` §3–4): 513-dim state (per paper), 54-dim {0,1,2} card vectors,
per-action scoring for DMC. The **wild-card flag block (12 dims)** is emphasized here and its
ablation hurts (see §8). For PPO the input is `state ‖ k×54-dim actions`.

**Action-space magnitudes restated:** up to **>5000 legal actions** at the opening, collapsing to
**<50** late in a deal. The huge *and highly variable* count is the core difficulty the top-k
filter solves.

---

## 4. Network architecture
- **DMC net:** input 567-dim (513+54); **4 MLP layers × 512, tanh**; output scalar Q.
  *(Public code: 5×512 — minor disagreement, trust the code.)*
- **PPO net:** input `state ‖ k actions`; **4 MLP layers (512, 512, 512, 256), tanh**; **two
  heads** — k-way policy logits + V(s).
- Both are plain MLPs. No RNN/transformer/CNN. No card-structure inductive bias.

---

## 5. Training setup
Distributed actor–learner self-play, same skeleton as DanZero.

| | DMC | PPO |
|---|---|---|
| Actors | 80 | 40 |
| CPU/actor | 2 cores | 2 cores |
| Agents/actor | 4 (1 game = 4 trajectories) | 4 |
| Memory pool | 65,536 | 2,048 |
| Batch size | 32,768 | 2,048 |
| Train every N | 250 | 13 |
| Learning rate | 1e-3 | 1e-4 |
| Optimizer | RMSProp | Adam |
| Action selection | ε-greedy | probability sampling |

- **Hardware:** 4× Xeon Gold 6252 + **one RTX 3070**, Ubuntu 16.04. Notably modest.
- **DMC ~30 days**; PPO "notably expedited" (<1 day — the top-k filter makes the action space
  tiny). Checkpoints saved hourly.

---

## 6. Opponent modeling
**None.** No hidden-hand inference, no opponent-type classification. The only "opponent
awareness" is the engineered features (others' card counts, played-card histories, partner's
last move) plus whatever self-play implicitly bakes in. This is a notable, deliberate gap — and
one of the clearest places our bot could surpass it (`our-edge.md`).

---

## 7. Evaluation
**Baselines:** the same 8 rule-based competition bots; **1000 games/matchup.**

**DMC vs baselines:**
| Opp | b8 | b7 | b6 | b5 | b4 | b3 | b2 | b1 |
|---|---|---|---|---|---|---|---|---|
| Win% | 100 | 100 | 100 | 100 | 87.45 | 100 | 82.61 | 90.12 |

**PPO (DanZero+) by k:**
| k | b1 | b2 | b4 | **vs DMC** |
|---|---|---|---|---|
| **2 (best)** | **92.70** | **86.22** | **90.83** | **55.13** |
| 3 | 72.17 | 63.33 | 84.25 | 42.30 |
| 5 | 70.28 | 54.60 | 78.06 | 38.45 |

- **k=2 is best by a wide margin.** At k=3 and k=5, PPO is actually *worse than DMC* (42%/38%).
  The entire gain rides on the single sweet-spot k=2 — i.e. PPO is essentially learning a binary
  "trust DMC's #1, or take its #2" decision. That narrowness is a red flag about how much real
  value the PPO stage adds.
- **Wild-card-flag ablation ("Our-"):** b1 90.12→87.23, b4 87.45→82.68, b2 82.61→74.67 — the
  flags help, most against the harder opponents.
- **Human study:** 10 strong grad students, 20 rounds each vs two AI opponents → AI won
  **71/100** games.

---

## 8. Stated limitations / future work
- **Tribute is hand-coded and its samples are discarded** (heuristic: keep hand strength; return
  bombs/straight-flushes, then low singles, then break triples/pairs, lastly break bombs). They
  call learning it "daunting" because its causal impact is hard to isolate.
- **Recipe generalization untested** beyond Guandan.
- Other policy-gradient methods "could also be used" — left as future work.

---

## 9. Critical assessment — is it actually "dominating"?
The title oversells. By their own numbers DanZero+ beats DanZero **55/45**, and the gain
**collapses** away from k=2. The remaining weaknesses are the same as DanZero's, because the
core is the same reactive value net:

1. **Still no search, still no belief modeling** — the biggest gap for top-tier imperfect-info
   play (Pluribus/ReBeL/DeepNash and Guandan-specific search work all lean on search and/or
   belief; DanZero+ cannot "think" at decision time).
2. **Self-play-only → exploitable.** No population/league, no exploitability control. Strong
   on-distribution, soft against tuned counter-strategies and unusual human styles.
3. **DMC's high-variance MC targets** persist and likely *cap* how much PPO can add.
4. **The policy ceiling is DMC's top-k.** If DMC's Q-ranking ever excludes the truly best move,
   PPO can never recover it — the whole system is bounded by DMC's ranking quality.
5. **Weak MLP architecture**, hand-engineered frequency features, no sequence model.
6. **Tribute still unlearned**; **evaluation still soft** (2022 rule bots + 10 amateurs).
7. **Tiny compute** (1× RTX 3070) — efficient, but the absolute strength bar is not high for a
   project aiming at "strongest anywhere."

**The genuinely clever, portable idea to steal:** *use a strong-but-slow value net to prune a
huge action space down to a handful, then run a cheaper/smarter policy (PPO — or in our case,
search) over just those candidates.* That pattern is directly applicable to a search bot: prune
with a value prior, search over survivors. See `our-edge.md`.
</content>
