# Docs Map

Two layers of docs. Know which kind you're touching.

## Reference layer (stable — trust these, change deliberately)
- `00-overview/vision.md` — what we're building and why; success criteria.
- `00-overview/roadmap.md` — milestones M0…Mn and what "done" means for each.
- `00-overview/strategy-decisions.md` — the **forks that need the human** (search-first vs learned
  bot, compute budget, external benchmark, partner coordination), with evidence + recommendations.
- `00-overview/glossary.md` — Guandan + project terms so everyone uses the same words.
- `01-rules/rules.md` — **authoritative** Guandan rules spec. The engine implements THIS.
- `01-rules/open-questions.md` — rules ambiguities to confirm with the human / guandan.cards.
- `02-architecture/decisions.md` — append-only log of architecture decisions (ADRs).
- `02-architecture/stack.md` — chosen technologies and why.
- `02-architecture/repo-structure.md` — monorepo layout and conventions.
- `03-engine/design.md` — engine data model, API surface, invariants.
- `04-bots/roadmap.md` — the bot ladder (v0→v3) and how the engine must support it.
- `04-bots/v2-search-design.md` — the concrete engineering plan for **bot v2** (client-side
  determinized search / ISMCTS), incl. engine prerequisites and measured perf budget. See ADR-0007.
- `04-bots/learned-leaf-design.md` — **proposal** for the learned value-net leaf (distill the rollout
  → µs inference; strength + interactive speed). Awaiting approval; see ADR-0010 (Proposed).
- `05-frontend/design.md` — UI/UX principles, mobile-first notes.
- `06-prior-art/` — **everything we know about other people's Guandan bots** (the two DanZero
  papers, their public code, our friend's guandan.cards bot) + our blunt analysis of why they
  fall short and how we beat them. See `06-prior-art/README.md`. Read before any bot work past v1.

## Living layer (append/update often)
- `progress/status.md` — single source of truth for "where are we right now."
- `progress/changelog.md` — dated, append-only log of what changed each session.
- `gotchas.md` — surprises, footguns, and hard-won lessons. Add to it liberally.

## Conventions for agents writing docs
- Keep each file focused on one thing. Link rather than duplicate.
- When you assert a rule or decision, say how confident you are and cite the source
  (human confirmation, guandan.cards observation, etc.).
- Prefer editing the right existing file over creating new ones. If you create a new file,
  add it to this map.
- Dates are absolute (YYYY-MM-DD), never "today"/"last week".
