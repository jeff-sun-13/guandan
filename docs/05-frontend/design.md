# Frontend Design

The thing the human will actually use first. The #1 complaint about guandan.cards is **bad
mobile UX**, so mobile-first is the whole point.

## Principles
- **Mobile-first, portrait.** Design for a phone held one-handed; desktop is a bonus.
- **Thumb-reachable controls.** Play/Pass and card selection live in the lower third.
- **The engine owns game truth.** The UI is a thin renderer of `GameState` + dispatcher of
  `Move`s. No rules logic in components (it belongs in `packages/engine`).
- **Bots run off the main thread.** Run bot computation in a **Web Worker** so the UI never
  freezes while a bot "thinks".
- **Readable at a glance:** clear current-trick display, whose turn, both teams' levels, card
  counts left per player, and which cards are wild this deal.

## M1 screens (minimum)
- **Table view:** 4 seats (you bottom, partner top, opponents sides), center pile showing the
  current trick, level indicator, turn indicator.
- **Your hand:** sorted, tap to select a combo, with legal-move validation feedback
  (highlight playable combos; disable illegal selections).
- **Actions:** Play / Pass; auto-pass option; clear selection.
- **Between deals:** show finish order, level changes, and the tribute/return exchange.
- **New game / settings:** difficulty (which bot version), maybe a seed for reproducible deals.

## Nice-to-haves (M2+)
- Animations for plays/tribute, sort options, hints (suggest a move from a bot), undo-misclick
  guard, local save/resume, color-blind-friendly suits, larger-text mode.

## Tech notes
- React + Vite. Test on a real phone over LAN early (`vite --host`).
- Keep components dumb; a small store mirrors engine state and the worker boundary.
- Defer the CSS framework choice until we start M1 UI (Tailwind vs CSS modules) — keep it
  simple and fast on mobile.
