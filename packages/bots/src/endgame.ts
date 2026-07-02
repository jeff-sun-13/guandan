// Exact endgame solver (2026-07-01, task: "endgame exactness"). When few cards remain, the deal is
// a small perfect-information game — solve it EXACTLY instead of estimating with noisy heuristic
// rollouts. Endgames are where finishing order (the whole objective) gets decided, and the rollout
// policy (heuristicBot) has no real endgame logic beyond "go out if you can": it misplays bomb
// timing, control handoffs, and forced sequences that a 2-ply-deep exact search nails.
//
// Model: on a DETERMINIZED full state (all hands visible — same setting as every ISMCTS leaf), the
// deal is 2-team zero-sum: team {0,2} maximizes the final deal value (dealValue, our +3/+2/+1
// mapping), team {1,3} minimizes; partners cooperate perfectly (they share the team objective).
// Plain alpha-beta over that value with cheapest-first move ordering. A node budget guards against
// blow-ups: `solveEndgame` returns null when the position is too big — the caller falls back to
// its usual leaf. Values are exact, so a solved leaf is strictly better information than a rollout.
//
// Intended integration (gate on `pnpm evald` before flipping any default): in the ISMCTS rollout
// leaf, when `cardsRemaining(state) <= threshold`, try solveEndgame first, fall back to the rollout.

import {
  legalMoves,
  applyMoveTrusted,
  isTerminal,
  result,
  teamOf,
  isBomb,
  type GameState,
  type Move,
  type Combo,
  type Player,
} from "@guandan/engine";
import { dealValue } from "./value";

/** Total cards still in play across all four hands — the endgame-trigger size. */
export function cardsRemaining(state: GameState): number {
  let n = 0;
  for (let p = 0; p < 4; p++) n += (state.hands[p] as number[]).length;
  return n;
}

export interface EndgameSolve {
  /** Exact deal value from team {0,2}'s perspective, in {±1, ±2, ±3}. */
  value: number;
  /** The optimal move for `state.toAct` (null only for a terminal input). */
  move: Move | null;
  /** Nodes expanded (diagnostics/budgeting). */
  nodes: number;
}

/** Cheapest-first ordering key (mirrors the heuristic/search convention): low plays first, bombs last. */
function powerKey(c: Combo): number {
  if (!isBomb(c.type)) return c.rank;
  if (c.type === "jokerBomb") return 100000;
  if (c.type === "straightFlush") return 10000 + c.rank;
  return 1000 + c.length * 100 + c.rank;
}

/** Move ordering for pruning: go-out first (usually decisive), then cheapest plays, pass last. */
function orderedMoves(state: GameState, seat: Player): Move[] {
  const legal = legalMoves(state, seat);
  const handSize = (state.hands[seat] as number[]).length;
  const goOut: Move[] = [];
  const plays: Extract<Move, { kind: "play" }>[] = [];
  let pass: Move | null = null;
  for (const m of legal) {
    if (m.kind === "pass") pass = m;
    else if (m.cards.length === handSize) goOut.push(m);
    else plays.push(m);
  }
  plays.sort((a, b) => powerKey(a.combo) - powerKey(b.combo));
  const out: Move[] = [...goOut, ...plays];
  if (pass) out.push(pass);
  return out;
}

/**
 * Exactly solve a (small) perfect-information endgame with alpha-beta. Returns null if the
 * `maxNodes` budget is exceeded (position too large — fall back to a rollout) — never a partial
 * or approximate answer. Deterministic; no RNG involved.
 */
export function solveEndgame(state: GameState, opts: { maxNodes?: number } = {}): EndgameSolve | null {
  const budget = opts.maxNodes ?? 200_000;
  let nodes = 0;
  let aborted = false;

  function search(s: GameState, alpha: number, beta: number): number {
    if (isTerminal(s)) return dealValue(result(s), 0);
    if (++nodes > budget) {
      aborted = true;
      return 0; // value is meaningless once aborted; the caller discards everything
    }
    const seat = s.toAct;
    const maximizing = teamOf(seat) === 0;
    let best = maximizing ? -Infinity : Infinity;
    for (const m of orderedMoves(s, seat)) {
      const v = search(applyMoveTrusted(s, m), alpha, beta);
      if (aborted) return 0;
      if (maximizing) {
        if (v > best) best = v;
        if (best > alpha) alpha = best;
      } else {
        if (v < best) best = v;
        if (best < beta) beta = best;
      }
      if (beta <= alpha) break; // prune
      // Deal values are bounded: ±3 is unbeatable for the side that achieved it — stop early.
      if (maximizing ? best === 3 : best === -3) break;
    }
    return best;
  }

  if (isTerminal(state)) return { value: dealValue(result(state), 0), move: null, nodes: 0 };

  const seat = state.toAct;
  const maximizing = teamOf(seat) === 0;
  let bestMove: Move | null = null;
  let best = maximizing ? -Infinity : Infinity;
  let alpha = -Infinity;
  let beta = Infinity;
  for (const m of orderedMoves(state, seat)) {
    const v = search(applyMoveTrusted(state, m), alpha, beta);
    if (aborted) return null;
    if (maximizing ? v > best : v < best) {
      best = v;
      bestMove = m;
    }
    if (maximizing) {
      if (best > alpha) alpha = best;
    } else {
      if (best < beta) beta = best;
    }
    if (maximizing ? best === 3 : best === -3) break;
  }
  return { value: best, move: bestMove, nodes };
}
