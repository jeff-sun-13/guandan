// Deterministic seeded RNG for the engine.
//
// Why this exists (see CLAUDE.md / docs/03-engine/design.md):
//   - The engine must never call Math.random(). All randomness flows through one of these.
//   - Same seed + same sequence of calls => identical results, forever. This is what makes
//     games reproducible, bugs replayable, and self-play training possible.
//   - The state is PLAIN DATA (a single number), so it can live inside a serializable
//     GameState and be cloned with `cloneRng` for cheap "what if" simulation by bots.
//
// Algorithm: mulberry32 — a tiny, fast, well-distributed 32-bit generator. Plenty of quality
// for shuffling cards and bot sampling; not cryptographic (we don't need that).

export interface Rng {
  /** Internal 32-bit state. Treat as opaque; mutated in place by the step functions. */
  s: number;
}

/** Create an RNG from an integer seed. Any number works; it is coerced to uint32. */
export function makeRng(seed: number): Rng {
  return { s: seed >>> 0 };
}

/** Snapshot/clone an RNG. Use before a simulation so the original sequence is untouched. */
export function cloneRng(rng: Rng): Rng {
  return { s: rng.s };
}

/** Advance the RNG and return a uniformly distributed unsigned 32-bit integer. */
export function nextU32(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) | 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** A float in the half-open interval [0, 1). */
export function nextFloat(rng: Rng): number {
  // 2^32; turns the uint32 into a fraction.
  return nextU32(rng) / 0x100000000;
}

/**
 * A uniformly distributed integer in [0, n). Uses rejection sampling so there is no modulo
 * bias even for large n. `n` must be a positive integer.
 */
export function nextInt(rng: Rng, n: number): number {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`nextInt requires a positive integer, got ${n}`);
  }
  // Largest multiple of n that fits in 2^32; reject draws above it to stay unbiased.
  const limit = 0x100000000 - (0x100000000 % n);
  let x = nextU32(rng);
  while (x >= limit) x = nextU32(rng);
  return x % n;
}

/**
 * In-place Fisher-Yates shuffle. Returns the same array for convenience. Deterministic given
 * the RNG state — the heart of `createDeal`'s seeded shuffle.
 */
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}
