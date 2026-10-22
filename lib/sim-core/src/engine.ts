/**
 * Deterministic 4D net-battle engine: a central event bus over the rules in
 * rules.ts and the reducers in consequences.ts.
 *
 *   step(state, {tick, action}) → advance time to `tick`, then resolve the input.
 *   Same config + same stamped actions ⇒ identical state and stateHash, on
 *   the client (optimistic play) and on api-server (replay validation).
 *
 * Inputs never mutate state directly: they emit events, and every system
 * (combat, terrain, memory, topology/portals, W-axis) reacts through rules.
 */
import { BAND_BY_KEY, bandAt, clampW, clarityAt, LAYER_COUNT, LAYER_W, layerAt } from "./bands";
import { CHIPS, DEFAULT_FOLDER, HAND_MAX, HAND_OFFER, PURIFY_MIN_CLARITY } from "./chips";
import { alive, applyEvent, panelAt, unitById, unitCell } from "./consequences";
import { nextRandom, hashString } from "./rng";
import { rulesFor, type RuleContext } from "./rules";
import {
  COLS,
  PLAYER_MAX_COL,
  ROWS,
  type EmittedEvent,
  type Panel,
  type SimAction,
  type SimConfig,
  type SimEvent,
  type SimState,
  type StampedAction,
  type Unit,
} from "./types";

export const MAX_DEPTH = 8;
export const MAX_EVENTS_PER_STEP = 512;
export const CUSTOM_TICKS = 200; // 10 s to fill the Custom gauge
export const MAX_PHASE_DW = 45;
export const BUSTER_COOLDOWN = 4;
export const POISON_INTERVAL = 10;
export const TELEGRAPH_TICKS = 16; // 0.8 s warning before a virus attack lands
export const MAX_TICKS = 20 * 60 * 10; // 10 minutes hard cap

export function phaseCost(dw: number): number {
  return Math.round(2 + Math.abs(dw) / 10);
}
export function phaseTicks(dw: number): number {
  return 6 + Math.round(Math.abs(dw) / 5);
}

function makePanels(): Panel[][][] {
  return Array.from({ length: LAYER_COUNT }, () =>
    Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ kind: "normal" as const, until: null }))),
  );
}

export function createSim(config: SimConfig): SimState {
  const startW = clampW(config.startW);
  const player: Unit = {
    id: "navi",
    side: "player",
    kind: config.companionId || "serenity",
    band: "serenity",
    col: 1,
    row: 1,
    w: startW,
    hp: config.playerHp ?? 200,
    maxHp: config.playerHp ?? 200,
    stunUntil: 0,
    phase: null,
    telegraph: null,
    nextActTick: 0,
  };
  const enemies: Unit[] = config.enemies.slice(0, 3).map((e, i) => ({
    id: `virus-${i}`,
    side: "enemy",
    kind: e.kind,
    band: e.band,
    col: Math.min(COLS - 1, Math.max(3, e.col ?? 4 + (i % 2))),
    row: Math.min(ROWS - 1, Math.max(0, e.row ?? i % ROWS)),
    w: clampW(e.w ?? LAYER_W[BAND_BY_KEY[e.band].index]),
    hp: e.hp ?? 120,
    maxHp: e.hp ?? 120,
    stunUntil: 0,
    phase: null,
    telegraph: null,
    nextActTick: 20 + i * 7,
  }));
  return {
    version: 1,
    config: { ...config, memoryPool: [...config.memoryPool] },
    tick: 0,
    rng: config.seed >>> 0 || 1,
    panels: makePanels(),
    units: [player, ...enemies],
    portals: [],
    memory: 60,
    custom: { gauge: 1, open: false, offer: [] },
    hand: [],
    folder: [...(config.folder?.length ? config.folder : DEFAULT_FOLDER)],
    corruptions: [],
    lastCorruptionTick: -1,
    outcome: null,
    seq: 0,
  };
}

/* ───────────────────────── event bus ───────────────────────── */

type Bus = { state: SimState; out: EmittedEvent[] };

function rand(s: SimState): number {
  const [v, next] = nextRandom(s.rng);
  s.rng = next;
  return v;
}

function emit(bus: Bus, root: SimEvent): void {
  const queue: Array<{ e: SimEvent; depth: number; cause: number | null }> = [{ e: root, depth: 0, cause: null }];
  const ctx: RuleContext = { state: bus.state, rand: () => rand(bus.state) };
  while (queue.length) {
    if (bus.out.length >= MAX_EVENTS_PER_STEP) break;
    const { e, depth, cause } = queue.shift()!;
    const s = bus.state;
    if (s.outcome && e.type !== "battle_end") continue; // battle over: stop propagating
    applyEvent(s, e);
    const seq = s.seq++;
    bus.out.push({ ...e, seq, tick: s.tick, depth, cause } as EmittedEvent);
    if (depth >= MAX_DEPTH) continue;
    for (const rule of rulesFor(e.type)) {
      for (const next of rule.derive(e as never, ctx)) queue.push({ e: next, depth: depth + 1, cause: seq });
    }
  }
}

/* ───────────────────────── per-tick systems ───────────────────────── */

const player = (s: SimState) => s.units[0];

function tickSystems(bus: Bus): void {
  const s = bus.state;
  // Custom gauge
  if (s.custom.gauge < 1) {
    s.custom.gauge = Math.min(1, s.custom.gauge + 1 / CUSTOM_TICKS);
    if (s.custom.gauge >= 1) emit(bus, { type: "custom_ready" });
  }
  // Terrain timers
  for (let l = 0; l < LAYER_COUNT; l++)
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const p = s.panels[l][r][c];
        if (p.until !== null && s.tick >= p.until) emit(bus, { type: "panel_changed", cell: { layer: l, col: c, row: r }, from: p.kind, to: "normal", until: null });
      }
  // Poison
  if (s.tick % POISON_INTERVAL === 0)
    for (const u of s.units)
      if (alive(u) && !u.phase && panelAt(s, unitCell(u))?.kind === "poison")
        emit(bus, { type: "hit", sourceId: "terrain", targetId: u.id, amount: 4, band: "noise", cell: unitCell(u) });
  // Portals
  for (const p of [...s.portals]) if (s.tick >= p.closesAt) emit(bus, { type: "portal_closed", portalId: p.id });
  // Phase shifts land
  for (const u of s.units)
    if (u.phase && s.tick >= u.phase.landTick && alive(u))
      emit(bus, { type: "phase_landed", unitId: u.id, w: u.phase.toW, layer: layerAt(u.phase.toW), ...(u.phase.portalId ? { portalId: u.phase.portalId } : {}) });
  // Telegraphed attacks resolve
  for (const u of s.units) {
    const t = u.telegraph;
    if (!t || s.tick < t.at) continue;
    u.telegraph = null;
    if (!alive(u)) continue;
    for (const cell of t.cells)
      for (const target of s.units)
        if (target.side !== u.side && alive(target) && !target.phase && layerAt(target.w) === cell.layer && target.col === cell.col && target.row === cell.row)
          emit(bus, { type: "hit", sourceId: u.id, targetId: target.id, amount: t.damage, band: t.band, cell });
  }
  // Enemy AI
  for (const u of s.units) if (u.side === "enemy" && alive(u) && s.tick >= u.nextActTick && !u.phase && !u.telegraph) enemyAct(bus, u);
}

function enemyAct(bus: Bus, u: Unit): void {
  const s = bus.state;
  const p = player(s);
  const r = rand(s);
  u.nextActTick = s.tick + 20 + Math.floor(rand(s) * 12);
  const pLayer = p.phase ? layerAt(p.phase.toW) : layerAt(p.w);
  const myLayer = layerAt(u.w);
  // Hunt across W: step one layer toward Serenity (telegraphed phase-shift).
  if (pLayer !== myLayer && r < 0.35) {
    const toLayer = myLayer + Math.sign(pLayer - myLayer);
    const toW = LAYER_W[toLayer];
    emit(bus, { type: "phase_started", unitId: u.id, shift: { fromW: u.w, toW, startTick: s.tick, landTick: s.tick + phaseTicks(toW - u.w) + 4, portalId: null } });
    return;
  }
  if (u.row !== p.row && r < 0.75) {
    const row = u.row + Math.sign(p.row - u.row);
    if (s.panels[myLayer][row][u.col].kind !== "broken") {
      emit(bus, { type: "unit_left_panel", unitId: u.id, cell: unitCell(u) });
      emit(bus, { type: "unit_entered_panel", unitId: u.id, cell: { layer: myLayer, col: u.col, row } });
      return;
    }
  }
  const dmg = 12 + Math.floor(rand(s) * 9);
  const cells = Array.from({ length: PLAYER_MAX_COL + 1 }, (_, c) => ({ layer: myLayer, col: c, row: u.row }));
  emit(bus, { type: "telegraph", unitId: u.id, telegraph: { at: s.tick + TELEGRAPH_TICKS, cells, damage: dmg, band: u.band } });
}

/* ───────────────────────── inputs ───────────────────────── */

function reject(bus: Bus, reason: string) {
  emit(bus, { type: "rejected", reason });
}

function resolveAction(bus: Bus, a: SimAction): void {
  const s = bus.state;
  const p = player(s);
  if (!alive(p)) return reject(bus, "navi is down");
  const busy = !!p.phase || s.tick < p.stunUntil;
  emit(bus, { type: "action", action: a, unitId: p.id });
  switch (a.t) {
    case "move": {
      if (busy || s.custom.open) return reject(bus, "busy");
      const col = p.col + Math.sign(a.dc | 0);
      const row = p.row + Math.sign(a.dr | 0);
      const layer = layerAt(p.w);
      if (col < 0 || col > PLAYER_MAX_COL || row < 0 || row >= ROWS) return reject(bus, "edge");
      if (s.panels[layer][row][col].kind === "broken") return reject(bus, "broken panel");
      emit(bus, { type: "unit_left_panel", unitId: p.id, cell: unitCell(p) });
      emit(bus, { type: "unit_entered_panel", unitId: p.id, cell: { layer, col, row } });
      return;
    }
    case "phase": {
      if (busy || s.custom.open) return reject(bus, "busy");
      const toW = clampW(a.toW);
      const dw = toW - p.w;
      if (Math.abs(dw) < 0.5) return reject(bus, "already there");
      const here = unitCell(p);
      const portal = s.portals.find(
        (o) =>
          (o.a.layer === here.layer && o.a.col === here.col && o.a.row === here.row && o.b.layer === layerAt(toW)) ||
          (o.b.layer === here.layer && o.b.col === here.col && o.b.row === here.row && o.a.layer === layerAt(toW)),
      );
      if (portal) {
        emit(bus, { type: "phase_started", unitId: p.id, shift: { fromW: p.w, toW, startTick: s.tick, landTick: s.tick + 1, portalId: portal.id } });
        return;
      }
      if (Math.abs(dw) > MAX_PHASE_DW) return reject(bus, `phase range is ±${MAX_PHASE_DW}`);
      const cost = phaseCost(dw);
      if (s.memory < cost) return reject(bus, "not enough memory");
      emit(bus, { type: "memory_drain", amount: cost, reason: "phase" });
      emit(bus, { type: "phase_started", unitId: p.id, shift: { fromW: p.w, toW, startTick: s.tick, landTick: s.tick + phaseTicks(dw), portalId: null } });
      return;
    }
    case "buster": {
      if (busy || s.custom.open || s.tick < p.nextActTick) return reject(bus, "cooldown");
      p.nextActTick = s.tick + BUSTER_COOLDOWN;
      const cell = unitCell(p);
      for (let c = cell.col + 1; c < COLS; c++) {
        const t = s.units.find((u) => u.side === "enemy" && alive(u) && !u.phase && layerAt(u.w) === cell.layer && u.col === c && u.row === cell.row);
        if (t) {
          emit(bus, { type: "hit", sourceId: p.id, targetId: t.id, amount: 2 + Math.floor(8 * clarityAt(p.w)), band: bandAt(p.w).key, cell: unitCell(t) });
          break;
        }
      }
      return;
    }
    case "chip": {
      if (busy || s.custom.open) return reject(bus, "busy");
      const chip = s.hand[0];
      if (!chip) return reject(bus, "no chip loaded");
      const spec = CHIPS[chip];
      if (chip === "purify" && clarityAt(p.w) < PURIFY_MIN_CLARITY) return reject(bus, "purify needs a clear signal (tune toward violet)");
      const offBand = bandAt(p.w).key !== spec.band;
      const cost = spec.cost * (offBand ? 2 : 1);
      if (s.memory < cost) return reject(bus, "not enough memory");
      s.hand = s.hand.slice(1);
      emit(bus, { type: "memory_drain", amount: cost, reason: offBand ? "off-band chip" : "chip" });
      emit(bus, { type: "chip_used", chip, unitId: p.id, band: spec.band, power: spec.power });
      return;
    }
    case "custom_open": {
      if (s.custom.gauge < 1 || s.custom.open) return reject(bus, "custom gauge not full");
      const deck = [...s.folder];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rand(s) * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      s.custom = { gauge: 1, open: true, offer: deck.slice(0, HAND_OFFER) };
      return;
    }
    case "custom_pick": {
      if (!s.custom.open) return reject(bus, "custom not open");
      const picks = [...new Set(a.picks.map((n) => n | 0))].filter((n) => n >= 0 && n < s.custom.offer.length).slice(0, HAND_MAX);
      s.hand = picks.map((i) => s.custom.offer[i]);
      s.custom = { gauge: 0, open: false, offer: [] };
      return;
    }
    case "purify": {
      if (busy || s.custom.open) return reject(bus, "busy");
      // A purify chip in hand is required; otherwise it's a free action exploit.
      const idx = s.hand.indexOf("purify");
      if (idx < 0) return reject(bus, "no Purify chip loaded");
      if (clarityAt(p.w) < PURIFY_MIN_CLARITY) return reject(bus, "purify needs a clear signal (tune toward violet)");
      s.hand = [...s.hand.slice(0, idx), ...s.hand.slice(idx + 1)];
      emit(bus, { type: "memory_drain", amount: CHIPS.purify.cost, reason: "chip" });
      emit(bus, { type: "chip_used", chip: "purify", unitId: p.id, band: "serenity", power: 0 });
      return;
    }
  }
}

/* ───────────────────────── public API ───────────────────────── */

export type StepResult = { state: SimState; events: EmittedEvent[] };

/** Advance simulated time to `toTick`. Time is frozen while the Custom screen is open (as in BN). */
export function advance(state: SimState, toTick: number): StepResult {
  const s = JSON.parse(JSON.stringify(state)) as SimState;
  const bus: Bus = { state: s, out: [] };
  const target = Math.min(MAX_TICKS, Math.floor(toTick));
  while (s.tick < target && !s.outcome && !s.custom.open) {
    s.tick++;
    tickSystems(bus);
  }
  if (s.custom.open && s.tick < target) s.tick = target; // paused: clock moves, world doesn't
  return { state: s, events: bus.out };
}

export function step(state: SimState, input: StampedAction): StepResult {
  if (input.tick < state.tick) {
    return { state, events: [{ type: "rejected", reason: "stale tick", seq: state.seq, tick: state.tick, depth: 0, cause: null }] };
  }
  const adv = advance(state, input.tick);
  if (adv.state.outcome) return adv;
  const bus: Bus = { state: adv.state, out: adv.events };
  resolveAction(bus, input.action);
  return { state: bus.state, events: bus.out };
}

/** Rebuild a battle from its config and full input log (server validation, resume). */
export function replay(config: SimConfig, actions: StampedAction[], untilTick?: number): StepResult {
  let state = createSim(config);
  const events: EmittedEvent[] = [];
  for (const a of actions) {
    const r = step(state, a);
    state = r.state;
    events.push(...r.events);
  }
  if (untilTick !== undefined && untilTick > state.tick) {
    const r = advance(state, untilTick);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

/** Canonical hash of the gameplay-relevant state (client/server agreement). */
export function stateHash(s: SimState): string {
  const canon = {
    t: s.tick,
    r: s.rng,
    m: s.memory,
    o: s.outcome,
    u: s.units.map((u) => [u.id, u.col, u.row, Math.round(u.w * 10), u.hp, u.phase ? u.phase.landTick : -1]),
    p: s.panels.map((l) => l.map((r) => r.map((p) => p.kind[0]).join("")).join("|")).join("/"),
    q: s.portals.map((p) => p.id),
    c: s.corruptions.map((c) => [c.targetEventId, c.restored ? 1 : 0]),
    h: s.hand,
  };
  return hashString(JSON.stringify(canon));
}

/* ───────────────────────── read models for UI ───────────────────────── */

export type SignalReadout = {
  w: number;
  band: ReturnType<typeof bandAt>;
  clarity: number;
  /** multiplier applied to chip damage */
  chipPower: number;
  /** 0–1 static overlay for visuals/voice */
  noise: number;
};

export function signalReadout(s: SimState): SignalReadout {
  const p = player(s);
  const w = p.phase ? p.phase.fromW + (p.phase.toW - p.phase.fromW) * Math.min(1, (s.tick - p.phase.startTick) / Math.max(1, p.phase.landTick - p.phase.startTick)) : p.w;
  const clarity = clarityAt(w);
  return { w, band: bandAt(w), clarity, chipPower: 0.5 + 0.5 * clarity, noise: 1 - clarity };
}

export { unitById };
