import { useState } from "react";
import { type Player, type DealScore, type MatchState, teamOf } from "@guandan/engine";
import { type Slot, type PendingTribute, type TributeSummary, HUMAN } from "../game/useGuandanGame";
import { CardView } from "./CardView";
import { cardFace, levelLabel } from "../game/format";

const SEAT_NAMES: Record<Player, string> = { 0: "You", 1: "Opp ▶", 2: "Partner", 3: "◀ Opp" };
const teamName = (team: number) => (team === 0 ? "Your team" : "Opponents");
const cardText = (card: number, level: number) => {
  const f = cardFace(card, level);
  return `${f.label}${f.suit}`;
};

interface TributeReturnProps {
  pending: PendingTribute;
  tribute: TributeSummary;
  slots: Slot[];
  level: number;
  onConfirm: (key: number) => void;
}

/** Shown when the human RECEIVES tribute: preview who paid what, then pick a card to give back. */
export function TributeReturn({ pending, tribute, slots, level, onConfirm }: TributeReturnProps) {
  const [pick, setPick] = useState<number | null>(null);
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h2>Tribute 进贡</h2>
        <ul className="tribute-preview">
          {tribute.items.map((it, i) => (
            <li key={i} className={it.to === HUMAN ? "to-you" : ""}>
              {SEAT_NAMES[it.from]} → {SEAT_NAMES[it.to]}: <b>{cardText(it.card, level)}</b>
            </li>
          ))}
        </ul>
        <p className="overlay-note">
          You received <b>{cardText(pending.tributeCard, level)}</b> from {SEAT_NAMES[pending.payer]}.
          Choose a card to give back (any card but that one):
        </p>
        <div className="tribute-hand">
          {slots.map((s) => {
            const disabled = s.key === pending.disabledKey;
            return (
              <CardView
                key={s.key}
                card={s.card}
                level={level}
                selected={pick === s.key}
                onClick={disabled ? undefined : () => setPick(s.key)}
              />
            );
          })}
        </div>
        <button
          className="btn btn-play wide"
          disabled={pick === null}
          onClick={() => pick !== null && onConfirm(pick)}
        >
          Give back{pick !== null ? ` ${cardText(slots.find((s) => s.key === pick)!.card, level)}` : ""}
        </button>
      </div>
    </div>
  );
}

interface DealOverProps {
  finish: Player[];
  score: DealScore;
  before: MatchState;
  after: MatchState;
  onNext: () => void;
}

/** Shown between deals: finishing order + the level change it produced. */
export function DealOver({ finish, score, before, after, onNext }: DealOverProps) {
  const wonMatch = after.winner !== null;
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h2>Deal over</h2>
        <ol className="finish-list">
          {finish.map((seat, i) => (
            <li key={seat} className={teamOf(seat) === score.winningTeam ? "win" : ""}>
              <span className="finish-pos">#{i + 1}</span> {SEAT_NAMES[seat]}
            </li>
          ))}
        </ol>
        <p className="overlay-note">
          {teamName(score.winningTeam)} won <b>{score.pattern}</b> (+{score.advance}).{" "}
          Your team {levelLabel(before.levels[0])} → <b>{levelLabel(after.levels[0])}</b>,{" "}
          opponents {levelLabel(before.levels[1])} → <b>{levelLabel(after.levels[1])}</b>.
        </p>
        <button className="btn btn-play wide" onClick={onNext}>
          {wonMatch ? "See result" : "Next deal"}
        </button>
      </div>
    </div>
  );
}

interface MatchOverProps {
  winner: number;
  onNewGame: () => void;
}

export function MatchOver({ winner, onNewGame }: MatchOverProps) {
  const youWon = winner === 0;
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h2>{youWon ? "🎉 You win the match!" : "Opponents win the match"}</h2>
        <p className="overlay-note">
          {youWon
            ? "Your team reached A and finished 1-2 or 1-3."
            : "The opposing team took it at level A."}
        </p>
        <button className="btn btn-play wide" onClick={onNewGame}>
          New game
        </button>
      </div>
    </div>
  );
}
