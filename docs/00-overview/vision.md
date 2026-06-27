# Vision

## Problem
The human plays Guandan on **guandan.cards**, which is (1) unusable on mobile and (2) has
weak bots. We want a site that is great on mobile and has, eventually, the best Guandan
bots anywhere.

## Product goals (in priority order)
1. **A correct, complete Guandan engine.** If the rules are wrong, nothing else matters.
2. **Excellent mobile play vs bots.** Smooth, fast, thumb-friendly. This is the first thing
   the human will actually use.
3. **Strong bots.** The long-term differentiator. "Best in the world" is the aspiration;
   "clearly better than guandan.cards" is the near-term bar.
4. **Online multiplayer.** Play with friends. Deferred until single-player is solid.

## Explicit non-goals (for now)
- Accounts, social features, chat, ranking/ELO ladder.
- Native mobile apps (the web app must just work well on a phone browser).
- Monetization.

## Success criteria
- **M1 success:** the human can play a full match vs 3 bots on their phone, the bots never
  make illegal moves, and the rules feel correct.
- **Long-term success:** in head-to-head or fixed-scenario tests, our bot beats the
  guandan.cards bot decisively, and ideally strong human players find it challenging.

## Operating constraints
- Agents do nearly all coding; the human reviews and plays. Favor clarity and good docs
  over cleverness.
- Budget: a few $/month for hosting is acceptable when we get there.
