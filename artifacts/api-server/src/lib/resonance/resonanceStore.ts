/** Resonance nodes/encounters (supabase/migrations/20261022180000_resonance_layer.sql). */
import { getPool } from "@workspace/db";

export const BANDS = [
  { band: "delta", min: 0, max: 15 },
  { band: "theta", min: 15, max: 30 },
  { band: "alpha", min: 30, max: 50 },
  { band: "beta", min: 50, max: 70 },
  { band: "gamma", min: 70, max: 90 },
  { band: "omega", min: 90, max: 100 },
] as const;
export const SIGNAL_TYPES = ["benign", "companion", "hostile", "noise"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export function bandFor(freq: number): string {
  const f = Math.min(100, Math.max(0, freq));
  return (BANDS.find((b) => f >= b.min && f < b.max) || BANDS[BANDS.length - 1]).band;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic tuning + map placement for a companion (stable across devices). */
export function placementFor(characterId: string): { frequency: number; band: string; position: { x: number; y: number; z: number } } {
  const h = hash(characterId);
  // Companions live in alpha/beta (30–70); omega is reserved for signatures.
  const frequency = Math.round((30 + (h % 4000) / 100) * 10) / 10;
  const angle = ((h >>> 12) % 360) * (Math.PI / 180);
  const r = 3 + ((h >>> 20) % 50) / 10;
  return { frequency, band: bandFor(frequency), position: { x: +(Math.cos(angle) * r).toFixed(2), y: 0, z: +(Math.sin(angle) * r).toFixed(2) } };
}

export type ResonanceNode = {
  id: string;
  user_id: string | null;
  character_id: string | null;
  label: string;
  band: string;
  frequency: number;
  signal_type: SignalType;
  is_signature: boolean;
  position: { x: number; y: number; z: number };
  geo_lat: number | null;
  geo_lng: number | null;
  spawn_rules: Record<string, unknown>;
  created_by: string;
};

const NODE_COLS = `id, user_id, character_id, label, band, frequency, signal_type, is_signature, position,
  geo_lat, geo_lng, spawn_rules, created_by`;

export async function listNodes(userId: string): Promise<{ nodes: ResonanceNode[]; bands: unknown[] }> {
  const pool = getPool();
  const [nodes, bands] = await Promise.all([
    pool.query<ResonanceNode>(
      `SELECT ${NODE_COLS} FROM resonance_nodes
        WHERE (user_id IS NULL OR user_id = $1) AND retired_at IS NULL
        ORDER BY frequency`,
      [userId],
    ),
    pool.query(`SELECT band, min_freq, max_freq, color, description FROM resonance_bands ORDER BY min_freq`),
  ]);
  return { nodes: nodes.rows, bands: bands.rows };
}

export async function syncCompanionNodes(userId: string, companions: Array<{ id: string; name: string }>): Promise<number> {
  let created = 0;
  for (const c of companions.slice(0, 100)) {
    if (!c?.id || !c?.name) continue;
    const p = placementFor(c.id);
    const { rows } = await getPool().query(
      `INSERT INTO resonance_nodes (user_id, character_id, label, band, frequency, signal_type, position, created_by, seed_key)
       VALUES ($1, $2, $3, $4, $5, 'companion', $6::jsonb, 'auto', $7)
       ON CONFLICT DO NOTHING RETURNING id`,
      [userId, c.id, String(c.name).slice(0, 80), p.band, p.frequency, JSON.stringify(p.position), `companion:${c.id}`],
    );
    created += rows.length;
  }
  return created;
}

export async function createNode(userId: string, b: Record<string, any>): Promise<ResonanceNode> {
  const frequency = Number(b.frequency);
  if (!Number.isFinite(frequency) || frequency < 0 || frequency > 100) throw Object.assign(new Error("frequency must be 0–100"), { status: 400 });
  const signal = SIGNAL_TYPES.includes(b.signal_type) ? b.signal_type : "benign";
  const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 80) : "Unknown signal";
  const pos = b.position && typeof b.position === "object" ? b.position : placementFor(label + Date.now()).position;
  const position = { x: Number(pos.x) || 0, y: Number(pos.y) || 0, z: Number(pos.z) || 0 };
  const rules = b.spawn_rules && typeof b.spawn_rules === "object" ? b.spawn_rules : {};
  if (JSON.stringify(rules).length > 4000) throw Object.assign(new Error("spawn_rules too large"), { status: 413 });
  const lat = Number.isFinite(b.geo_lat) ? Math.max(-90, Math.min(90, b.geo_lat)) : null;
  const lng = Number.isFinite(b.geo_lng) ? Math.max(-180, Math.min(180, b.geo_lng)) : null;
  const { rows } = await getPool().query<ResonanceNode>(
    `INSERT INTO resonance_nodes (user_id, character_id, label, band, frequency, signal_type, position, geo_lat, geo_lng, spawn_rules, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, 'user') RETURNING ${NODE_COLS}`,
    [userId, typeof b.character_id === "string" ? b.character_id : null, label, bandFor(frequency), frequency, signal, JSON.stringify(position), lat, lng, JSON.stringify(rules)],
  );
  return rows[0];
}

export async function retireNode(userId: string, nodeId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `UPDATE resonance_nodes SET retired_at = now() WHERE id = $1::uuid AND user_id = $2 AND retired_at IS NULL RETURNING id`,
    [nodeId, userId],
  );
  return rows.length > 0;
}

export async function logEncounter(
  userId: string,
  b: Record<string, any>,
): Promise<{ encounter: Record<string, unknown>; memory_event_id: string | null; character_id: string | null }> {
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const mode = ["map", "ar", "pan"].includes(b.mode) ? b.mode : "map";
  const { rows } = await getPool().query<{ r: any }>(
    `SELECT log_resonance_encounter($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9) AS r`,
    [
      userId,
      String(b.node_id || ""),
      typeof b.character_id === "string" ? b.character_id : null,
      typeof b.session_id === "string" ? b.session_id : null,
      num(b.tuned_frequency, 0),
      Math.max(0, Math.min(1, num(b.signal_strength, 0))),
      mode,
      Number.isFinite(b.geo_lat) ? b.geo_lat : null,
      Number.isFinite(b.geo_lng) ? b.geo_lng : null,
    ],
  );
  return rows[0].r;
}
