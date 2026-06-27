import { type GameState, type MatchState, type Player } from "@guandan/engine";
import { type Board, type BoardAction } from "../game/useGuandanGame";
import { CardView } from "./CardView";
import { comboName, levelLabel } from "../game/format";

const SEAT_NAMES: Record<Player, string> = {
  0: "You",
  1: "Opp ▶",
  2: "Partner",
  3: "◀ Opp",
};

/** A seat's last action this trick: a mini row of cards, or a "Pass" chip. */
function ActionView({ action, level }: { action: BoardAction | null; level: number }) {
  if (!action) return <div className="seat-play seat-play-empty" />;
  if (action.kind === "pass") return <div className="seat-play"><span className="pass-chip">Pass</span></div>;
  return (
    <div className="seat-play">
      {action.combo.cards.map((c, i) => (
        <CardView key={`${c}-${i}`} card={c} level={level} size="sm" />
      ))}
    </div>
  );
}

interface SeatProps {
  seat: Player;
  deal: GameState;
  thinkingSeat: Player | null;
  action: BoardAction | null;
}

function Seat({ seat, deal, thinkingSeat, action }: SeatProps) {
  const count = deal.hands[seat]?.length ?? 0;
  const finishPos = deal.finished.indexOf(seat);
  const out = finishPos !== -1;
  const isTurn = deal.toAct === seat;
  const thinking = thinkingSeat === seat;
  return (
    <div className={`seat ${isTurn ? "seat-turn" : ""} ${out ? "seat-out" : ""}`}>
      <div className="seat-name">{SEAT_NAMES[seat]}</div>
      <div className="seat-meta">
        {out ? (
          <span className="seat-rank">#{finishPos + 1}</span>
        ) : (
          <span className="seat-count">🂠 {count}</span>
        )}
        {thinking && <span className="seat-thinking">…thinking</span>}
      </div>
      <ActionView action={action} level={deal.level} />
    </div>
  );
}

interface Props {
  deal: GameState;
  match: MatchState;
  thinkingSeat: Player | null;
  board: Board;
}

/** The current center pile: the live winning combo, or the persisted winner after a trick ends. */
function centerWinner(deal: GameState, board: Board): { combo: BoardAction; by: Player } | null {
  if (deal.trick) return { combo: { kind: "play", combo: deal.trick.topCombo }, by: deal.trick.topPlayer };
  for (let seat = 0; seat < board.length; seat++) {
    const a = board[seat];
    if (a && a.kind === "play") return { combo: a, by: seat };
  }
  return null;
}

export function Table({ deal, match, thinkingSeat, board }: Props) {
  const center = centerWinner(deal, board);
  return (
    <section className="table">
      <div className="levels">
        <span className="level-chip you">
          Your team <b>{levelLabel(match.levels[0])}</b>
        </span>
        <span className="level-chip playing">
          Playing <b>{levelLabel(deal.level)}</b>
        </span>
        <span className="level-chip opp">
          Opponents <b>{levelLabel(match.levels[1])}</b>
        </span>
      </div>

      <div className="table-grid">
        <div className="pos-top">
          <Seat seat={2} deal={deal} thinkingSeat={thinkingSeat} action={board[2] ?? null} />
        </div>
        <div className="pos-left">
          <Seat seat={3} deal={deal} thinkingSeat={thinkingSeat} action={board[3] ?? null} />
        </div>

        <div className="pos-center">
          {center && center.combo.kind === "play" ? (
            <div className="trick">
              <div className="trick-cards">
                {center.combo.combo.cards.map((c, i) => (
                  <CardView key={`${c}-${i}`} card={c} level={deal.level} size="sm" />
                ))}
              </div>
              <div className="trick-meta">
                {comboName(center.combo.combo.type)} · by {SEAT_NAMES[center.by]}
                {!deal.trick && deal.toAct >= 0 ? ` · ${SEAT_NAMES[deal.toAct as Player]} leads` : ""}
              </div>
            </div>
          ) : (
            <div className="trick trick-empty">
              <div className="trick-meta">
                {deal.toAct >= 0 ? `${SEAT_NAMES[deal.toAct as Player]} leads` : "—"}
              </div>
            </div>
          )}
        </div>

        <div className="pos-right">
          <Seat seat={1} deal={deal} thinkingSeat={thinkingSeat} action={board[1] ?? null} />
        </div>
      </div>
    </section>
  );
}
