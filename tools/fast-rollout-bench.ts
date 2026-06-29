// PROTOTYPE + BENCHMARK (not production; do not import from app/bot code paths).
//
// Goal: quantify how much allocation / GC overhead the current PURE rollout pays, by building an
// allocation-light "in-place" rollout core that reuses ONE GameState and mutates hands/trick/
// finished in place instead of cloning every ply, and that skips work the rollout policy doesn't
// actually need (the per-ply `outOfPlay` array; move validation).
//
// The rollout policy is the v1 heuristic (heuristicBot) for BOTH cores, so the comparison is
// apples-to-apples. heuristicBot is deterministic and never consults the RNG, so a heuristic-vs-
// heuristic playout from a fixed deal is fully determined — which makes the correctness gate exact:
// the in-place core MUST produce the identical finishing order as the pure core on every deal.
//
// Run:  pnpm --filter @guandan/tools exec tsx fast-rollout-bench.ts
//
// NOTE: this file does NOT modify any engine function. `applyStep` below is a *local* mutating copy
// of the engine's applyMove logic, kept here so the pure engine stays pure.

import {
  makeRng,
  createDeal,
  legalMoves,
  applyMove,
  observe,
  cloneState,
  isTerminal,
  result,
  teamOf,
  partnerOf,
  type GameState,
  type Move,
  type Observation,
  type Player,
  type Card,
  type Rng,
} from "@guandan/engine";
import { heuristicBot } from "@guandan/bots";

function now(): number {
  return Number(process.hrtime.bigint() / 1000n) / 1000; // ms, sub-ms precision
}

/** Value of a finished deal from `myTeam`'s view (copied from pimc.ts — kept identical). */
function dealValue(finish: Player[], myTeam: number): number {
  const winTeam = teamOf(finish[0] as Player);
  const winSeats = [0, 1, 2, 3].filter((s) => teamOf(s) === winTeam);
  const winPos = winSeats.map((s) => finish.indexOf(s)).sort((a, b) => a - b);
  const partnerPos = winPos[1] as number;
  const mag = partnerPos === 1 ? 3 : partnerPos === 2 ? 2 : 1;
  return winTeam === myTeam ? mag : -mag;
}

// ----------------------------------------------------------------------------------------------
// In-place transition: a local, mutating copy of engine/src/deal.ts `applyMove`, WITHOUT the
// cloneState and WITHOUT validatePlay (the rollout only ever feeds moves straight from legalMoves,
// so they are legal by construction — validation is pure overhead in this context).
// ----------------------------------------------------------------------------------------------

function nextActivePlayer(hands: Card[][], from: Player): Player {
  for (let i = 1; i <= 4; i++) {
    const p = (from + i) % 4;
    if ((hands[p] as Card[]).length > 0) return p;
  }
  return -1;
}

function respondersRemaining(hands: Card[][], topPlayer: Player): number {
  let n = 0;
  for (let p = 0; p < 4; p++) {
    if (p !== topPlayer && (hands[p] as Card[]).length > 0) n++;
  }
  return n;
}

/** Remove the multiset `cards` from `hand` IN PLACE (splice). Assumes the cards are present. */
function removeCardsInPlace(hand: Card[], cards: Card[]): void {
  for (const c of cards) {
    const idx = hand.indexOf(c);
    // idx === -1 should be impossible for a legal move; guard cheaply so a bug is loud.
    if (idx === -1) throw new Error(`card ${c} not in hand (in-place)`);
    hand.splice(idx, 1);
  }
}

/** Mutate `s` by applying `move` for s.toAct, returning the SAME object. No clone, no validation. */
function applyStep(s: GameState, move: Move): GameState {
  const p = s.toAct;

  if (move.kind === "pass") {
    const trick = s.trick!;
    trick.passes++;
    if (trick.passes >= respondersRemaining(s.hands, trick.topPlayer)) {
      const winner = trick.topPlayer;
      let leader: Player;
      if ((s.hands[winner] as Card[]).length > 0) leader = winner;
      else {
        const partner = partnerOf(winner);
        leader =
          (s.hands[partner] as Card[]).length > 0
            ? partner
            : nextActivePlayer(s.hands, winner);
      }
      s.trick = null;
      s.toAct = leader;
    } else {
      s.toAct = nextActivePlayer(s.hands, p);
    }
    return s;
  }

  // --- play ---
  removeCardsInPlace(s.hands[p] as Card[], move.cards);
  if (!s.trick) {
    s.trick = { leader: p, topCombo: move.combo, topPlayer: p, passes: 0 };
  } else {
    s.trick.topCombo = move.combo;
    s.trick.topPlayer = p;
    s.trick.passes = 0;
  }

  if ((s.hands[p] as Card[]).length === 0) {
    s.finished.push(p);
    if (s.finished.length === 3) {
      const last = [0, 1, 2, 3].find((x) => !s.finished.includes(x)) as Player;
      s.finished.push(last);
      s.phase = "done";
      s.toAct = -1;
      return s;
    }
  }

  s.toAct = nextActivePlayer(s.hands, p);
  return s;
}

/** Clone the state, then apply via the same mutating step (clone WITHOUT validation). */
function cloneApply(s: GameState, move: Move): GameState {
  return applyStep(cloneState(s), move);
}

// ----------------------------------------------------------------------------------------------
// Lightweight observation: heuristicBot only reads obs.player, obs.hand, obs.handCounts, obs.trick
// (and obs.hand's size). It NEVER reads obs.outOfPlay, so the engine's O(108) outOfPlay array build
// is pure waste for this rollout. This reuses a single observation object + handCounts buffer and
// passes the live hand/trick by reference (heuristicBot does not mutate them).
// ----------------------------------------------------------------------------------------------

const EMPTY: Card[] = [];
const _hc = [0, 0, 0, 0];
const _obs: Observation = {
  level: 0,
  player: 0,
  hand: EMPTY,
  handCounts: _hc,
  outOfPlay: EMPTY,
  trick: null,
  toAct: 0,
  finished: EMPTY,
  phase: "playing",
};

function lightObserve(st: GameState, seat: Player): Observation {
  _hc[0] = (st.hands[0] as Card[]).length;
  _hc[1] = (st.hands[1] as Card[]).length;
  _hc[2] = (st.hands[2] as Card[]).length;
  _hc[3] = (st.hands[3] as Card[]).length;
  _obs.level = st.level;
  _obs.player = seat;
  _obs.hand = st.hands[seat] as Card[]; // by reference — heuristic reads, never mutates
  _obs.trick = st.trick; // by reference
  _obs.toAct = st.toAct;
  _obs.phase = st.phase;
  return _obs;
}

// ----------------------------------------------------------------------------------------------
// Rollout cores, composed from (applyFn, observeFn) so we can attribute savings to each change.
// ----------------------------------------------------------------------------------------------

type ApplyFn = (s: GameState, m: Move) => GameState;
type ObserveFn = (s: GameState, seat: Player) => Observation;

function makeRollout(applyFn: ApplyFn, observeFn: ObserveFn) {
  return (start: GameState, myTeam: number, rng: Rng): number => {
    let st = start;
    while (!isTerminal(st)) {
      const seat = st.toAct;
      const mv = heuristicBot(observeFn(st, seat), legalMoves(st, seat), rng);
      st = applyFn(st, mv);
    }
    return dealValue(result(st), myTeam);
  };
}

// (a) PURE baseline: exactly the existing rollout shape (engine applyMove = clone + validate;
//     engine observe = full, incl. outOfPlay).
const rolloutPure = makeRollout(applyMove, observe);

// (b) IN-PLACE prototype: mutate one state, light observe.
const rolloutInPlace = makeRollout(applyStep, lightObserve);

// Attribution variants:
const rolloutCloneFullObs = makeRollout(cloneApply, observe); // clone(no validate) + full observe
const rolloutCloneLightObs = makeRollout(cloneApply, lightObserve); // clone(no validate) + light obs
const rolloutInPlaceFullObs = makeRollout(applyStep, observe); // in-place + full observe

// ----------------------------------------------------------------------------------------------
// Correctness gate: identical finishing order on every deal.
// ----------------------------------------------------------------------------------------------

function correctness(nDeals: number): void {
  let mismatches = 0;
  let firstBad = -1;
  for (let i = 0; i < nDeals; i++) {
    const seed = i + 1;
    const a = createDeal(2, makeRng(seed));
    const b = createDeal(2, makeRng(seed));
    const fa = (() => {
      let st = a;
      while (!isTerminal(st)) {
        const seat = st.toAct;
        st = applyMove(st, heuristicBot(observe(st, seat), legalMoves(st, seat), makeRng(0)));
      }
      return result(st);
    })();
    const fb = (() => {
      let st = b;
      while (!isTerminal(st)) {
        const seat = st.toAct;
        st = applyStep(st, heuristicBot(lightObserve(st, seat), legalMoves(st, seat), makeRng(0)));
      }
      return result(st);
    })();
    const same = fa.length === fb.length && fa.every((x, k) => x === fb[k]);
    const vSame = dealValue(fa, 0) === dealValue(fb, 0) && dealValue(fa, 1) === dealValue(fb, 1);
    if (!same || !vSame) {
      mismatches++;
      if (firstBad < 0) {
        firstBad = seed;
        console.log(`  MISMATCH seed=${seed}: pure=${JSON.stringify(fa)} inplace=${JSON.stringify(fb)}`);
      }
    }
  }
  if (mismatches === 0) {
    console.log(`  PASS — identical finishing order on all ${nDeals} deals.`);
  } else {
    console.log(`  FAIL — ${mismatches}/${nDeals} deals diverged (first bad seed ${firstBad}).`);
  }
}

// ----------------------------------------------------------------------------------------------
// Throughput. Both cores call createDeal each iteration (fair, identical work); we also measure
// createDeal alone so we can report the NET rollout speedup with that shared overhead removed.
// ----------------------------------------------------------------------------------------------

const rng0 = makeRng(0); // unused by heuristic, just to satisfy the signature

function timeCreateOnly(n: number): number {
  let sink = 0;
  for (let i = 0; i < 500; i++) sink += createDeal(2, makeRng(i)).toAct;
  const t0 = now();
  for (let i = 0; i < n; i++) sink += createDeal(2, makeRng(i + 1)).hands.length;
  const ms = now() - t0;
  if (sink < 0) console.log(sink);
  return ms;
}

function timeRollout(
  label: string,
  fn: (s: GameState, myTeam: number, rng: Rng) => number,
  n: number,
): { ms: number; checksum: number } {
  // warm
  let sink = 0;
  for (let i = 0; i < 500; i++) sink += fn(createDeal(2, makeRng(i)), 0, rng0);
  const t0 = now();
  let checksum = 0;
  for (let i = 0; i < n; i++) {
    checksum += fn(createDeal(2, makeRng(i + 1)), 0, rng0);
  }
  const ms = now() - t0;
  void label;
  void sink;
  return { ms, checksum };
}

function main(): void {
  console.log("=== Fast (in-place) rollout prototype vs pure rollout ===\n");

  console.log("[Correctness gate] in-place core vs pure core, identical heuristic playout:");
  correctness(5000);

  const N = 30000;
  console.log(`\n[Throughput] ${N} full heuristic-driven deal rollouts each (createDeal included).`);

  const tCreate = timeCreateOnly(N);
  console.log(`  createDeal alone:        ${tCreate.toFixed(0)}ms  (shared overhead in both)`);

  // Run each twice and keep the faster (reduces noise from GC/jit timing).
  function best(fn: (s: GameState, t: number, r: Rng) => number): { ms: number; checksum: number } {
    const a = timeRollout("", fn, N);
    const b = timeRollout("", fn, N);
    return a.ms <= b.ms ? a : b;
  }

  const pure = best(rolloutPure);
  const inplace = best(rolloutInPlace);
  const cloneFull = best(rolloutCloneFullObs);
  const cloneLight = best(rolloutCloneLightObs);
  const inplaceFull = best(rolloutInPlaceFullObs);

  // Sanity: all cores must agree on the aggregate checksum (sum of deal values).
  const sums = [pure, inplace, cloneFull, cloneLight, inplaceFull].map((x) => x.checksum);
  const checksumOk = sums.every((s) => s === sums[0]);

  const row = (label: string, r: { ms: number }) => {
    const gross = N / (r.ms / 1000);
    const net = N / ((r.ms - tCreate) / 1000);
    console.log(
      `  ${label.padEnd(34)} ${r.ms.toFixed(0).padStart(6)}ms   gross ${gross
        .toFixed(0)
        .padStart(6)}/s   net ${net.toFixed(0).padStart(7)}/s`,
    );
  };

  console.log("");
  row("(a) PURE (clone+validate, full obs)", pure);
  row("(b) IN-PLACE (light obs)  [proto]", inplace);
  console.log("  --- attribution ---");
  row("clone, NO validate, full obs", cloneFull);
  row("clone, NO validate, light obs", cloneLight);
  row("in-place, full obs (outOfPlay)", inplaceFull);

  const netPure = pure.ms - tCreate;
  const netInplace = inplace.ms - tCreate;
  console.log(`\n  Checksums agree across all cores: ${checksumOk ? "YES" : "NO (BUG!)"}`);
  console.log(
    `  GROSS speedup (incl. createDeal):  ${(pure.ms / inplace.ms).toFixed(2)}x`,
  );
  console.log(
    `  NET   speedup (rollout work only): ${(netPure / netInplace).toFixed(2)}x`,
  );

  // Attribution deltas on NET time.
  const net = (r: { ms: number }) => r.ms - tCreate;
  const nPure = net(pure);
  const nCloneFull = net(cloneFull);
  const nCloneLight = net(cloneLight);
  const nInplace = net(inplace);
  console.log("\n  Where the net savings come from (share of total pure->inplace gain):");
  const totalGain = nPure - nInplace;
  const pct = (x: number) => `${((x / totalGain) * 100).toFixed(0)}%`;
  console.log(`    drop validate (pure -> clone,full):      ${pct(nPure - nCloneFull)}`);
  console.log(`    drop outOfPlay (clone,full -> clone,light): ${pct(nCloneFull - nCloneLight)}`);
  console.log(`    drop clone/alloc (clone,light -> in-place): ${pct(nCloneLight - nInplace)}`);
  console.log();
}

main();
