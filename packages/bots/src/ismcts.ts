// Bot v2.2 — Information-Set Monte-Carlo Tree Search (SO-ISMCTS).
//
// Why this over PIMC (bot v2.0/2.1): PIMC samples K worlds, searches each INDEPENDENTLY, and averages.
// That suffers "strategy fusion" — it implicitly assumes it can play a different move in states it
// can't actually tell apart, which is acute in 2v2 Guandan (docs/06-prior-art/pimc-uct-2020.md,
// our-edge.md). ISMCTS instead grows ONE tree keyed by the PUBLIC move history (an information set),
// and re-samples a fresh determinization every iteration. A node aggregates statistics over many
// worlds, so the search commits to a single policy per infoset — exactly the fusion fix the prior art
// calls for (Cowling, Powley & Whitehouse 2012). See docs/04-bots/v2-search-design.md §4 step 3.
//
// Model: the deal is treated as 2-player ZERO-SUM between our team {our seat, partner} and the
// opponents. The leaf value is our team's deal value in [-3,+3] (the +3/+2/+1 finish mapping). At a
// node where our team acts we pick the UCB-best child on that value; where opponents act they
// minimise it (equivalently maximise its complement). Partner is modelled as a cooperative searcher
// of the SAME objective — the principled choice (assumes good partner play), vs PIMC's greedy-
// heuristic teammate. The leaf evaluator is the same pluggable one PIMC uses (static eval by default,
// or a full heuristic rollout), so we can compare like-for-like on the ladder.

import {
  determinize,
  applyMove,
  applyMoveTrusted,
  legalMoves,
  observe,
  isTerminal,
  result,
  teamOf,
  isBomb,
  nextInt,
  type Move,
  type Combo,
  type Observation,
  type Player,
  type GameState,
  type Rng,
} from "@guandan/engine";
import type { Bot } from "./index";
import { heuristicBot, runoutBot } from "./heuristic";
import { boundedStaticValue } from "./static-eval";
import { dealValue, dealValueCtx } from "./value";
import type { LeafEvaluator } from "./pimc";
import type { Sampler } from "./belief";

export interface IsmctsOptions {
  /** Search iterations (tree descents) per decision. More = stronger, slower. Default 1500. */
  iterations?: number;
  /** UCB exploration constant (rewards are normalised to [0,1], so ~√2 is the classic value). */
  c?: number;
  /** Cap on moves considered at EACH node (keeps pass + go-out + cheapest plays). Bounds branching. */
  maxCandidates?: number;
  /**
   * Leaf evaluator for a non-terminal stopping state. Default: the cheap static eval (bounded).
   * CONTRACT: must return values on the DEAL-VALUE scale [-3, 3] — the search normalises with
   * (v+3)/6 and mixes leaf values with exact terminal values, so an out-of-range leaf silently
   * breaks UCB scaling AND makes unfinished positions outscore actual wins (the 2026-07-01 bug).
   */
  leaf?: LeafEvaluator;
  /** Policy for the rollout leaf, when `leaf` is left unset and `rollout` is true. */
  rolloutBot?: Bot;
  /** Use a full heuristic rollout as the leaf instead of the static eval. Default false (static). */
  rollout?: boolean;
  /** How worlds are sampled each iteration. Default: uniform `determinize`. Pass a belief sampler. */
  sampler?: Sampler;
  /**
   * Condition the objective on `Observation.matchCtx` when present (2026-07-01): at a
   * declarer-at-A deal, 1-2/1-3 = match win (±3, equal), 1-4 = a strike (∓0.5), and defender wins
   * also earn the inflicted strike — see value.ts `dealValueCtx`. Applies to terminal values and
   * the ROLLOUT leaf (a custom `leaf` and the static leaf stay unconditioned). Default false
   * until gated on the harness.
   */
  useMatchContext?: boolean;
  /**
   * How the per-node candidate list is trimmed to `maxCandidates` (2026-07-01):
   * - "cheapest" (default, the original): keep the cheapest plays overall. BIAS WARNING: at wide
   *   (leading) nodes a 27-card hand has 25–40+ legal plays, so bombs and top singles/pairs sort
   *   past the cap and are NEVER searched — for us at the root, or for in-tree opponents (their
   *   interruptions go unmodelled). The search structurally cannot consider "seize tempo" plays.
   * - "perType": keep the cheapest few of EVERY combo type (so bombs stay searchable) plus the
   *   highest single (the control lead), à la GS2's top-k-per-action-type (docs/06-prior-art/gs2.md §6).
   */
  candidates?: "cheapest" | "perType";
}

/** One edge out of a tree node: the child plus the ISMCTS selection statistics for that action. */
interface Child {
  node: Node;
  /** N(a): times this action was SELECTED from the parent. */
  selCount: number;
  /** Times this action was AVAILABLE when the parent was visited (the ISMCTS availability count). */
  availCount: number;
  /** Sum of leaf values (our-team-normalised, [0,1]) over iterations that selected this action. */
  reward: number;
}

/** A tree node = the public state reached by a move history. Holds only statistics (edges). */
interface Node {
  visits: number;
  children: Map<string, Child>;
}

/** How a finished deal is valued from a team's view (standard, or match-aware via dealValueCtx). */
type ValueOf = (finish: Player[], team: number) => number;

/** Cheapest-first ordering key (mirrors the heuristic / PIMC): low plays first, bombs last. */
function powerKey(c: Combo): number {
  if (!isBomb(c.type)) return c.rank;
  if (c.type === "jokerBomb") return 100000;
  if (c.type === "straightFlush") return 10000 + c.rank;
  return 1000 + c.length * 100 + c.rank;
}

/**
 * The action's identity in the tree. Keyed by the PUBLIC signature (combo type:rank:length, or
 * "pass"), NOT the exact suits — so the "same" move from different determinizations maps to one node.
 * `legalMoves` emits each (type,rank,length) once per hand (ADR-0004), so keys don't collide.
 */
function moveKey(m: Move): string {
  if (m.kind === "pass") return "pass";
  const c = m.combo;
  return `${c.type}:${c.rank}:${c.length}`;
}

type PlayMove = Extract<Move, { kind: "play" }>;

/**
 * "perType" trimming: guarantee type coverage instead of global cheapness. Keep the cheapest
 * `keepPerType` plays of EVERY combo type present, plus the single highest single (the control
 * lead a cheapest-only cap always drops). If that still exceeds `room`, keep the cheapest ONE per
 * type first, then fill the remainder cheapest-first — coverage survives any cap.
 */
function trimPerType(plays: PlayMove[], room: number, keepPerType = 2): PlayMove[] {
  const byType = new Map<string, PlayMove[]>();
  for (const m of plays) {
    const arr = byType.get(m.combo.type);
    if (arr) arr.push(m);
    else byType.set(m.combo.type, [m]);
  }
  const kept: PlayMove[] = [];
  const overflow: PlayMove[] = [];
  for (const arr of byType.values()) {
    arr.sort((a, b) => powerKey(a.combo) - powerKey(b.combo));
    for (let i = 0; i < arr.length; i++) {
      if (i === 0) kept.push(arr[i] as PlayMove);
      else if (i < keepPerType) overflow.push(arr[i] as PlayMove);
    }
    // The control lead: the TOP single (beats everything but jokers/level) — cheapest-caps drop it.
    const singles = byType.get("single");
    if (arr === singles && arr.length > keepPerType) overflow.push(arr[arr.length - 1] as PlayMove);
  }
  overflow.sort((a, b) => powerKey(a.combo) - powerKey(b.combo));
  const out = kept.concat(overflow.slice(0, Math.max(0, room - kept.length)));
  if (out.length > room) out.length = room; // more types than room: cheapest-one-per-type wins
  out.sort((a, b) => powerKey(a.combo) - powerKey(b.combo));
  return out;
}

/**
 * Legal moves at a node, in EXPANSION-PRIORITY order and capped to `max`. Order: hand-emptying
 * go-out plays first, then plays cheapest-first, then pass last. Pass and go-out are always
 * retained when present. `scheme` picks how the play list is trimmed (see IsmctsOptions.candidates
 * — "cheapest" is the original global-cheapest cap; "perType" keeps every combo type searchable).
 * Exported for tests only.
 */
export function candidatesAt(state: GameState, seat: Player, max: number, scheme: "cheapest" | "perType"): Move[] {
  const legal = legalMoves(state, seat);
  const handSize = (state.hands[seat] as number[]).length;
  const goOut: Move[] = [];
  let plays: PlayMove[] = [];
  let pass: Move | null = null;
  for (const m of legal) {
    if (m.kind === "pass") pass = m;
    else if (m.cards.length === handSize) goOut.push(m);
    else plays.push(m);
  }
  const room = Math.max(0, max - goOut.length - (pass ? 1 : 0));
  if (scheme === "perType" && plays.length > room) {
    plays = trimPerType(plays, room);
  } else {
    plays.sort((a, b) => powerKey(a.combo) - powerKey(b.combo));
    plays = plays.slice(0, room);
  }
  const ordered: Move[] = [...goOut, ...plays];
  if (pass) ordered.push(pass);
  return ordered;
}

/** Build an ISMCTS bot with the given knobs. `ismctsBot` (below) is the default configuration. */
export function makeIsmctsBot(opts: IsmctsOptions = {}): Bot {
  const iterations = opts.iterations ?? 1500;
  const c = opts.c ?? 1.4;
  const maxCandidates = opts.maxCandidates ?? 20;
  const rolloutBot = opts.rolloutBot ?? heuristicBot;
  const sample = opts.sampler ?? determinize;
  const scheme = opts.candidates ?? "cheapest";
  const useMatchCtx = opts.useMatchContext ?? false;
  const leanRollout = rolloutBot === heuristicBot || rolloutBot === runoutBot; // both ignore obs.outOfPlay

  /** Leaf for a given finish valuation (rebuilt per decision when match-aware — a cheap closure). */
  const makeLeaf = (valueOf: ValueOf): LeafEvaluator =>
    opts.leaf ??
    (opts.rollout
      ? // Rollout leaf fast-path: trusted apply (moves are legal by construction) + lean observe
        // (skip the unused outOfPlay array) when the policy is the default heuristic. Pure; see
        // docs/gotchas.md 2026-06-28. This is the champion's hot path, so it directly buys iterations.
        (s, myTeam, rng) => {
          let st = s;
          while (!isTerminal(st)) {
            const seat = st.toAct;
            const obs = leanRollout
              ? observe(st, seat, { includeOutOfPlay: false })
              : observe(st, seat);
            st = applyMoveTrusted(st, rolloutBot(obs, legalMoves(st, seat), rng));
          }
          return valueOf(result(st), myTeam);
        }
      : (s, myTeam) => boundedStaticValue(s, myTeam));

  const plainLeaf = makeLeaf(dealValue);

  return (obs: Observation, legal: Move[], rng: Rng): Move => {
    if (legal.length === 0) throw new Error("ismctsBot got no legal moves");
    if (legal.length === 1) return legal[0] as Move; // forced

    // Match-aware objective (value.ts): only when enabled AND the orchestrator supplied a context.
    const ctx = useMatchCtx ? obs.matchCtx : undefined;
    const valueOf: ValueOf = ctx ? (f, t) => dealValueCtx(f, t, ctx) : dealValue;
    const leaf = ctx ? makeLeaf(valueOf) : plainLeaf;

    const rootTeam = teamOf(obs.player);
    const rootMoves = new Map<string, Move>(legal.map((m) => [moveKey(m), m]));
    const root: Node = { visits: 0, children: new Map() };

    for (let it = 0; it < iterations; it++) {
      runIteration(root, obs, rootTeam, rng, leaf, c, maxCandidates, sample, scheme, valueOf);
    }

    // Robust child: the most-SELECTED root action (ties broken by mean reward). Standard MCTS choice.
    let bestKey: string | null = null;
    let bestSel = -1;
    let bestMean = -Infinity;
    for (const [key, ch] of root.children) {
      const mean = ch.selCount ? ch.reward / ch.selCount : 0;
      if (ch.selCount > bestSel || (ch.selCount === bestSel && mean > bestMean)) {
        bestSel = ch.selCount;
        bestMean = mean;
        bestKey = key;
      }
    }
    const chosen = bestKey != null ? rootMoves.get(bestKey) : undefined;
    return chosen ?? (legal[0] as Move);
  };
}

/** One ISMCTS iteration: determinize → select/expand → evaluate leaf → backpropagate. */
function runIteration(
  root: Node,
  rootObs: Observation,
  rootTeam: number,
  rng: Rng,
  leaf: LeafEvaluator,
  c: number,
  maxCandidates: number,
  sample: Sampler,
  scheme: "cheapest" | "perType",
  valueOf: ValueOf,
): void {
  let state = sample(rootObs, rng); // a fresh world every iteration — the ISMCTS essence
  let node = root;
  const selected: { node: Node; key: string }[] = []; // edges taken (for visit/reward backprop)
  const visited: { node: Node; availKeys: string[] }[] = []; // nodes seen (for availability counts)

  // SELECTION + one EXPANSION.
  while (!isTerminal(state)) {
    const seat = state.toAct;
    const moves = candidatesAt(state, seat, maxCandidates, scheme);
    if (moves.length === 0) break;
    const keyed = moves.map((m) => [moveKey(m), m] as const);
    const availKeys = keyed.map(([k]) => k);
    visited.push({ node, availKeys });

    const untried = keyed.filter(([k]) => !node.children.has(k));
    if (untried.length > 0) {
      // Random untried move. (Deterministic cheapest-first expansion was tried and measured WORSE —
      // it over-commits the spine to greedy lines; random keeps the tree's breadth honest.)
      const [key, move] = untried[nextInt(rng, untried.length)] as readonly [string, Move];
      const childNode: Node = { visits: 0, children: new Map() };
      node.children.set(key, { node: childNode, selCount: 0, availCount: 0, reward: 0 });
      selected.push({ node, key });
      state = applyMove(state, move);
      node = childNode;
      break; // expand exactly one node per iteration, then evaluate
    }

    // All available actions are in the tree → UCB selection from the acting seat's perspective.
    const seatTeam = teamOf(seat);
    let bestKey = availKeys[0] as string;
    let bestMove = keyed[0]![1];
    let bestU = -Infinity;
    for (const [key, move] of keyed) {
      const ch = node.children.get(key) as Child;
      const meanRoot = ch.reward / ch.selCount; // our-team mean value in [0,1]
      const exploit = seatTeam === rootTeam ? meanRoot : 1 - meanRoot; // opponents minimise our value
      const explore = c * Math.sqrt(Math.log(ch.availCount) / ch.selCount);
      const u = exploit + explore;
      if (u > bestU) {
        bestU = u;
        bestKey = key;
        bestMove = move;
      }
    }
    selected.push({ node, key: bestKey });
    state = applyMove(state, bestMove);
    node = node.children.get(bestKey)!.node;
  }

  // LEAF: exact value if terminal, else the (cheap) leaf evaluator. Normalise [-3,3] → [0,1].
  const vRoot = isTerminal(state) ? valueOf(result(state), rootTeam) : leaf(state, rootTeam, rng);
  const q = (vRoot + 3) / 6;

  // BACKPROP. Availability: every available action present in the tree at each visited node.
  for (const { node: nd, availKeys } of visited) {
    for (const k of availKeys) {
      const ch = nd.children.get(k);
      if (ch) ch.availCount++;
    }
  }
  // Visits + reward along the selected edges (reward stored from our team's view; UCB flips per seat).
  for (const { node: nd, key } of selected) {
    nd.visits++;
    const ch = nd.children.get(key) as Child;
    ch.selCount++;
    ch.reward += q;
  }
}

/**
 * Default ISMCTS bot (bot v2.2): static leaf, 1500 iterations. The static leaf keeps each iteration
 * cheap so the tree can grow; whether it out-ranks `pimcStaticBot` is an empirical question for
 * `pnpm ladder`.
 */
export const ismctsBot: Bot = makeIsmctsBot();
