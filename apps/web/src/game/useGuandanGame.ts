// The game controller. Holds the engine/match state, drives bot turns, and exposes a small
// view + actions to the components.
//
// The engine owns all rules; this hook only sequences deals/turns and translates the human's
// card selection into an engine Move. Human is always seat 0 (bottom of the table).
//
// Bot moves are computed in a Web Worker (bot-worker.ts, ADR-0017): the search bots burn ~1–2 s
// of CPU per decision, which would freeze the UI on the main thread. Each bot turn ships
// (observation, legal moves) to the worker and applies the move it returns, with a floor delay
// so instant decisions (forced moves, the easy bot) stay watchable.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Card,
  type Move,
  type Player,
  type GameState,
  type MatchState,
  type DealScore,
  type Combo,
  classify,
  beats,
  isBomb,
  isJoker,
  cardRank,
  singleValue,
  makeRng,
  createMatch,
  dealLevel,
  scoreDeal,
  applyDealResult,
  createDeal,
  applyMove,
  isTerminal,
  result,
  observe,
  legalMoves,
  planTribute,
  defaultReturnCard,
} from "@guandan/engine";
import { sortHandForDisplay } from "./format";
import type { Difficulty, MoveRequest, MoveResponse } from "./bot-protocol";

export const HUMAN: Player = 0;
/** Floor on a bot turn's visible duration, so instant decisions remain watchable. */
const BOT_MIN_DELAY_MS = 750;

export type Status = "playing" | "tribute" | "dealOver" | "matchOver";

export interface TributeItem {
  from: Player;
  to: Player;
  card: Card;
  returnCard: Card | null;
}
export interface TributeSummary {
  cancelled: boolean;
  leader: Player;
  items: TributeItem[];
}

/** When the human RECEIVES tribute, they choose a return card before play begins. */
export interface PendingTribute {
  /** The opponent the return card goes to (the one who paid the human). */
  payer: Player;
  /** The card the human received (cannot be handed straight back — rules.md §8). */
  tributeCard: Card;
  /** The exact received-card slot, which the return picker disables. */
  disabledKey: number;
}

/** What a seat most recently did in the current trick — shown on the table. */
export type BoardAction =
  | { kind: "play"; combo: Combo }
  | { kind: "pass" };

/** Per-seat last action this trick (index = seat). Drives the table history. */
export type Board = (BoardAction | null)[];

function emptyBoard(): Board {
  return [null, null, null, null];
}

/** One physical card in the human's hand, with a STABLE key so groups/selection survive
 *  re-sorts and other copies being played (the double deck means duplicate card ids). */
export interface Slot {
  key: number;
  card: Card;
}

/** A rendered pile in the hand: either a manual group, or an auto rank-stack of loose cards. */
export interface HandStack {
  id: string;
  kind: "group" | "rank";
  /** Index into `groups` when kind === "group" (for ungrouping). */
  groupIndex?: number;
  cards: Slot[];
}

interface Snapshot {
  seed: number;
  match: MatchState;
  deal: GameState;
  level: number;
  prevFinish: Player[] | null;
  status: Status;
  tribute: TributeSummary | null;
  /** Set while status === "tribute": the human's return-card choice is outstanding. */
  pending?: PendingTribute;
  /** Each seat's most recent action in the current trick (winner persists across resolution). */
  board: Board;
  // populated when status === "dealOver":
  finish?: Player[];
  score?: DealScore;
  nextMatch?: MatchState;
}

// --- pure helpers ------------------------------------------------------------

/** A crude "weakness" key so we can pick the minimal sufficient interpretation. */
function powerKey(c: Combo): number {
  if (!isBomb(c.type)) return c.rank; // 2..17
  if (c.type === "jokerBomb") return 100000;
  if (c.type === "straightFlush") return 10000 + c.rank;
  return 1000 + c.length * 100 + c.rank; // numeric bomb
}

function weakest(combos: Combo[]): Combo {
  return combos.reduce((a, b) => (powerKey(b) < powerKey(a) ? b : a));
}

/**
 * Turn the human's selected cards into a Move, or null if the selection isn't a legal play.
 * When leading we prefer the weakest non-bomb reading (don't waste bombs); when following we
 * pick the weakest reading that still beats the trick (minimal overplay).
 */
export function chooseMove(selected: Card[], deal: GameState): Move | null {
  if (selected.length === 0) return null;
  const interps = classify(selected, deal.level);
  if (interps.length === 0) return null;

  if (!deal.trick) {
    const nonBombs = interps.filter((c) => !isBomb(c.type));
    const pool = nonBombs.length > 0 ? nonBombs : interps;
    return { kind: "play", cards: selected, combo: weakest(pool) };
  }
  const top = deal.trick.topCombo;
  const winning = interps.filter((c) => beats(c, top));
  if (winning.length === 0) return null;
  return { kind: "play", cards: selected, combo: weakest(winning) };
}

/** A distinct legal reading of the selected cards (e.g. "straight" vs "straight flush"). */
export interface Interp {
  key: string;
  combo: Combo;
}

const interpKey = (c: Combo): string => `${c.type}:${c.rank}`;

/**
 * Every distinct legal reading of `selected` in the current context, weakest first. When leading,
 * that's all interpretations; when following, only those that beat the live trick. `classify`
 * already dedupes by (type, rank), so this list is what the human picks among when it has 2+.
 */
export function legalInterps(selected: Card[], deal: GameState): Interp[] {
  if (selected.length === 0) return [];
  let interps = classify(selected, deal.level);
  if (deal.trick) {
    const top = deal.trick.topCombo;
    interps = interps.filter((c) => beats(c, top));
  }
  return interps
    .slice()
    .sort((a, b) => powerKey(a) - powerKey(b))
    .map((combo) => ({ key: interpKey(combo), combo }));
}

function takeCard(hand: Card[], card: Card): void {
  const i = hand.indexOf(card);
  if (i !== -1) hand.splice(i, 1);
}

function resortHand(hand: Card[], level: number): void {
  hand.sort((a, b) => singleValue(a, level) - singleValue(b, level));
}

/**
 * Apply the tribute plan to a freshly dealt deal (mutates hands, sets the leader). All payments
 * happen first; bot receivers auto-return immediately, but a return owed BY the human is left
 * pending (returnCard null) so the human can choose it. Returns the summary + the human's incoming
 * tribute (if any) so the caller can open the return picker.
 */
function setupTribute(
  deal: GameState,
  finish: Player[],
  level: number,
): { summary: TributeSummary; humanTribute: { payer: Player; card: Card } | null } {
  const plan = planTribute(finish, deal.hands, level);
  deal.toAct = plan.leader;
  if (plan.cancelled) {
    return { summary: { cancelled: true, leader: plan.leader, items: [] }, humanTribute: null };
  }

  // 1) Apply every payment, so each receiver's hand reflects what it now holds.
  for (const t of plan.tributes) {
    takeCard(deal.hands[t.payer] as Card[], t.card);
    (deal.hands[t.receiver] as Card[]).push(t.card);
  }

  // 2) Resolve returns: bots auto-give-back now; a human receiver's return is deferred.
  const items: TributeItem[] = [];
  let humanTribute: { payer: Player; card: Card } | null = null;
  for (const t of plan.tributes) {
    if (t.receiver === HUMAN) {
      humanTribute = { payer: t.payer, card: t.card };
      items.push({ from: t.payer, to: t.receiver, card: t.card, returnCard: null });
      continue;
    }
    const receiverHand = deal.hands[t.receiver] as Card[];
    const payerHand = deal.hands[t.payer] as Card[];
    const back = defaultReturnCard(receiverHand, t.card, level);
    takeCard(receiverHand, back);
    payerHand.push(back);
    resortHand(payerHand, level);
    resortHand(receiverHand, level);
    items.push({ from: t.payer, to: t.receiver, card: t.card, returnCard: back });
  }
  return { summary: { cancelled: false, leader: plan.leader, items }, humanTribute };
}

function freshGame(seed: number): Snapshot {
  const match = createMatch(makeRng(seed));
  const level = dealLevel(match);
  const deal = createDeal(level, match.rng);
  return {
    seed,
    match,
    deal,
    level,
    prevFinish: null,
    status: "playing",
    tribute: null,
    board: emptyBoard(),
  };
}

/** After any move, fold the deal forward and detect the end of the deal. */
function afterMove(snap: Snapshot, deal: GameState): Snapshot {
  if (!isTerminal(deal)) return { ...snap, deal };
  const finish = result(deal);
  return {
    ...snap,
    deal,
    status: "dealOver",
    finish,
    score: scoreDeal(finish),
    nextMatch: applyDealResult(snap.match, finish),
  };
}

/**
 * Apply `move` by `seat`, updating both the deal and the table board:
 *  - a LEAD (no live trick) starts a fresh board with just the leader's play;
 *  - a follow records that seat's play/pass;
 *  - when the move RESOLVES the trick (trick existed, now gone, deal not over), the board is
 *    cleared to show only the winning combo — it persists until that winner leads the next trick.
 */
function applyLogged(snap: Snapshot, seat: Player, move: Move): Snapshot {
  const wasLeading = snap.deal.trick === null;
  const next = applyMove(snap.deal, move);

  let board: Board;
  if (snap.deal.trick !== null && next.trick === null && !isTerminal(next)) {
    // The trick just resolved (always via the final pass): keep only the winner's combo.
    const won = snap.deal.trick;
    board = emptyBoard();
    board[won.topPlayer] = { kind: "play", combo: won.topCombo };
  } else if (wasLeading && move.kind === "play") {
    // New trick: a fresh board with the leader's opening play.
    board = emptyBoard();
    board[seat] = { kind: "play", combo: move.combo };
  } else {
    board = snap.board.slice();
    board[seat] = move.kind === "play" ? { kind: "play", combo: move.combo } : { kind: "pass" };
  }
  return afterMove({ ...snap, board }, next);
}

// --- the hook ----------------------------------------------------------------

/** Bucket key for auto rank-stacks: jokers stack with their own kind, others by rank. */
function rankKey(card: Card): number {
  return isJoker(card) ? 1000 + card : cardRank(card);
}

export function useGuandanGame(initialSeed = 1) {
  const [snap, setSnap] = useState<Snapshot>(() => freshGame(initialSeed));

  // The human's hand as keyed instances + manual groups + selection. Selection is by KEY so the
  // double deck's duplicate cards select independently and groups survive other copies leaving.
  const keyRef = useRef(0);
  const makeSlots = useCallback((cards: Card[]): Slot[] => {
    return sortHandForDisplay(cards).map((card) => ({ key: keyRef.current++, card }));
  }, []);

  const [slots, setSlots] = useState<Slot[]>(() => makeSlots(snap.deal.hands[HUMAN] as Card[]));
  const [groups, setGroups] = useState<number[][]>([]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  // When the selection is ambiguous, which reading the human picked (null = use the weakest).
  const [chosenKey, setChosenKey] = useState<string | null>(null);

  const slotByKey = useMemo(() => {
    const m = new Map<number, Slot>();
    for (const s of slots) m.set(s.key, s);
    return m;
  }, [slots]);

  const selectedCards = useMemo(
    () =>
      [...selected]
        .map((k) => slotByKey.get(k)?.card)
        .filter((c): c is Card => c !== undefined),
    [selected, slotByKey],
  );

  // Build the rendered piles: manual groups first (in order), then loose cards as rank-stacks.
  const stacks = useMemo<HandStack[]>(() => {
    const grouped = new Set(groups.flat());
    const byValue = (a: Slot, b: Slot) =>
      singleValue(a.card, snap.level) - singleValue(b.card, snap.level) || a.card - b.card;

    const out: HandStack[] = [];
    groups.forEach((g, gi) => {
      const cards = g
        .map((k) => slotByKey.get(k))
        .filter((s): s is Slot => !!s)
        .sort(byValue);
      if (cards.length) out.push({ id: `g${gi}`, kind: "group", groupIndex: gi, cards });
    });

    const loose = slots.filter((s) => !grouped.has(s.key));
    const buckets = new Map<number, Slot[]>();
    for (const s of loose) {
      const rk = rankKey(s.card);
      const arr = buckets.get(rk);
      if (arr) arr.push(s);
      else buckets.set(rk, [s]);
    }
    [...buckets.values()]
      .map((cards) => cards.sort(byValue))
      .sort((a, b) => byValue(a[0] as Slot, b[0] as Slot))
      .forEach((cards) => out.push({ id: `r${rankKey(cards[0]!.card)}`, kind: "rank", cards }));
    return out;
  }, [slots, groups, slotByKey, snap.level]);

  const isHumanTurn = snap.status === "playing" && snap.deal.toAct === HUMAN;
  const thinkingSeat =
    snap.status === "playing" && snap.deal.toAct !== HUMAN && snap.deal.toAct >= 0
      ? snap.deal.toAct
      : null;

  // Which bot fills the three non-human seats (bot-worker.ts maps this to a registry config).
  const [difficulty, setDifficulty] = useState<Difficulty>("best");

  // The bot worker, created once per mount. Requests carry a monotonic id; only the response to
  // the NEWEST request is ever applied, so a terminated/superseded search can't corrupt the game.
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  useEffect(() => {
    const w = new Worker(new URL("./bot-worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    return () => {
      workerRef.current = null;
      w.terminate();
    };
  }, []);

  // Drive bot turns: ship the acting seat's observation to the worker, apply the returned move.
  // The search itself provides the "thinking" pause (~1–2 s); a floor keeps instant moves visible.
  useEffect(() => {
    const w = workerRef.current;
    if (thinkingSeat === null || !w) return;
    const seat = thinkingSeat;
    const id = ++reqIdRef.current;
    const sentAt = performance.now();
    let timer: number | undefined;

    const onMessage = (e: MessageEvent<MoveResponse>) => {
      if (e.data.id !== id) return; // response to a superseded request — drop it
      w.removeEventListener("message", onMessage);
      const wait = Math.max(0, BOT_MIN_DELAY_MS - (performance.now() - sentAt));
      timer = window.setTimeout(() => {
        setSnap((s) =>
          s.status === "playing" && s.deal.toAct === seat ? applyLogged(s, seat, e.data.move) : s,
        );
      }, wait);
    };
    w.addEventListener("message", onMessage);
    const req: MoveRequest = {
      id,
      difficulty,
      obs: observe(snap.deal, seat),
      legal: legalMoves(snap.deal, seat),
    };
    w.postMessage(req);
    return () => {
      w.removeEventListener("message", onMessage);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [snap, thinkingSeat, difficulty]);

  // A new/changed selection resets the ambiguity pick back to the default (weakest reading).
  useEffect(() => {
    setChosenKey(null);
  }, [selectedCards]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Selection is allowed any time (so you can plan/group while bots act); only PLAY is gated.
  const toggleKey = useCallback((key: number) => {
    setSelected((sel) => {
      const next = new Set(sel);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** Toggle a whole pile at once (tap a stack's header): select all, or clear if all selected. */
  const toggleMany = useCallback((keys: number[]) => {
    setSelected((sel) => {
      const next = new Set(sel);
      const allSelected = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allSelected) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }, []);

  /** Pull the selected cards out into their own group (peeled off to the left). */
  const groupSelected = useCallback(() => {
    setGroups((gs) => {
      const sel = [...selected];
      if (sel.length === 0) return gs;
      const cleaned = gs.map((g) => g.filter((k) => !selected.has(k))).filter((g) => g.length > 0);
      return [...cleaned, sel];
    });
    setSelected(new Set());
  }, [selected]);

  const ungroup = useCallback((groupIndex: number) => {
    setGroups((gs) => gs.filter((_, i) => i !== groupIndex));
  }, []);

  const play = useCallback(() => {
    if (!isHumanTurn) return;
    const interps = legalInterps(selectedCards, snap.deal);
    const chosen = interps.find((i) => i.key === chosenKey) ?? interps[0];
    if (!chosen) return;
    const move: Move = { kind: "play", cards: selectedCards, combo: chosen.combo };
    const played = new Set(selected);
    setSnap((s) => applyLogged(s, HUMAN, move));
    setSlots((ss) => ss.filter((s) => !played.has(s.key)));
    setGroups((gs) => gs.map((g) => g.filter((k) => !played.has(k))).filter((g) => g.length > 0));
    setSelected(new Set());
    setChosenKey(null);
  }, [isHumanTurn, selectedCards, selected, snap.deal, chosenKey]);

  const pass = useCallback(() => {
    setSnap((s) => {
      if (s.status !== "playing" || s.deal.toAct !== HUMAN || !s.deal.trick) return s;
      return applyLogged(s, HUMAN, { kind: "pass" });
    });
    setSelected(new Set());
  }, []);

  // Reset the keyed hand to a freshly dealt 27 (groups don't carry across deals).
  const resetHand = useCallback(
    (cards: Card[]) => {
      setSlots(makeSlots(cards));
      setGroups([]);
      setSelected(new Set());
    },
    [makeSlots],
  );

  const nextDeal = useCallback(() => {
    const s = snap;
    if (s.status !== "dealOver" || !s.nextMatch || !s.finish) return;
    const match = s.nextMatch;
    if (match.winner !== null) {
      setSnap({ ...s, match, status: "matchOver" });
      return;
    }
    const level = dealLevel(match);
    const deal = createDeal(level, match.rng);
    const { summary, humanTribute } = setupTribute(deal, s.finish, level);
    const base = {
      seed: s.seed,
      match,
      deal,
      level,
      prevFinish: s.finish,
      tribute: summary,
      board: emptyBoard(),
    } as const;

    if (humanTribute) {
      // The human received tribute — pause on the return picker before play.
      const newSlots = makeSlots(deal.hands[HUMAN] as Card[]);
      const received = newSlots.find((sl) => sl.card === humanTribute.card);
      setSlots(newSlots);
      setGroups([]);
      setSelected(new Set());
      setSnap({
        ...base,
        status: "tribute",
        pending: {
          payer: humanTribute.payer,
          tributeCard: humanTribute.card,
          disabledKey: received?.key ?? -1,
        },
      });
    } else {
      setSnap({ ...base, status: "playing" });
      resetHand(deal.hands[HUMAN] as Card[]);
    }
  }, [snap, makeSlots, resetHand]);

  /** The human commits their return-tribute card (any card but the one they just received). */
  const confirmReturn = useCallback(
    (key: number) => {
      const s = snap;
      if (s.status !== "tribute" || !s.pending) return;
      const slot = slotByKey.get(key);
      if (!slot || key === s.pending.disabledKey) return;
      const deal = s.deal;
      takeCard(deal.hands[HUMAN] as Card[], slot.card);
      (deal.hands[s.pending.payer] as Card[]).push(slot.card);
      resortHand(deal.hands[s.pending.payer] as Card[], s.level);
      const items = s.tribute
        ? s.tribute.items.map((it) =>
            it.to === HUMAN && it.returnCard === null ? { ...it, returnCard: slot.card } : it,
          )
        : [];
      setSnap({
        ...s,
        status: "playing",
        pending: undefined,
        tribute: s.tribute ? { ...s.tribute, items } : null,
      });
      resetHand(deal.hands[HUMAN] as Card[]);
    },
    [snap, slotByKey, resetHand],
  );

  const newGame = useCallback(() => {
    const next = freshGame(snap.seed + 1);
    setSnap(next);
    resetHand(next.deal.hands[HUMAN] as Card[]);
  }, [snap.seed, resetHand]);

  // The distinct legal readings of the current selection (for the ambiguity chooser).
  const interpretations = useMemo(
    () => (isHumanTurn ? legalInterps(selectedCards, snap.deal) : []),
    [isHumanTurn, selectedCards, snap.deal],
  );
  // Stale picks self-heal: fall back to the weakest reading if the chosen key isn't available.
  const chosenInterp =
    interpretations.find((i) => i.key === chosenKey) ?? interpretations[0] ?? null;
  const selectionMove: Move | null = chosenInterp
    ? { kind: "play", cards: selectedCards, combo: chosenInterp.combo }
    : null;

  return {
    snap,
    stacks,
    slots,
    selected,
    selectedCards,
    isHumanTurn,
    thinkingSeat,
    difficulty,
    setDifficulty,
    selectionMove,
    interpretations,
    chosenKey: chosenInterp?.key ?? null,
    chooseInterp: setChosenKey,
    confirmReturn,
    canPlay: isHumanTurn && selectionMove !== null,
    canPass: isHumanTurn && snap.deal.trick !== null,
    canGroup: selected.size >= 2,
    toggleKey,
    toggleMany,
    groupSelected,
    ungroup,
    clearSelection,
    play,
    pass,
    nextDeal,
    newGame,
  };
}
