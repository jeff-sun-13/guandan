# Reference Implementation — Danzero_plus source code

**Repo:** github.com/submit-paper/Danzero_plus (official code for DanZero+, arXiv 2312.02561).
Built on the earlier DanZero code (github.com/AltmanD/guandan_mcc).

Read this when you want **implementation-level** detail — exact feature blocks, the trained
weights, hyperparameters as actually coded — beyond what the papers state. Where the code and
the papers disagree on numbers, **trust the code** (it's what produced the released model).

> **The single most important caveat:** the Guandan **rules engine is a closed compiled binary**
> in this repo (`actor_n/guandan`, `actor_torch/danserver`), spoken to over WebSockets. All
> tribute / level / match / legal-move logic is hidden. **You cannot reuse their engine.** The
> repo gives you the ML recipe (encoding, networks, losses, training plumbing, trained DMC
> weights) but *not* the rules — which is exactly the part we are building ourselves and treat as
> the crown jewel (`03-engine/design.md`). This is a feature for us: their gap is our mandate.

---

## 1. Repo layout (two stages, two frameworks)
```
actor_n/        # TF DMC actor (self-play data gen), Python 3.6
learner_n/      # TF DMC learner, Python 3.8  (agents/dqn/guandan_agent.py = the MC agent)
actor_torch/    # PyTorch PPO actor  (ships q_network.ckpt = trained DMC weights)
learner_torch/  # PyTorch PPO learner (ppo.py, model.py, MPI tools)
wintest/        # evaluation arena: ai1..ai8 (rule bots) + danzero/ + torch/ clients
```
- `_n` = **TensorFlow DMC** (Stage 1). `_torch` = **PyTorch PPO** (Stage 2).
- Research-grade code: committed `.pyc`, duplicated trees, mixed Python 3.6/3.8, Chinese
  comments, hardcoded ports/paths, **no tests, no packaging.**

## 2. Frameworks / deps
- **DMC:** TensorFlow **1.15** (TF1 graph/session, `tf.layers.dense`, `tf.train.Saver`).
- **PPO:** PyTorch **1.13.1**.
- **Distribution:** custom — DMC uses **ZMQ** (PUB/SUB weights on port 5001, REP data on 5000) +
  a custom `mem_pool`; PPO uses **MPI** for synchronous gradient averaging. **No Ray/RLlib.**
- Game core talks over **WebSockets** (`ws4py`).

## 3. Game environment — closed binary
The Python side is purely a **WebSocket client** to the binary game core (the Guandan-competition
"offline platform / 离线平台"). It receives message dicts (`handCards`, `actionList`, `curAction`,
`curRank`, `myPos`, played-card histories; phases `beginning/tribute/play/episodeOver`) and
replies with an action index. Tribute handling (`back_action`) just picks return cards avoiding
breaking straights. **Reimplementing this engine in pure TS is our job.**

## 4. State / feature encoding — `actor_n/game.py::prepare()` (the real layout)
Observation = `np.hstack` of these blocks (**base state, no action**):

| Block | Dim | Meaning |
|---|---|---|
| my_handcards | 54 | my hand (counts over 54 cards) |
| universal_card_flag | 12 | wild/level-card validity flags |
| other_handcards | 54 | union of all others' remaining cards |
| last_action | 54 | move to beat |
| last_teammate_action | 54 | partner's last move |
| down_played_cards | 54 | cards played by down (right) player |
| teammate_played_cards | 54 | cards played by partner |
| up_played_cards | 54 | cards played by up (left) player |
| down_num_cards_left | 28 | one-hot of down player's hand size |
| teammate_num_cards_left | 28 | one-hot of partner's hand size |
| up_num_cards_left | 28 | one-hot of up player's hand size |
| self_rank | 13 | my team's level (2..A) |
| oppo_rank | 13 | opponent team's level |
| cur_rank | 13 | active playing level |

**Base = 539.** Then **+ my_action (54) → 593-dim** network input.

> **Dim discrepancy to know about:** paper says **513** base / 567 input; this TF code builds
> **539 / 593**; the PyTorch PPO config says **516** base. The implementation drifted across
> versions. If you reimplement, pick one consistent layout (the code's 539 block list above is
> the most concrete) and **don't trust the paper's 513**.

**Card → vector** (`actor_n/utils/utils.py::card2array`): map `"<suit><rank>"` → 0..53 (suits
H/S/C/D, ranks 2..A, + small/big joker), build a 4×13 matrix, flatten to 52, append 2 joker slots
→ length 54; each slot holds a **count ∈ {0,1,2}** (two decks).

Hand-size one-hot and a `combine_handcards()` combo splitter (Singles/Pairs/Trips/Bombs +
5-card straights incl. A-2-3-4-5 + straight flushes + bomb multipliers) also live here.

## 5. Action encoding
Each legal action from `message['actionList']` is encoded as a **54-dim count array** and
appended to the base state. The legal set becomes a **batch** scored row-by-row:
```python
legal_actions = [card2num(i[2]) for i in message['actionList']]
my_action_batch = np.zeros((num_legal, 54))
for j, a in enumerate(legal_actions):
    my_action_batch[j] = card2array(a)
x_batch = np.hstack((my_handcards_batch, universal_card_flag_batch, ..., my_action_batch))  # (num_legal, 593)
```
So DMC is a **Q(s,a) scorer over a batch of candidate actions** (DouZero style), not a fixed
action head. Pass = `[]`; completion marker = `[-1]`. (The `(5,216)` you'll see at actor init is
a legacy placeholder, not the real per-action dim, which is 54.)

## 6. Models (actual code)
**DMC value net** — `actor_n/model.py`:
```python
# input (None, 593) -> 5 x Dense(512, tanh) -> Dense(1, linear)
self.values = mlp(self.x_ph, [512,512,512,512,512,1], activation='tanh')
```
`forward(x_batch)` runs the batch and returns one scalar Q per action. **No LSTM.**

**PPO actor-critic** — `learner_torch/model.py` / `wintest/torch/model.py`:
```python
class MLPActorCritic(nn.Module):
    def __init__(self, ..., hidden_sizes=(512,512,512,512,256), activation=nn.Tanh):
        self.shared = shared_mlp(obs_dim, hidden_sizes, activation)
        self.pi = mlp([256, 128, K], activation)   # K = action_space (=2)
        self.v  = mlp([256, 128, 1], activation)
    # logits = squeeze(self.pi(feat)) - (1 - legal_mask) * 1e8   # mask illegals
```
Input dim `516 + K*54`; with **K=2 → 624**, output K=2.

**DMC→Torch bridge:** `MLPQNetwork.get_max_n_index` returns the top-N action indices
(`q_list.argsort()[-n:][::-1]`); `load_tf_weights` transposes the TF `q_network.ckpt` matrices
into PyTorch param names so the *same* DMC weights drive both stacks.

## 7. Training loop / hyperparameters (as coded)
**DMC** (`learner_n/agents/dqn/guandan_agent.py`):
- MC Q-regression, agent type `'MC'`. Target = the **terminal return broadcast to every step**
  (no bootstrapping, effectively γ=1). Loss `mean((values − target)²)`.
- **RMSProp, lr 1e-3**, eps 1e-5. (`lambda=0.65` exists but is unused.)
- Actor ε-greedy with **ε=0.01**. Reward map (team-finish):
  `{"1100":3, "1010":2, "1001":1, "0110":-1, "0101":-2, "0011":-3}` (双下 = both teammates top-2
  = +3). Special multiplier branch when `curRank==13` (level A).
- Paper scale: ~80 actors, buffer 65,536, batch 32,768, ~30 days.

**PPO** (`learner_torch/ppo.py`):
```python
ratio = torch.exp(logp - logp_old)
clipped_ratio = torch.clamp(ratio, 0.0, 3.0)          # unusual extra clamp
clip_adv = torch.clamp(ratio, 1-clip, 1+clip) * adv
loss_pi = -(torch.min(clipped_ratio*adv, clip_adv)).mean()
loss = loss_pi + 0.5*loss_v + 0.05*loss_ent
```
- clip 0.2, **lr 1e-4 Adam**, 20 update iters/epoch, target_kl 0.01 (early stop at 1.5×),
  grad-clip 10, pool/batch 2048. **MPI** gradient averaging, ~40 actors, trains **<1 day**.

## 8. Opponent modeling
**None in code or paper.** Pure self-play; the only opponent signal is the engineered features.
Belief/opponent modeling is **net-new territory** for us, not something to port.

## 9. Pretrained weights & inference
- **DMC weights ARE shipped:** `q_network.ckpt` (the TF 5×512 value net) appears in
  `actor_torch/`, `wintest/danzero/`, `wintest/torch/`. **These are the public checkpoints our
  friend claims to beat 100–0** — note they may be a weak/old checkpoint, not the 30-day model.
- PPO checkpoints are produced by the torch learner (last 5 kept).
- **Inference:** DMC → score legal-action batch, argmax. PPO → `get_max_n_index(K=2)` from DMC,
  assemble `state(516) ‖ top2(2×54)`, `MLPActorCritic.step()` with legal masking.

## 10. How to run
- Train DMC: `learner_n/learner.py` + `actor_n/actor.py` (needs the `guandan` binary, ZMQ 5000/5001).
- Train PPO: `learner_torch/learner.py` + `actor_torch/actor.py` (MPI; consumes `q_network.ckpt`).
- Eval (`wintest/`): DMC at seats 0/2, PPO at 1/3, rule bots `ai1..ai8` as opponents;
  `bash wintest/torch/testmodel.sh <model_id>`.

## 11. Assessment — what's worth taking vs. leaving
**Easy to port to TS:** the encoding (54-dim {0,1,2} card vectors, the block layout in §4) and
the networks (plain tanh MLPs, no exotic ops). The DMC learning rule is trivial (MC-return
regression with ε-greedy over Q(s,a) candidates — the DouZero recipe).

**The genuinely clever, portable idea:** the **DMC-as-action-pruner** pattern (§6 `get_max_n_index`)
— use a value net to cut ~5000 legal moves to a handful, then run a smarter/cheaper module over
the survivors. This maps directly onto a search bot (prune with a value prior, search over
survivors).

**The expensive part is compute, not code:** ~30 CPU-weeks for DMC. (Relevant to our deferred
"how far do we go on training" decision — see `our-edge.md`.)

**Questionable choices:** closed-binary engine (kills reuse/reproducibility); inconsistent feature
dims across files; effectively-unused γ/λ in DMC; the unexplained extra `clamp(ratio,0,3)` in
PPO; and zero opponent modeling in a partial-information partnership game — a clear avenue to
surpass them.
</content>
