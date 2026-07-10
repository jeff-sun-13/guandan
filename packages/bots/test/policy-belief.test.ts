import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  makeRng,
  createDeal,
  applyMove,
  cloneState,
  observe,
  legalMoves,
  isTerminal,
  determinize,
  type Card,
  type GameState,
  type Move,
  type Observation,
  type Player,
  type PublicHistory,
  type Rng,
} from "@guandan/engine";
import {
  initPolicyNet,
  policyFromJSON,
  towerPre1,
  encodeObs,
  OBS_FEATURES,
  ACT_FEATURES,
  type PolicyNet,
} from "@guandan/nn";
import {
  randomBot,
  playMatch,
  recordMove,
  makePolicyBot,
  makePolicyBeliefSampler,
  buildEvidence,
  worldLogLikelihood,
  type Bot,
} from "../src/index";

const WEIGHTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tools", "data", "policy-weights-nohist.json");
const realNet: PolicyNet | null = existsSync(WEIGHTS) ? policyFromJSON(readFileSync(WEIGHTS, "utf8")) : null;

/** A small random net with the real feature dims — structure tests don't need trained weights. */
const testNet = initPolicyNet(OBS_FEATURES, ACT_FEATURES, makeRng(42));

interface TraceEntry {
  seat: Player;
  /** The seat's true hand BEFORE its move. */
  hand: Card[];
  /** The engine's observation for the acting seat (public truth at the decision). */
  obs: Observation;
  /** True legal-move count at the decision. */
  legalCount: number;
  /** The move actually taken. */
  move: Move;
}

/**
 * Play one deal (mirroring the arena loop: observe → record → apply) keeping a ground-truth trace
 * of every decision, plus checkpoint snapshots (viewer obs + the TRUE hidden state) mid-deal.
 */
function playTracedDeal(bots: Bot[], seed: number, level = 5, checkpointsAt: number[] = [16, 30]) {
  const rng = makeRng(seed);
  let s = createDeal(level, rng, 0);
  const history: PublicHistory = { passes: [], plays: [], tribute: [] };
  const trace: TraceEntry[] = [];
  const checkpoints: { obs: Observation; world: GameState; traceLen: number }[] = [];
  let moves = 0;
  while (!isTerminal(s)) {
    const seat = s.toAct;
    const obs: Observation = {
      ...observe(s, seat),
      history: {
        passes: history.passes.slice(),
        plays: history.plays.slice(),
        tribute: history.tribute,
      },
    };
    if (checkpointsAt.includes(moves)) {
      checkpoints.push({ obs, world: cloneState(s), traceLen: trace.length });
    }
    const legal = legalMoves(s, seat);
    const move = (bots[seat] as Bot)(obs, legal, rng);
    trace.push({ seat, hand: (s.hands[seat] as Card[]).slice(), obs, legalCount: legal.length, move });
    recordMove(history, s, seat, move);
    s = applyMove(s, move);
    moves++;
  }
  return { trace, checkpoints };
}

const sortedCopy = (cards: Card[]) => cards.slice().sort((a, b) => a - b);

describe("recordMove seq + trick stamping", () => {
  it("every recorded event carries a unique contiguous seq and the pre-move trick", () => {
    const seen: Observation[] = [];
    const spy: Bot = (obs, legal, rng) => {
      seen.push(obs);
      return randomBot(obs, legal, rng);
    };
    playMatch([spy, randomBot, randomBot, randomBot], makeRng(11));
    const withEvents = seen.filter((o) => (o.history?.plays.length ?? 0) + (o.history?.passes.length ?? 0) > 0);
    expect(withEvents.length).toBeGreaterThan(0);
    for (const o of withEvents) {
      const h = o.history!;
      const seqs = [...h.plays.map((p) => p.seq), ...h.passes.map((p) => p.seq)];
      expect(seqs.every((q) => q !== undefined)).toBe(true);
      const sorted = (seqs as number[]).slice().sort((a, b) => a - b);
      // Contiguous 0..n-1: the interleaving of the two arrays is fully recoverable.
      for (let i = 0; i < sorted.length; i++) expect(sorted[i]).toBe(i);
      // Passes always face a live trick and duplicate its top for lane-1 consumers.
      for (const p of h.passes) {
        expect(p.trick).toBeDefined();
        expect(p.trick!.topCombo).toEqual(p.top);
        expect(p.trick!.topPlayer).toBe(p.topPlayer);
      }
      // Plays record the faced trick or null for a lead.
      for (const p of h.plays) expect(p.trick).not.toBeUndefined();
    }
  });
});

describe("buildEvidence exact reconstruction", () => {
  it("reconstructs each hidden seat's public context and hand exactly (vs the true trace)", () => {
    for (const seed of [3, 7, 21]) {
      const { trace, checkpoints } = playTracedDeal([randomBot, randomBot, randomBot, randomBot], seed);
      expect(checkpoints.length).toBeGreaterThan(0);
      for (const cp of checkpoints) {
        const viewer = cp.obs.player;
        const ev = buildEvidence(cp.obs, testNet, 9999);
        expect(ev).not.toBeNull();
        const past = trace.slice(0, cp.traceLen);
        for (let seat = 0 as Player; seat < 4; seat++) {
          const expected = past.filter(
            (t) => t.seat === seat && seat !== viewer && (cp.obs.handCounts[seat] as number) > 0,
          );
          const ctxs = ev!.bySeat.get(seat) ?? [];
          expect(ctxs.length).toBe(expected.length);
          // Hand add-back walk from the TRUE current world must reproduce every true hand.
          let hand = (cp.world.hands[seat] as Card[]).slice();
          for (let i = ctxs.length - 1; i >= 0; i--) {
            const ctx = ctxs[i]!;
            hand = hand.concat(ctx.cards);
            expect(ctx.handSize).toBe(expected[i]!.hand.length);
            expect(sortedCopy(hand)).toEqual(sortedCopy(expected[i]!.hand));
            // The pre-encoded public template must equal one built from the engine's own
            // observation at that decision (hand emptied, no history — the nohist input).
            const trueSynth: Observation = { ...expected[i]!.obs, hand: [], history: undefined };
            const truePre1 = towerPre1(testNet.obs, encodeObs(trueSynth));
            expect(Array.from(ctx.pre1)).toEqual(Array.from(truePre1));
          }
        }
      }
    }
  });

  it("with mix=1 the log-likelihood is exactly Σ log(1/k) over the true world's choice points", () => {
    const { trace, checkpoints } = playTracedDeal([randomBot, randomBot, randomBot, randomBot], 13);
    const cp = checkpoints[checkpoints.length - 1]!;
    const viewer = cp.obs.player;
    const ev = buildEvidence(cp.obs, testNet, 9999);
    expect(ev).not.toBeNull();
    // ε=1 ignores the net entirely: every scored decision contributes log(1/k). On the TRUE world
    // the reconstructed k must equal the true legal count, so the total is checkable exactly.
    const logL = worldLogLikelihood(testNet, ev!, cp.world, cp.obs.level, 1, 1);
    let want = 0;
    for (const t of trace.slice(0, cp.traceLen)) {
      if (t.seat === viewer || (cp.obs.handCounts[t.seat] as number) === 0) continue;
      want += Math.log(1 / t.legalCount);
    }
    expect(logL).toBeCloseTo(want, 10);
  });

  it("returns null when the history lacks seq/trick (old recorder) or is absent", () => {
    const { checkpoints } = playTracedDeal([randomBot, randomBot, randomBot, randomBot], 5);
    const cp = checkpoints[0]!;
    const stripped: Observation = {
      ...cp.obs,
      history: {
        passes: cp.obs.history!.passes.map((p) => ({ seat: p.seat, top: p.top, topPlayer: p.topPlayer })),
        plays: cp.obs.history!.plays.map((p) => ({ seat: p.seat, cards: p.cards, combo: p.combo })),
        tribute: [],
      },
    };
    expect(buildEvidence(stripped, testNet, 99)).toBeNull();
    expect(buildEvidence({ ...cp.obs, history: undefined }, testNet, 99)).toBeNull();
  });

  it("maxEvents keeps only the most recent decisions without breaking the hand walk", () => {
    const { trace, checkpoints } = playTracedDeal([randomBot, randomBot, randomBot, randomBot], 9);
    const cp = checkpoints[checkpoints.length - 1]!;
    const viewer = cp.obs.player;
    const evFull = buildEvidence(cp.obs, testNet, 9999)!;
    const ev = buildEvidence(cp.obs, testNet, 6)!;
    expect(ev.contexts).toBe(Math.min(6, evFull.contexts));
    // Windowed contexts are a per-seat SUFFIX of the full ones: hands still reconstruct exactly.
    const past = trace.slice(0, cp.traceLen);
    for (const [seat, ctxs] of ev.bySeat) {
      const expected = past.filter((t) => t.seat === seat && seat !== viewer);
      const tail = expected.slice(expected.length - ctxs.length);
      let hand = (cp.world.hands[seat] as Card[]).slice();
      for (let i = ctxs.length - 1; i >= 0; i--) {
        hand = hand.concat(ctxs[i]!.cards);
        expect(sortedCopy(hand)).toEqual(sortedCopy(tail[i]!.hand));
      }
    }
  });
});

describe("policy-likelihood sampler", () => {
  it("pooled worlds are card-consistent, drawn deterministically, and pooled once per obs", () => {
    let pools = 0;
    const sampler = makePolicyBeliefSampler(testNet, {
      pool: 12,
      onPool: (st) => {
        pools++;
        expect(st.ess).toBeGreaterThanOrEqual(1);
        expect(st.ess).toBeLessThanOrEqual(st.pool + 1e-9);
        expect(st.contexts).toBeGreaterThan(0);
      },
    });
    const { checkpoints } = playTracedDeal([randomBot, randomBot, randomBot, randomBot], 17);
    const cp = checkpoints[checkpoints.length - 1]!;
    const draws: GameState[] = [];
    const rng = makeRng(123);
    for (let i = 0; i < 30; i++) {
      const w = sampler(cp.obs, rng);
      draws.push(w);
      expect(sortedCopy(w.hands[cp.obs.player] as Card[])).toEqual(sortedCopy(cp.obs.hand));
      for (let p = 0; p < 4; p++) expect((w.hands[p] as Card[]).length).toBe(cp.obs.handCounts[p]);
    }
    expect(pools).toBe(1); // one pool per obs identity, reused across every draw
    // Determinism: a fresh sampler + fresh rng reproduces the same draw sequence.
    const sampler2 = makePolicyBeliefSampler(testNet, { pool: 12 });
    const rng2 = makeRng(123);
    for (let i = 0; i < 30; i++) {
      const w2 = sampler2(cp.obs, rng2);
      expect(sortedCopy(w2.hands[1] as Card[])).toEqual(sortedCopy(draws[i]!.hands[1] as Card[]));
      expect(sortedCopy(w2.hands[3] as Card[])).toEqual(sortedCopy(draws[i]!.hands[3] as Card[]));
    }
  });

  it("falls back to the base sampler when there is no usable evidence", () => {
    const rng = makeRng(2);
    const s = createDeal(2, rng, 0);
    const obs = observe(s, 0); // no history at all
    const sampler = makePolicyBeliefSampler(testNet);
    const w = sampler(obs, makeRng(5));
    expect(sortedCopy(w.hands[0] as Card[])).toEqual(sortedCopy(obs.hand));
    for (let p = 0; p < 4; p++) expect((w.hands[p] as Card[]).length).toBe(obs.handCounts[p]);
  });

  it.skipIf(realNet === null)(
    "with the real nohist net, the TRUE world out-scores random worlds on policy-played deals",
    () => {
      // Seats play by the net itself (T=1) — its likelihood should recognise the true hands.
      const net = realNet as PolicyNet;
      const bot = makePolicyBot(net, { temperature: 1, zeroHistory: true });
      let advantage = 0;
      let n = 0;
      for (const seed of [101, 102, 103]) {
        const { checkpoints } = playTracedDeal([bot, bot, bot, bot], seed, 5, [14, 24, 34]);
        for (const cp of checkpoints) {
          const ev = buildEvidence(cp.obs, net, 40);
          if (!ev) continue;
          const trueLL = worldLogLikelihood(net, ev, cp.world, cp.obs.level, 0.15, 1);
          const rng: Rng = makeRng(seed * 7 + n);
          let rand = 0;
          const M = 12;
          for (let i = 0; i < M; i++) {
            rand += worldLogLikelihood(net, ev, determinize(cp.obs, rng), cp.obs.level, 0.15, 1);
          }
          advantage += trueLL - rand / M;
          n++;
        }
      }
      expect(n).toBeGreaterThan(3);
      // The truth should be MORE likely than uniform hypotheses on average across checkpoints.
      expect(advantage / n).toBeGreaterThan(0);
    },
  );
});
