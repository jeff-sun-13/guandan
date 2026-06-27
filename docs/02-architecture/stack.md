# Tech Stack

## Decision: TypeScript everywhere
One language for engine, bots, frontend, and (later) server. Reasons:
- Agents write the code; TS has the best tooling and the human can *read* it.
- Lets the **same engine** run in the browser (gameplay) and in Node (bot simulation/training)
  with zero porting.
- Strong static types catch whole classes of rules bugs.

## Components & choices
| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict mode) | see above |
| Package manager / monorepo | **pnpm workspaces** | simple, fast, no extra build tool to learn |
| Engine | **plain TS, zero runtime deps** | portable, fast, testable in isolation |
| Tests | **Vitest** | fast, TS-native; the engine lives or dies by tests |
| Frontend build | **Vite** | fastest path to a running React app, great mobile dev via LAN |
| UI framework | **React** | largest ecosystem & agent familiarity |
| Styling | TBD (likely **Tailwind** or plain CSS modules) | decide at M1 start; keep it simple/mobile-first |
| State (UI) | React state/Zustand (TBD) | engine holds game truth; UI state is thin |
| Server (M3) | **Node + ws/uWebSockets**, TBD framework | authoritative real-time state |
| DB (M3) | **Postgres** (managed) or SQLite to start | persistence for multiplayer |
| Hosting (M2) | static host: Vercel/Netlify/Cloudflare Pages | free, trivial for client-only app |
| Hosting (M3) | Fly.io / Railway | cheap always-on server for sockets |

## Things deliberately deferred
- CSS framework, UI state library, server framework, DB — decided at the milestone that
  needs them, not now. Don't pre-commit.

## Runtime targets
- **Node 20+** for dev/tooling and bot sims.
- Modern mobile browsers (iOS Safari, Android Chrome) for the app — test on a real phone.

## Open question for the human (one-time setup)
- Node + pnpm need to be installed on the dev machine. See `progress/status.md` "Next actions".
