// Diagnostic: is determinizeWithTribute (greedy highest-first deal) distributionally biased vs a
// UNIFORM sampler that respects the SAME tribute ceiling (rejection sampling)? Both honor the ceiling,
// so any difference in the per-seat hand-value distribution is the greedy method's bias — the suspect
// for why ismcts-rollout-hist lost 33% (2026-06-30). Run: pnpm --filter @guandan/tools exec tsx belief-bias-check.ts
import {
  makeRng,
  determinize,
  singleValue,
  isWild,
  type Observation,
  type Card,
  type GameState,
} from "@guandan/engine";
import { playMatch, randomBot, makeBeliefSampler, type Bot } from "@guandan/bots";

// Capture a real observation whose tribute ceiling actually FORBIDS some live card (else no diagnostic).
let captured: Observation | null = null;
const spy: Bot = (obs, legal, rng) => {
  if (!captured && obs.history && obs.history.tribute.length > 0) {
    const lvl = obs.level;
    const binds = obs.history.tribute.some((t) => {
      const ceil = singleValue(t.card, lvl);
      // some unseen card outranks the ceiling ⇒ the constraint can bite
      return obs.outOfPlay.length + obs.hand.length < 108 && ceil < singleValue(53, lvl);
    });
    if (binds) captured = obs;
  }
  return randomBot(obs, legal, rng);
};
for (let seed = 1; seed <= 40 && !captured; seed++) {
  playMatch([spy, randomBot, randomBot, randomBot], makeRng(seed));
}
if (!captured) {
  console.log("no binding-tribute observation found");
  process.exit(0);
}
const obs: Observation = captured;
const lvl = obs.level;
const ceilings = obs.history!.tribute
  .filter((t) => t.giver !== obs.player)
  .map((t) => [t.giver, singleValue(t.card, lvl)] as const);

const handValue = (h: Card[]) => h.reduce((s, c) => s + singleValue(c, lvl), 0);
function respectsCeiling(w: GameState): boolean {
  for (const [g, ceil] of ceilings)
    for (const c of w.hands[g] as Card[]) if (!isWild(c, lvl) && singleValue(c, lvl) > ceil) return false;
  return true;
}
// Uniform sampler that respects the ceiling via rejection (unbiased baseline).
function rejection(i: number): GameState {
  for (let t = 0; t < 500; t++) {
    const w = determinize(obs, makeRng(900000 + i * 1000 + t));
    if (respectsCeiling(w)) return w;
  }
  return determinize(obs, makeRng(900000 + i)); // give up (shouldn't happen)
}

function summarize(label: string, sampler: (i: number) => GameState) {
  const N = 3000;
  const vals: number[][] = [[], [], [], []];
  let violations = 0;
  for (let i = 0; i < N; i++) {
    const w = sampler(i);
    if (!respectsCeiling(w)) violations++;
    for (let p = 0; p < 4; p++) (vals[p] as number[]).push(handValue(w.hands[p] as Card[]));
  }
  const stats = vals.map((v) => {
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length);
    return `mean ${m.toFixed(0)} sd ${sd.toFixed(0)}`;
  });
  console.log(`${label.padEnd(22)} violations=${violations}  ` + stats.map((s, p) => `seat${p}[${s}]`).join("  "));
}

const greedy = makeBeliefSampler({ useHistory: true, candidates: 1 }); // → determinizeWithTribute
console.log(`obs: me=seat${obs.player} level=${lvl} counts=${JSON.stringify(obs.handCounts)}`);
console.log(`tribute ceilings: ${ceilings.map(([g, c]) => `seat${g}<=${c}`).join(", ")}`);
summarize("UNIFORM+ceiling (rej)", (i) => rejection(i));
summarize("GREEDY (determinize+t)", (i) => greedy(obs, makeRng(800000 + i)));
console.log("\nIf GREEDY's per-seat sd is much lower than UNIFORM+ceiling's, the greedy deal is biased");
console.log("(hands too 'even' across seats) — that's the likely cause, not tribute-as-deduction.");
