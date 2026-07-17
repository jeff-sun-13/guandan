import { type Player } from "@guandan/engine";
import { type Difficulty } from "./game/bot-protocol";
import { useGuandanGame } from "./game/useGuandanGame";
import { Table } from "./components/Table";
import { Hand } from "./components/Hand";
import { Controls } from "./components/Controls";
import { DealOver, MatchOver, TributeReturn } from "./components/Overlays";
import { cardFace } from "./game/format";

const SEAT_NAMES: Record<Player, string> = { 0: "You", 1: "Opp ▶", 2: "Partner", 3: "◀ Opp" };

export function App() {
  const g = useGuandanGame(1);
  const { snap } = g;
  const tribute = snap.tribute;

  return (
    <main className="app">
      <header className="topbar">
        <h1>
          掼蛋 <span className="dot">·</span> Guandan
        </h1>
        <div className="topbar-actions">
          <select
            className="select"
            value={g.difficulty}
            onChange={(e) => g.setDifficulty(e.target.value as Difficulty)}
            aria-label="Bot strength"
          >
            <option value="best">Bots: best (~2 s)</option>
            <option value="fast">Bots: fast (~1 s)</option>
            <option value="easy">Bots: easy</option>
          </select>
          <button className="btn btn-ghost small" onClick={g.newGame}>
            New game
          </button>
        </div>
      </header>

      {tribute && (
        <div className="tribute-banner">
          {tribute.cancelled ? (
            <span>抗贡 — tribute resisted! {SEAT_NAMES[tribute.leader]} leads.</span>
          ) : (
            <span>
              Tribute:{" "}
              {tribute.items.map((it, i) => {
                const paid = cardFace(it.card, snap.level);
                return (
                  <span key={i} className="tribute-item">
                    {SEAT_NAMES[it.from]} → {SEAT_NAMES[it.to]} ({paid.label}
                    {paid.suit})
                    {i < tribute.items.length - 1 ? "; " : ""}
                  </span>
                );
              })}
            </span>
          )}
        </div>
      )}

      <Table deal={snap.deal} match={snap.match} thinkingSeat={g.thinkingSeat} board={snap.board} />

      <div className="hand-area">
        <div className="hand-label">
          Your hand · {snap.deal.hands[0]?.length ?? 0} cards
          {snap.board[0] && (
            <span className="your-last">
              {" · last: "}
              {snap.board[0].kind === "pass"
                ? "Pass"
                : snap.board[0].combo.cards
                    .map((c) => {
                      const f = cardFace(c, snap.level);
                      return `${f.label}${f.suit}`;
                    })
                    .join(" ")}
            </span>
          )}
        </div>
        <Hand
          stacks={g.stacks}
          level={snap.level}
          selected={g.selected}
          onToggle={g.toggleKey}
          onToggleStack={g.toggleMany}
          onUngroup={g.ungroup}
        />
        <div className="hand-tools">
          <button className="btn btn-ghost small" onClick={g.groupSelected} disabled={!g.canGroup}>
            Group selected
          </button>
        </div>
      </div>

      <Controls
        isHumanTurn={g.isHumanTurn}
        canPlay={g.canPlay}
        canPass={g.canPass}
        selectionMove={g.selectionMove}
        selectionCount={g.selected.size}
        interpretations={g.interpretations}
        chosenKey={g.chosenKey}
        onChoose={g.chooseInterp}
        onPlay={g.play}
        onPass={g.pass}
        onClear={g.clearSelection}
      />

      {snap.status === "dealOver" && snap.finish && snap.score && snap.nextMatch && (
        <DealOver
          finish={snap.finish}
          score={snap.score}
          before={snap.match}
          after={snap.nextMatch}
          onNext={g.nextDeal}
        />
      )}
      {snap.status === "tribute" && snap.pending && snap.tribute && (
        <TributeReturn
          pending={snap.pending}
          tribute={snap.tribute}
          slots={g.slots}
          level={snap.level}
          onConfirm={g.confirmReturn}
        />
      )}
      {snap.status === "matchOver" && snap.match.winner !== null && (
        <MatchOver winner={snap.match.winner} onNewGame={g.newGame} />
      )}
    </main>
  );
}
