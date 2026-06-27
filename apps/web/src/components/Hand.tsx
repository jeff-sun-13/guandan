import { type HandStack } from "../game/useGuandanGame";
import { CardView } from "./CardView";

/** Horizontal offset (px) between overlapping cards in a stack — enough to reveal the corner index. */
const OFFSET = 20;

interface Props {
  stacks: HandStack[];
  level: number;
  /** Selected card keys. */
  selected: Set<number>;
  onToggle: (key: number) => void;
  /** Tap a stack header to select/deselect the whole pile. */
  onToggleStack: (keys: number[]) => void;
  onUngroup: (groupIndex: number) => void;
}

function Stack({ stack, level, selected, onToggle, onToggleStack, onUngroup }: {
  stack: HandStack;
  level: number;
  selected: Set<number>;
  onToggle: (key: number) => void;
  onToggleStack: (keys: number[]) => void;
  onUngroup: (groupIndex: number) => void;
}) {
  const keys = stack.cards.map((c) => c.key);
  const width = 42 + (stack.cards.length - 1) * OFFSET; // base card width + fanned overlap
  return (
    <div className={`card-stack ${stack.kind === "group" ? "card-stack-group" : ""}`}>
      <div className="card-stack-cards" style={{ width }}>
        {stack.cards.map((slot, i) => (
          <div className="stack-card" style={{ left: i * OFFSET, zIndex: i }} key={slot.key}>
            <CardView
              card={slot.card}
              level={level}
              selected={selected.has(slot.key)}
              onClick={() => onToggle(slot.key)}
            />
          </div>
        ))}
      </div>
      {stack.kind === "group" ? (
        <button
          type="button"
          className="stack-tag stack-tag-group"
          onClick={() => onUngroup(stack.groupIndex as number)}
          title="Ungroup"
        >
          ✕ ungroup
        </button>
      ) : (
        <button
          type="button"
          className="stack-tag"
          onClick={() => onToggleStack(keys)}
          title="Select all"
        >
          {stack.cards.length}×
        </button>
      )}
    </div>
  );
}

/**
 * The human's hand as fanned stacks: loose cards auto-stack by rank; manual groups sit first
 * (peeled to the left). Each card carries a stable key so duplicates select independently and
 * groups persist across turns. Tap a card to select it; tap a stack's tag to select the pile.
 */
export function Hand({ stacks, level, selected, onToggle, onToggleStack, onUngroup }: Props) {
  return (
    <div className="hand">
      {stacks.map((stack) => (
        <Stack
          key={stack.id}
          stack={stack}
          level={level}
          selected={selected}
          onToggle={onToggle}
          onToggleStack={onToggleStack}
          onUngroup={onUngroup}
        />
      ))}
    </div>
  );
}
