import { type Card } from "@guandan/engine";
import { cardFace } from "../game/format";

interface Props {
  card: Card;
  level: number;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
}

/** A single playing card. Wild cards (Heart of the level rank) get a glow + badge. */
export function CardView({ card, level, selected, onClick, size = "md" }: Props) {
  const f = cardFace(card, level);
  const cls = [
    "card",
    `card-${size}`,
    `tone-${f.tone}`,
    selected ? "card-selected" : "",
    f.wild ? "card-wild" : "",
    onClick ? "card-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={cls} onClick={onClick} disabled={!onClick}>
      <span className="card-corner">
        {f.label}
        <span className="card-corner-suit">{f.suit}</span>
      </span>
      <span className="card-label">{f.label}</span>
      <span className="card-suit">{f.suit}</span>
      {f.wild && <span className="card-wild-badge">WILD</span>}
    </button>
  );
}
