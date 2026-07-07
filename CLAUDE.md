# Guandan — Project Front Door (read this first)

You are an AI agent working on **Guandan**: a mobile-friendly website to play the
card game Guandan (掼蛋) against strong bots, and eventually other people online.

This file is the entry point. Read it, then read whatever section of `docs/` your task
touches. **Do not start coding before reading the relevant docs.**

## What we're building (one paragraph)
A web app where a single player plays Guandan against 3 bots, fully client-side to start.
Later: online multiplayer. The long-term north star is **the strongest Guandan bots that
exist anywhere.** Everything bends toward that goal.

## The prime directive
The **game engine** (`packages/engine`) is the crown jewel. It must be:
- **Pure** — no UI, no network, no I/O, no global state. Just functions over game state.
- **Deterministic** — all randomness flows through a seeded RNG passed in explicitly.
- **Fast** — a strong bot will simulate millions of hypothetical games. No allocations in
  hot paths where avoidable; the engine must run headless in Node at high throughput.
If you are ever tempted to put rules logic inside a React component or a server handler,
**stop** — it belongs in the engine.

## Where things live
- `docs/` — all planning/reference/progress. See `docs/README.md` for the map.
- `packages/engine/` — pure game rules (the crown jewel). *(not created yet)*
- `packages/bots/` — bot implementations, all built on the engine. *(not created yet)*
- `apps/web/` — the React frontend. *(not created yet)*
- `apps/server/` — multiplayer backend. *(future)*

## Before you finish a session (required)
1. Update `docs/progress/status.md` to reflect the new current state.
2. Append a dated entry to `docs/progress/changelog.md`.
3. If you hit anything surprising, add it to `docs/gotchas.md`.
4. If you made an architecture decision, add it to `docs/02-architecture/decisions.md`.

## Key facts about the human
- Codes in Python at work; **does not know TypeScript** but can read code. Explain choices
  in plain terms. Agents do essentially all the writing.
- Wants to **start small** and ship a playable game vs bots first.
- Cares most about **bot strength** as the eventual differentiator vs guandan.cards.
- **The real end goal (2026-06-28):** the strongest COORDINATING BOT PAIR for the human + his
  girlfriend (a human team) to play 2v2 against. Playable speed matters (~1s/move is fine);
  bot-pair coordination/signalling is a design problem (both bots run the same code).
- **Working style:** maximize strength as a long research campaign; integrate into the product
  ONCE, at the end — do not wire bots into the app incrementally. Prefers agents keep going
  autonomously; stop only when genuinely blocked on him.

## Session orientation (any machine: desktop CLI, phone/cloud, box)
This repo is the full memory: read `docs/progress/status.md` FIRST — it always leads with what is
running where and what the next agent should do. Heavy compute belongs on the Hetzner eval box
(178.156.158.230 while it lives — the live-box block in `tools/remote/README.md` is authoritative),
NOT the dev machine (the human uses it for gaming; local eval loads have caused crashes for him).
Cloud sessions cannot SSH (HTTPS-only sandbox) — use the GitHub Actions bridge instead:
`box-sync.yml` reads results into `box-results/`, `box-exec.yml` runs commands on the box
(playbook in status.md 2026-07-02 section). Never commit private keys (public repo).
