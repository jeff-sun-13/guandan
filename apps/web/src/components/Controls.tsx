import { type Move } from "@guandan/engine";
import { type Interp } from "../game/useGuandanGame";
import { comboName, comboLabel } from "../game/format";

interface Props {
  isHumanTurn: boolean;
  canPlay: boolean;
  canPass: boolean;
  selectionMove: Move | null;
  selectionCount: number;
  /** Distinct legal readings of the current selection (chooser shown when 2+). */
  interpretations: Interp[];
  chosenKey: string | null;
  onChoose: (key: string) => void;
  onPlay: () => void;
  onPass: () => void;
  onClear: () => void;
}

export function Controls({
  isHumanTurn,
  canPlay,
  canPass,
  selectionMove,
  selectionCount,
  interpretations,
  chosenKey,
  onChoose,
  onPlay,
  onPass,
  onClear,
}: Props) {
  let feedback = "";
  if (!isHumanTurn) feedback = "Waiting for other players…";
  else if (selectionMove && selectionMove.kind === "play")
    feedback = `${comboName(selectionMove.combo.type)} ready`;
  else if (selectionCount > 0) feedback = "Not a legal play here";
  else feedback = "Select cards to play";

  const ambiguous = isHumanTurn && interpretations.length >= 2;

  return (
    <div className="controls">
      {ambiguous && (
        <div className="interp-chooser">
          <span className="interp-label">Play as:</span>
          {interpretations.map((it) => (
            <button
              key={it.key}
              className={`interp-btn ${it.key === chosenKey ? "interp-active" : ""}`}
              onClick={() => onChoose(it.key)}
            >
              {comboLabel(it.combo)}
            </button>
          ))}
        </div>
      )}
      <div className={`controls-feedback ${canPlay ? "ok" : selectionCount > 0 && isHumanTurn ? "bad" : ""}`}>
        {feedback}
      </div>
      <div className="controls-buttons">
        <button className="btn btn-ghost" onClick={onClear} disabled={selectionCount === 0}>
          Clear
        </button>
        <button className="btn btn-pass" onClick={onPass} disabled={!canPass}>
          Pass
        </button>
        <button className="btn btn-play" onClick={onPlay} disabled={!canPlay}>
          Play
        </button>
      </div>
    </div>
  );
}
