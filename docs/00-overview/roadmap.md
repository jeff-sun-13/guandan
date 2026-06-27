# Roadmap

Milestones are sequential. Don't start one before the previous is "done" enough.
Each milestone should leave the project in a working, demoable state.

## M0 — Foundations (docs + tooling)  ← we are here
**Goal:** repo scaffolded, docs in place, anyone can run a "hello world".
- [x] Decide stack (TypeScript everywhere) — see `02-architecture/stack.md`.
- [x] Create docs structure.
- [ ] Confirm Guandan rules (resolve `01-rules/open-questions.md` with the human).
- [x] Scaffold the monorepo (pnpm workspaces): `packages/engine`, `apps/web`.
- [x] Get a trivial Vite + React page running (verified: tests pass, builds, serves 200).
- [ ] Confirm the page opens on the human's phone over LAN.
**Done when:** `pnpm dev` shows a page on the phone over local network.

## M1 — Playable vs 3 bots (the big one)
**Goal:** a full match of Guandan vs 3 bots, client-side only.
- [ ] Engine: card model, deal, legal-move generation, trick resolution, level/round flow.
- [ ] Engine test suite (this is where most rigor goes).
- [ ] Bot v0 (random legal) then v1 (heuristic) — see `04-bots/roadmap.md`.
- [ ] Web UI: hand, table, play/pass, current trick, levels, mobile-first.
- [ ] Tribute/return-tribute flow between rounds.
**Done when:** human plays a full match to a game-winning level on their phone, no illegal
moves, rules feel right.

## M2 — Make it good
- [ ] Polish UX (animations, sort hands, undo-misclick guards, hints).
- [ ] Bot v2 (search / determinized MCTS).
- [ ] Save/resume a game locally.
- [ ] Deploy as a static site (Vercel/Netlify/Cloudflare Pages) so it's on a real URL.

## M3 — Online multiplayer
- [ ] Backend (Node + WebSockets), rooms, reconnection, authoritative server state.
- [ ] DB for game persistence; minimal auth.
- [ ] Deploy server (Fly.io/Railway, ~few $/mo).

## M4+ — Best-in-world bots (the long game)
- [ ] Self-play training infrastructure (engine runs headless at scale).
- [ ] Bot v3 (learned policy/value), evaluation harness vs prior bots and vs guandan.cards.
See `04-bots/roadmap.md` for the detailed bot track, which can advance in parallel once the
engine is stable.
