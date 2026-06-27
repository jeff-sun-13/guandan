# Repo Structure (target)

Monorepo via pnpm workspaces. Not all of this exists yet — created milestone by milestone.

```
guandan/
├─ CLAUDE.md                 # agent front door
├─ docs/                     # all planning/reference/progress (this dir)
├─ package.json              # workspace root
├─ pnpm-workspace.yaml
├─ tsconfig.base.json        # shared TS config (strict)
├─ packages/
│  ├─ engine/                # ★ pure rules. no deps, no UI. the crown jewel.
│  │  ├─ src/
│  │  │  ├─ cards.ts         # card/deck model, ranking
│  │  │  ├─ combos.ts        # combo detection & comparison
│  │  │  ├─ state.ts         # GameState type + transitions
│  │  │  ├─ moves.ts         # legal move generation
│  │  │  ├─ deal.ts          # deal/trick/round flow
│  │  │  ├─ rng.ts           # seeded RNG (deterministic)
│  │  │  └─ index.ts         # public API
│  │  └─ test/               # Vitest — the bulk of project rigor lives here
│  └─ bots/                  # bot implementations, all import engine only
│     └─ src/                # v0 random, v1 heuristic, … (see 04-bots/roadmap.md)
├─ apps/
│  ├─ web/                   # React + Vite frontend (M1)
│  │  └─ src/
│  └─ server/                # multiplayer backend (M3, future)
└─ tools/                    # sim/eval/training scripts (Node), import engine+bots
```

## Conventions
- **Dependency direction:** `web`/`server`/`bots`/`tools` → depend on `engine`. Nothing
  depends on `web`. `engine` depends on nothing.
- The engine must never import from React, Node-only APIs, or any package outside it.
- Shared types (GameState, Move, Card) are exported from `engine` and reused everywhere.
- Bots receive only **observable** state (see glossary) — never the full hidden GameState.
- Tests live next to the package they test. Engine tests are mandatory and thorough.
