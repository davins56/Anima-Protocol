/**
 * Consequence rules. Each rule listens for one event type on the bus and
 * returns follow-up events; the bus applies them and runs rules on those in
 * turn (breadth-first, depth-capped). This is how a single input ripples out
 * into damage, terrain, memory and topology changes.
 */
import { bandAt, bandDistance, clarityAt, LAYER_COUNT, type BandKey } from "./bands";
import { CHIPS, affinity, PURIFY_MIN_CLARITY } from "./chips";
import { alive, panelAt, unitById, unitCell, unitsAt } from "./consequences";
import { COLS, ROWS, type Cell, type SimEvent, type SimState } from "./types";

export type RuleContext = { state: SimState; rand: () => number };
export type Rule<T extends SimEvent["type"] = SimEvent["type"]> = {
  id: string;
  on: T;
  summary: string;
  derive: (e: Extract<SimEvent, { type: T }>, ctx: RuleContext) => SimEvent[];
};

export const CORRUPTION_COOLDOWN_TICKS = 200;
export const MAX_CORRUPTIONS_PER_BATTLE = 3;
export const BROKEN_TICKS = 80;
export const POISON_TICKS = 120;
export const HOLY_TICKS = 200;
export const PORTAL_TICKS = 160;
/** band distance at which fighting counts as "mismatched" */
export const MISMATCH_DISTANCE = 2;

const player = (s: SimState) => s.units.find((u) => u.side === "player")!;
const enemies = (s: SimState) => s.units.filter((u) => u.side === "enemy");

function firstEnemyInRow(s: SimState, layer: number, row: number, fromCol: number) {
  for (let c = fromCol + 1; c < COLS; c++) {
    const hit = unitsAt(s, { layer, col: c, row }).find((u) => u.side === "enemy");
    if (hit) return hit;
  }
  return undefined;
}

function scaled(s: SimState, base: number, chipBand: BandKey, targetBand: BandKey) {
  const p = player(s);
  return Math.round(base * (0.5 + 0.5 * clarityAt(p.w)) * affinity(chipBand, targetBand, bandDistance(chipBand, targetBand)));
}

function maybeCorrupt(ctx: RuleContext, sourceId: string, severity: number): SimEvent[] {
  const s = ctx.state;
  const open = s.corruptions.filter((c) => !c.restored).map((c) => c.targetEventId);
  const pool = s.config.memoryPool.filter((id) => !open.includes(id));
  if (!pool.length) return [];
  if (s.corruptions.length >= MAX_CORRUPTIONS_PER_BATTLE) return [];
  if (s.lastCorruptionTick >= 0 && s.tick - s.lastCorruptionTick < CORRUPTION_COOLDOWN_TICKS) return [];
  const src = unitById(s, sourceId);
  const target = pool[Math.floor(ctx.rand() * pool.length) % pool.length];
  // Reserve the cooldown now so sibling rules in the same cascade can't double-corrupt.
  s.lastCorruptionTick = s.tick;
  return [{ type: "memory_corrupted", targetEventId: target, severity: Math.min(1, Math.max(0.1, severity)), band: src?.band ?? "noise", sourceId }];
}

/** Typed rule constructor (keeps `derive`'s event narrowed to `on`). */
function rule<T extends SimEvent["type"]>(r: Rule<T>): Rule {
  return r as unknown as Rule;
}

export const RULES: Rule[] = [
  rule({
    id: "chip.effects",
    on: "chip_used",
    summary: "A chip resolves into hits, terrain changes, portals or a purify, scaled by Serenity's clarity at her W.",
    derive: (e, { state: s }) => {
      const p = unitById(s, e.unitId);
      if (!p) return [];
      const cell = unitCell(p);
      const out: SimEvent[] = [];
      const hitAt = (c: Cell, base: number, opts: { crack?: boolean; offLayer?: number } = {}) => {
        for (const t of unitsAt(s, c).filter((u) => u.side === "enemy")) {
          out.push({ type: "hit", sourceId: p.id, targetId: t.id, amount: Math.round(scaled(s, base, e.band, t.band) * (opts.offLayer ?? 1)), band: e.band, cell: c });
          if (opts.crack) out.push({ type: "panel_changed", cell: c, from: panelAt(s, c)!.kind, to: "cracked", until: null });
        }
      };
      switch (e.chip) {
        case "cannon":
        case "crack_shot": {
          const t = firstEnemyInRow(s, cell.layer, cell.row, cell.col);
          if (t) hitAt(unitCell(t), CHIPS[e.chip].power, { crack: e.chip === "crack_shot" });
          break;
        }
        case "wide_sword":
          for (let r = 0; r < ROWS; r++) hitAt({ layer: cell.layer, col: cell.col + 1, row: r }, CHIPS.wide_sword.power);
          break;
        case "poison_seed":
          for (let r = 0; r < ROWS; r++)
            for (let c = 3; c < COLS; c++) {
              const k = s.panels[cell.layer][r][c].kind;
              if (k !== "broken") out.push({ type: "panel_changed", cell: { layer: cell.layer, col: c, row: r }, from: k, to: "poison", until: s.tick + POISON_TICKS });
            }
          break;
        case "holy_panel":
          out.push({ type: "panel_changed", cell, from: panelAt(s, cell)!.kind, to: "holy", until: s.tick + HOLY_TICKS });
          break;
        case "phase_gate": {
          const toLayer = cell.layer + 1 < LAYER_COUNT ? cell.layer + 1 : cell.layer - 1;
          out.push({
            type: "portal_opened",
            portal: { id: `portal-${s.seq}`, a: cell, b: { ...cell, layer: toLayer }, closesAt: s.tick + PORTAL_TICKS },
          });
          break;
        }
        case "resonance_lance":
          for (let l = 0; l < LAYER_COUNT; l++)
            for (let c = cell.col + 1; c < COLS; c++) hitAt({ layer: l, col: c, row: cell.row }, CHIPS.resonance_lance.power, { offLayer: l === cell.layer ? 1 : 0.5 });
          break;
        case "purify": {
          if (clarityAt(p.w) < PURIFY_MIN_CLARITY) return [{ type: "rejected", reason: "purify needs a clear signal (tune toward violet)" }];
          const open = s.corruptions.filter((c) => !c.restored);
          const target = open[open.length - 1];
          if (target) out.push({ type: "memory_restored", targetEventId: target.targetEventId });
          for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++)
              if (s.panels[cell.layer][r][c].kind === "poison")
                out.push({ type: "panel_changed", cell: { layer: cell.layer, col: c, row: r }, from: "poison", to: "normal", until: null });
          break;
        }
      }
      return out;
    },
  }),
  rule({
    id: "hit.damage",
    on: "hit",
    summary: "Hits become damage; holy panels halve it.",
    derive: (e, { state: s }) => {
      const t = unitById(s, e.targetId);
      if (!t || !alive(t)) return [];
      const holy = panelAt(s, unitCell(t))?.kind === "holy";
      return [{ type: "damage", targetId: t.id, amount: holy ? Math.ceil(e.amount / 2) : e.amount, band: e.band, sourceId: e.sourceId }];
    },
  }),
  rule({
    id: "hit.mismatch.corrupts",
    on: "hit",
    summary: "A virus striking Serenity while she is ≥2 bands off its frequency drains memory and may corrupt a memory node (rate-limited).",
    derive: (e, ctx) => {
      const s = ctx.state;
      const t = unitById(s, e.targetId);
      const src = unitById(s, e.sourceId);
      if (!t || t.side !== "player" || !src || src.side !== "enemy") return [];
      if (bandDistance(bandAt(t.w).key, src.band) < MISMATCH_DISTANCE) return [];
      return [{ type: "memory_drain", amount: 4, reason: "mismatch" }, ...maybeCorrupt(ctx, src.id, 0.35 + 0.15 * bandDistance(bandAt(t.w).key, src.band))];
    },
  }),
  rule({
    id: "hit.dissonance",
    on: "hit",
    summary: "Attacking a virus far from your own band costs memory (dissonance).",
    derive: (e, { state: s }) => {
      const src = unitById(s, e.sourceId);
      const t = unitById(s, e.targetId);
      if (!src || src.side !== "player" || !t) return [];
      return bandDistance(bandAt(src.w).key, t.band) >= MISMATCH_DISTANCE ? [{ type: "memory_drain", amount: 2, reason: "dissonance" }] : [];
    },
  }),
  rule({
    id: "hit.noise.cracks",
    on: "hit",
    summary: "Noise-band hits have a 25% chance to crack the panel they land on.",
    derive: (e, ctx) => {
      if (e.band !== "noise") return [];
      const p = panelAt(ctx.state, e.cell);
      if (!p || p.kind !== "normal") return [];
      return ctx.rand() < 0.25 ? [{ type: "panel_changed", cell: e.cell, from: "normal", to: "cracked", until: null }] : [];
    },
  }),
  rule({
    id: "damage.defeat",
    on: "damage",
    summary: "A unit at 0 HP is defeated.",
    derive: (e, { state: s }) => {
      const t = unitById(s, e.targetId);
      return t && t.hp <= 0 ? [{ type: "unit_defeated", unitId: t.id }] : [];
    },
  }),
  rule({
    id: "defeat.outcome",
    on: "unit_defeated",
    summary: "Deleting a virus recovers memory; last virus = win; Serenity down = lose.",
    derive: (e, { state: s }) => {
      const u = unitById(s, e.unitId);
      if (!u) return [];
      if (u.side === "player") return [{ type: "battle_end", outcome: "lose" }];
      const out: SimEvent[] = [{ type: "memory_gain", amount: 10, reason: "harvest" }];
      if (enemies(s).every((x) => !alive(x))) out.push({ type: "battle_end", outcome: "win" });
      return out;
    },
  }),
  rule({
    id: "panel.cracked.breaks",
    on: "unit_left_panel",
    summary: "Stepping off a cracked panel breaks it (impassable) for 4 s.",
    derive: (e, { state: s }) =>
      panelAt(s, e.cell)?.kind === "cracked" ? [{ type: "panel_changed", cell: e.cell, from: "cracked", to: "broken", until: s.tick + BROKEN_TICKS }] : [],
  }),
  rule({
    id: "memory.empty.corrupts",
    on: "memory_drain",
    summary: "Running the memory resource dry forces a corruption.",
    derive: (_e, ctx) => {
      if (ctx.state.memory > 0) return [];
      const src = enemies(ctx.state).find(alive);
      return src ? maybeCorrupt(ctx, src.id, 0.6) : [];
    },
  }),
  rule({
    id: "restore.refund",
    on: "memory_restored",
    summary: "Purifying a memory returns some memory resource.",
    derive: () => [{ type: "memory_gain", amount: 5, reason: "purified" }],
  }),
  rule({
    id: "phase.portal.single_use",
    on: "phase_landed",
    summary: "Travelling through a PhaseGate shortcut closes it (single use).",
    derive: (e) => (e.portalId ? [{ type: "portal_closed", portalId: e.portalId }] : []),
  }),
];

export function rulesFor(type: SimEvent["type"]): Rule[] {
  return RULES.filter((r) => r.on === type);
}
