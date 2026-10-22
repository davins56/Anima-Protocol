/** Frequency bands, signal strength and spawn visibility (pure, testable). */
export type Band = "delta" | "theta" | "alpha" | "beta" | "gamma" | "omega";
export type SignalType = "benign" | "companion" | "hostile" | "noise";

export const BANDS: Array<{ band: Band; min: number; max: number; color: string; label: string }> = [
  { band: "delta", min: 0, max: 15, color: "#8b5cf6", label: "Δ delta" },
  { band: "theta", min: 15, max: 30, color: "#6366f1", label: "Θ theta" },
  { band: "alpha", min: 30, max: 50, color: "#22d3ee", label: "Α alpha" },
  { band: "beta", min: 50, max: 70, color: "#22c55e", label: "Β beta" },
  { band: "gamma", min: 70, max: 90, color: "#f59e0b", label: "Γ gamma" },
  { band: "omega", min: 90, max: 100, color: "#f8fafc", label: "Ω omega" },
];

export const SERENITY_SIGNATURE_FREQ = 96.3;

export function bandOf(freq: number) {
  const f = Math.min(100, Math.max(0, freq));
  return BANDS.find((b) => f >= b.min && f < b.max) || BANDS[BANDS.length - 1];
}

/** Gaussian falloff around the node's frequency; `width` is the tuner's selectivity. */
export function signalStrength(nodeFreq: number, tuned: number, width = 3): number {
  const d = nodeFreq - tuned;
  return Math.exp(-(d * d) / (2 * width * width));
}

/** Min strength before a node is "locked" and can be opened. */
export const LOCK_THRESHOLD = 0.6;

export type SpawnRules = {
  hours?: number[];
  chance?: number;
  min_strength?: number;
  radius_m?: number;
  persona?: { name: string; personality?: string; greeting?: string };
  persona_hint?: string;
};

function dayHash(id: string, day: string): number {
  let h = 2166136261;
  const s = id + day;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** Deterministic per-day spawn: same answer all day on every device. */
export function isSpawned(nodeId: string, rules: SpawnRules = {}, now = new Date()): boolean {
  if (rules.hours?.length && !rules.hours.includes(now.getHours())) return false;
  if (rules.chance != null && rules.chance < 1) {
    return dayHash(nodeId, now.toISOString().slice(0, 10)) < rules.chance;
  }
  return true;
}

/** Equirectangular metres between two lat/lng points (fine for < 50 km). */
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const x = ((b.lng - a.lng) * Math.PI) / 180 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const y = ((b.lat - a.lat) * Math.PI) / 180;
  return Math.sqrt(x * x + y * y) * R;
}
