import type { BandKey } from "./bands";

export const COLS = 6; // BN end-fight room: player 3×3 (cols 0–2) + enemy 3×3 (cols 3–5), per W layer
export const ROWS = 3;
export const PLAYER_MAX_COL = 2;
export const TICK_MS = 50;

export type Side = "player" | "enemy";
export type PanelKind = "normal" | "cracked" | "broken" | "holy" | "poison";

export type Panel = { kind: PanelKind; /** tick at which a broken/poison panel reverts */ until: number | null };

export type Cell = { layer: number; col: number; row: number };

export type PhaseShift = {
  fromW: number;
  toW: number;
  startTick: number;
  landTick: number;
  /** set when travelling through a portal (instant, free) */
  portalId: string | null;
};

export type Telegraph = {
  /** tick at which the attack resolves */
  at: number;
  cells: Cell[];
  damage: number;
  band: BandKey;
};

export type Unit = {
  id: string;
  side: Side;
  /** companion id for the player navi, virus family for enemies */
  kind: string;
  /** native band: the frequency the unit "belongs" to */
  band: BandKey;
  col: number;
  row: number;
  w: number;
  hp: number;
  maxHp: number;
  stunUntil: number;
  phase: PhaseShift | null;
  telegraph: Telegraph | null;
  nextActTick: number;
};

export type Portal = { id: string; a: Cell; b: Cell; closesAt: number };

export type ChipId =
  | "cannon"
  | "wide_sword"
  | "crack_shot"
  | "poison_seed"
  | "holy_panel"
  | "phase_gate"
  | "resonance_lance"
  | "purify";

export type CorruptionRecord = {
  /** memory_events.id being obscured (never mutated — the server appends memory_corrupted) */
  targetEventId: string;
  tick: number;
  severity: number;
  band: BandKey;
  restored: boolean;
};

export type SimConfig = {
  seed: number;
  /** companion piloting the navi (e.g. "serenity", "aeland", "scarlet" or a user_entities id) */
  companionId: string;
  startW: number;
  enemies: Array<{ kind: string; band: BandKey; hp?: number; w?: number; col?: number; row?: number }>;
  /** memory_events ids eligible for corruption (server-chosen, so replays agree) */
  memoryPool: string[];
  folder?: ChipId[];
  playerHp?: number;
};

export type SimState = {
  version: 1;
  config: SimConfig;
  tick: number;
  rng: number;
  /** panels[layer][row][col] */
  panels: Panel[][][];
  units: Unit[];
  portals: Portal[];
  /** memory resource (0–100): spent by chips/phase shifts, drained by mismatched fighting */
  memory: number;
  custom: { gauge: number; open: boolean; offer: ChipId[] };
  hand: ChipId[];
  folder: ChipId[];
  corruptions: CorruptionRecord[];
  lastCorruptionTick: number;
  outcome: null | "win" | "lose";
  seq: number;
};

/** Player (or AI) input. Every input is stamped with the tick it applies at. */
export type SimAction =
  | { t: "move"; dc: number; dr: number }
  | { t: "phase"; toW: number }
  | { t: "buster" }
  | { t: "chip" }
  | { t: "custom_open" }
  | { t: "custom_pick"; picks: number[] }
  | { t: "purify"; targetEventId?: string };

export type StampedAction = { tick: number; action: SimAction };

/** Everything that happens is an event on the bus; rules turn events into more events. */
export type SimEvent =
  | { type: "action"; action: SimAction; unitId: string }
  | { type: "chip_used"; chip: ChipId; unitId: string; band: BandKey; power: number }
  | { type: "hit"; sourceId: string; targetId: string; amount: number; band: BandKey; cell: Cell }
  | { type: "damage"; targetId: string; amount: number; band: BandKey; sourceId: string }
  | { type: "unit_defeated"; unitId: string }
  | { type: "panel_changed"; cell: Cell; from: PanelKind; to: PanelKind; until: number | null }
  | { type: "unit_left_panel"; unitId: string; cell: Cell }
  | { type: "unit_entered_panel"; unitId: string; cell: Cell }
  | { type: "memory_drain"; amount: number; reason: string }
  | { type: "memory_gain"; amount: number; reason: string }
  | { type: "portal_opened"; portal: Portal }
  | { type: "portal_closed"; portalId: string }
  | { type: "phase_started"; unitId: string; shift: PhaseShift }
  | { type: "phase_landed"; unitId: string; w: number; layer: number; portalId?: string }
  | { type: "telegraph"; unitId: string; telegraph: Telegraph }
  | { type: "memory_corrupted"; targetEventId: string; severity: number; band: BandKey; sourceId: string }
  | { type: "memory_restored"; targetEventId: string }
  | { type: "custom_ready" }
  | { type: "battle_end"; outcome: "win" | "lose" }
  | { type: "rejected"; reason: string };

export type EmittedEvent = SimEvent & { seq: number; tick: number; depth: number; cause: number | null };
