/** mulberry32 — the state is a plain uint32 carried inside SimState, so replays are exact. */
export function nextRandom(state: number): [value: number, next: number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

export function seedFrom(input: string | number): number {
  if (typeof input === "number" && Number.isFinite(input)) return input >>> 0 || 1;
  let h = 2166136261;
  const s = String(input);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0 || 1;
}

/** FNV-1a over a canonical JSON string — used for client/server state agreement. */
export function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}
