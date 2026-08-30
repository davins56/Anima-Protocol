// Mega Man Battle Network-style net battle engine.
//
// Pure state machine (no DOM). The arena is a 6×3 panel grid: player owns
// columns 0–2, enemy owns 3–5. Combat is tick-based. The operator can move
// their Anima manually or let it auto-pilot. Weapons are battle chips
// (swords, area) plus expression-typed energy blasts fired from the hand.
//
// "Sending" chips is the Custom OK — weapons data is transmitted to the Anima.

import {
  busterForSpectrum,
  folderFromSpectrum,
  mixedCombatStats,
  supportChipsFromSpectrum,
  dominantExpression,
  getExpressionMeta,
} from "./animaExpressions";
import { chipsFromEchoFolder, echoResonanceChip } from "./echoKeys";

export const COLS = 6;
export const ROWS = 3;
export const PLAYER_MAX_COL = 2;
export const ENEMY_MIN_COL = 3;
export const CUSTOM_FULL = 100;
export const HAND_SIZE = 5;
export const BASE_HP = 200;
export const TICK_MS = 50;

let nextFxId = 1;
function fxId() {
  return `fx-${nextFxId++}`;
}

export function createRng(seed = 1) {
  let s = (Number(seed) || 1) >>> 0;
  if (s === 0) s = 1;
  return function rng() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function inBounds(col, row) {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

function onPlayerField(col) {
  return col >= 0 && col <= PLAYER_MAX_COL;
}

function onEnemyField(col) {
  return col >= ENEMY_MIN_COL && col < COLS;
}

function unitHp(statsHp) {
  return Math.round(BASE_HP * statsHp);
}

function shuffleCopy(list, rng) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function drawHand(folder, rng, count = HAND_SIZE) {
  if (folder.length === 0) return { hand: [], folder: [] };
  const shuffled = shuffleCopy(folder, rng);
  return {
    hand: shuffled.slice(0, count),
    folder: shuffled.slice(count),
  };
}

const VIRUS_SILHOUETTES = {
  "Shade.Vrs": "shade",
  "Static.Vrs": "static",
  "Mettaur.Vrs": "mettaur",
  "Halo.Vrs": "halo",
  "Aegis.Vrs": "aegis",
};

const VIRUS_COLORS = {
  "Shade.Vrs": "#fb7185",
  "Static.Vrs": "#c4b5fd",
  "Mettaur.Vrs": "#f87171",
  "Halo.Vrs": "#fde68a",
  "Aegis.Vrs": "#a5f3fc",
};

function virusUnit(name, rng, overrides = {}) {
  const resolved = VIRUS_SILHOUETTES[name] ? name : "Halo.Vrs";
  const hpJitter = 0.9 + rng() * 0.25;
  return {
    name: resolved,
    color: overrides.color || VIRUS_COLORS[resolved],
    col: 4,
    row: 1,
    hp: Math.round(BASE_HP * hpJitter),
    maxHp: Math.round(BASE_HP * hpJitter),
    cooldown: 0,
    flinch: 0,
    kind: "virus",
    silhouette: overrides.silhouette || VIRUS_SILHOUETTES[resolved] || "halo",
  };
}

function enemyForSpectrum(spectrum, rng) {
  const dominant = dominantExpression(spectrum);
  const viruses = {
    angelic: "Shade.Vrs",
    ascended: "Static.Vrs",
    neutral: "Mettaur.Vrs",
    descended: "Halo.Vrs",
    demonic: "Aegis.Vrs",
  };
  return virusUnit(viruses[dominant.id] || viruses.neutral, rng);
}

/**
 * Map a live jack-in scene entity onto an existing .Vrs figure.
 * Never maps the companion Fallen Angel.
 */
export function enemyFromSceneEntity(entity, rng = createRng(1)) {
  const name = String(entity?.name || "").trim();
  if (!name || /fallen angel|serenity/i.test(name)) {
    return virusUnit("Halo.Vrs", rng, entity || {});
  }
  return virusUnit(VIRUS_SILHOUETTES[name] ? name : "Halo.Vrs", rng, entity || {});
}

function folderForBattle(opts, spectrum) {
  const raw = opts.echoFolder;
  if (Array.isArray(raw) && raw.length) {
    if (raw[0]?.kind) return raw;
    return chipsFromEchoFolder(raw);
  }
  return [
    ...folderFromSpectrum(spectrum),
    ...supportChipsFromSpectrum(spectrum),
  ];
}

/**
 * @param {object} opts
 * @param {object} [opts.anima]
 * @param {'manual'|'auto'} [opts.controlMode]
 * @param {number} [opts.seed]
 * @param {{ id: string, code?: string, kind?: string }[]} [opts.echoFolder] Echo Key chips or raw {id,code} slots. Falls back to expression chips.
 */
export function createBattle(opts = {}) {
  const anima = opts.anima || {};
  const spectrum = anima.expression_spectrum;
  const stats = mixedCombatStats(spectrum);
  const rng = createRng(opts.seed ?? Date.now() % 1_000_000);
  const folder = folderForBattle(opts, spectrum);
  const drawn = drawHand(folder, rng);
  const hp = unitHp(stats.hp);
  const buster = busterForSpectrum(spectrum);

  return {
    phase: "fighting",
    tick: 0,
    controlMode: opts.controlMode === "auto" ? "auto" : "manual",
    rng,
    stats,
    buster,
    player: {
      name: anima.name || "Anima",
      avatar_url: anima.avatar_url || "",
      col: 1,
      row: 1,
      hp,
      maxHp: hp,
      cooldown: 0,
      flinch: 0,
      spectrum,
      silhouette: "serenity",
    },
    enemy: opts.enemy
      ? enemyFromSceneEntity(opts.enemy, rng)
      : enemyForSpectrum(spectrum, rng),
    fired_sequence: null,
    customGauge: 0,
    folder: drawn.folder,
    hand: drawn.hand,
    loaded: [],
    selectedCustom: [],
    projectiles: [],
    slashes: [],
    log: [`${anima.name || "Anima"} jacked in.`],
    chipsUsed: 0,
    winner: null,
  };
}

function pushLog(state, line) {
  const log = state.log.concat(line).slice(-8);
  return { ...state, log };
}

function setHp(unit, amount) {
  const hp = clamp(Math.round(amount), 0, unit.maxHp);
  return { ...unit, hp };
}

function damageUnit(unit, amount, defenseMul = 1) {
  const dealt = Math.max(1, Math.round(amount / Math.max(0.5, defenseMul)));
  const next = setHp(unit, unit.hp - dealt);
  return { unit: { ...next, flinch: Math.max(next.flinch, 3) }, dealt };
}

export function canMoveTo(state, who, col, row) {
  if (!inBounds(col, row)) return false;
  if (who === "player") return onPlayerField(col);
  return onEnemyField(col);
}

export function moveUnit(state, who, dCol, dRow) {
  if (state.phase !== "fighting") return state;
  const unit = state[who];
  if (!unit || unit.flinch > 0) return state;
  const col = unit.col + dCol;
  const row = unit.row + dRow;
  if (!canMoveTo(state, who, col, row)) return state;
  return { ...state, [who]: { ...unit, col, row } };
}

function spawnProjectile(state, owner, weapon) {
  const unit = state[owner];
  const dir = owner === "player" ? 1 : -1;
  const proj = {
    id: fxId(),
    owner,
    col: unit.col + dir,
    row: unit.row,
    dir,
    damage: Math.round(weapon.damage * (owner === "player" ? state.stats.attack : 1)),
    color: weapon.color || "#67e8f9",
    kind: "blast",
    name: weapon.name,
  };
  if (!inBounds(proj.col, proj.row)) return state;
  return {
    ...state,
    projectiles: state.projectiles.concat(proj),
  };
}

function spawnSlash(state, owner, weapon) {
  const unit = state[owner];
  const dir = owner === "player" ? 1 : -1;
  const reach = weapon.reach || 1;
  const rows = weapon.wide ? [0, 1, 2] : [unit.row];
  const slashes = [];
  for (let r = 0; r < reach; r += 1) {
    for (const row of rows) {
      const col = unit.col + dir * (r + 1);
      if (!inBounds(col, row)) continue;
      slashes.push({
        id: fxId(),
        owner,
        col,
        row,
        damage: Math.round(weapon.damage * (owner === "player" ? state.stats.attack : 1)),
        color: weapon.color || "#e2e8f0",
        ttl: 4,
        name: weapon.name,
      });
    }
  }
  return { ...state, slashes: state.slashes.concat(slashes) };
}

function spawnArea(state, owner, weapon) {
  const target = owner === "player" ? state.enemy : state.player;
  const slashes = [];
  for (let col = (owner === "player" ? ENEMY_MIN_COL : 0);
    col <= (owner === "player" ? COLS - 1 : PLAYER_MAX_COL);
    col += 1) {
    slashes.push({
      id: fxId(),
      owner,
      col,
      row: target.row,
      damage: Math.round(weapon.damage * (owner === "player" ? state.stats.attack : 1)),
      color: weapon.color || "#fb7185",
      ttl: 5,
      name: weapon.name,
    });
  }
  return { ...state, slashes: state.slashes.concat(slashes) };
}

export function fireBuster(state, owner = "player") {
  if (state.phase !== "fighting") return state;
  const unit = state[owner];
  if (!unit || unit.cooldown > 0 || unit.flinch > 0) return state;
  const weapon =
    owner === "player"
      ? state.buster
      : {
          name: "Virus Shot",
          damage: 12,
          color: state.enemy.color,
        };
  const next = spawnProjectile(state, owner, weapon);
  return {
    ...next,
    [owner]: { ...next[owner], cooldown: owner === "player" ? 4 : 6 },
  };
}

export function activateChip(state, chip) {
  if (state.phase !== "fighting" || !chip) return state;
  if (state.player.cooldown > 0 || state.player.flinch > 0) return state;

  let next = state;
  if (chip.kind === "blast") {
    next = spawnProjectile(next, "player", chip);
  } else if (chip.kind === "sword") {
    next = spawnSlash(next, "player", chip);
  } else if (chip.kind === "area") {
    next = spawnArea(next, "player", chip);
  } else if (chip.kind === "heal") {
    const healed = setHp(next.player, next.player.hp + (chip.heal || 30));
    next = { ...next, player: healed };
  }

  next = pushLog(next, `Sent ${chip.name} [${chip.code || chip.letter || ""}]`);
  return {
    ...next,
    player: { ...next.player, cooldown: 5 },
    chipsUsed: next.chipsUsed + 1,
  };
}

export function fireLoadedChip(state) {
  if (state.loaded.length === 0) return state;
  const [chip, ...rest] = state.loaded;
  return { ...activateChip(state, chip), loaded: rest };
}

/** Open the Custom screen when the gauge is full — pause to pick chips. */
export function openCustom(state) {
  if (state.phase !== "fighting") return state;
  if (state.customGauge < CUSTOM_FULL) return state;
  return { ...state, phase: "custom", selectedCustom: [] };
}

export function toggleCustomSelect(state, chipIndex) {
  if (state.phase !== "custom") return state;
  const chip = state.hand[chipIndex];
  if (!chip) return state;
  const selected = state.selectedCustom.slice();
  const at = selected.indexOf(chipIndex);
  if (at >= 0) selected.splice(at, 1);
  else if (selected.length < HAND_SIZE) selected.push(chipIndex);
  return { ...state, selectedCustom: selected };
}

/**
 * Transmit selected battle-chip data to the Anima (MMBN Custom OK).
 * Unsent chips return to the folder.
 */
export function sendWeaponsData(state) {
  if (state.phase !== "custom") return state;
  const chosen = state.selectedCustom
    .map((i) => state.hand[i])
    .filter(Boolean);
  const leftover = state.hand.filter((_, i) => !state.selectedCustom.includes(i));
  const folder = state.folder.concat(leftover);
  const drawn = drawHand(folder, state.rng, HAND_SIZE);
  const fused = echoResonanceChip(chosen.map((c) => c.id));
  const payload = fused ? [fused] : chosen;
  const names = payload.map((c) => c.name).join(", ") || "empty slot";
  let next = {
    ...state,
    phase: "fighting",
    customGauge: 0,
    loaded: state.loaded.concat(payload),
    hand: drawn.hand,
    folder: drawn.folder,
    selectedCustom: [],
    fired_sequence: fused
      ? { id: fused.id, name: fused.name }
      : state.fired_sequence || null,
  };
  next = pushLog(next, fused
    ? `Sequence half-awake: ${fused.name}`
    : `Weapons data sent: ${names}`);
  return next;
}

export function setControlMode(state, mode) {
  const controlMode = mode === "auto" ? "auto" : "manual";
  return { ...state, controlMode };
}

function resolveHits(state) {
  let player = state.player;
  let enemy = state.enemy;
  const projectiles = [];
  const slashes = [];
  let logLine = null;

  for (const p of state.projectiles) {
    const target = p.owner === "player" ? enemy : player;
    if (p.col === target.col && p.row === target.row) {
      if (p.owner === "player") {
        const hit = damageUnit(enemy, p.damage, 1);
        enemy = hit.unit;
        logLine = `${p.name} hit ${enemy.name} for ${hit.dealt}`;
      } else {
        const hit = damageUnit(player, p.damage, state.stats.defense);
        player = hit.unit;
        logLine = `${p.name} hit ${player.name} for ${hit.dealt}`;
      }
      continue;
    }
    projectiles.push(p);
  }

  for (const s of state.slashes) {
    const target = s.owner === "player" ? enemy : player;
    if (s.col === target.col && s.row === target.row) {
      if (s.owner === "player") {
        const hit = damageUnit(enemy, s.damage, 1);
        enemy = hit.unit;
        logLine = `${s.name} struck ${enemy.name} for ${hit.dealt}`;
      } else {
        const hit = damageUnit(player, s.damage, state.stats.defense);
        player = hit.unit;
        logLine = `${s.name} struck ${player.name} for ${hit.dealt}`;
      }
    }
    if (s.ttl > 1) slashes.push({ ...s, ttl: s.ttl - 1 });
  }

  let next = { ...state, player, enemy, projectiles, slashes };
  if (logLine) next = pushLog(next, logLine);
  return next;
}

function advanceProjectiles(state) {
  const projectiles = [];
  for (const p of state.projectiles) {
    const col = p.col + p.dir;
    if (!inBounds(col, p.row)) continue;
    projectiles.push({ ...p, col });
  }
  return { ...state, projectiles };
}

function tickCooldowns(unit) {
  return {
    ...unit,
    cooldown: Math.max(0, unit.cooldown - 1),
    flinch: Math.max(0, unit.flinch - 1),
  };
}

function enemyAct(state) {
  if (state.enemy.cooldown > 0 || state.enemy.flinch > 0 || state.enemy.hp <= 0) {
    return state;
  }
  const rng = state.rng;
  const roll = rng();
  let next = state;

  if (roll < 0.35) {
    const dRow = state.player.row === state.enemy.row ? (rng() < 0.5 ? -1 : 1) : Math.sign(state.player.row - state.enemy.row);
    next = moveUnit(next, "enemy", 0, dRow);
  } else if (roll < 0.55) {
    const dCol = rng() < 0.5 ? -1 : 1;
    next = moveUnit(next, "enemy", dCol, 0);
  }

  if (next.enemy.row === next.player.row && rng() < 0.7) {
    next = fireBuster(next, "enemy");
  } else if (rng() < 0.2) {
    const meta = getExpressionMeta("demonic");
    next = spawnSlash(next, "enemy", {
      ...meta.sword,
      name: "Virus Fang",
      damage: 28,
      color: next.enemy.color,
      reach: 1,
      wide: false,
    });
    next = { ...next, enemy: { ...next.enemy, cooldown: 8 } };
  }

  return next;
}

function autoAct(state) {
  if (state.controlMode !== "auto") return state;
  if (state.player.cooldown > 0 || state.player.flinch > 0 || state.player.hp <= 0) {
    return state;
  }

  let next = state;
  const incoming = next.projectiles.find(
    (p) => p.owner === "enemy" && p.row === next.player.row && p.col - next.player.col <= 2,
  );
  if (incoming) {
    const dodge = next.player.row === 0 ? 1 : next.player.row === 2 ? -1 : next.rng() < 0.5 ? -1 : 1;
    next = moveUnit(next, "player", 0, dodge);
  } else if (next.player.row !== next.enemy.row) {
    next = moveUnit(next, "player", 0, Math.sign(next.enemy.row - next.player.row));
  }

  if (next.loaded.length > 0) {
    return fireLoadedChip(next);
  }

  const sameRow = next.player.row === next.enemy.row;
  const adjacent = sameRow && next.enemy.col - next.player.col <= 2;
  if (adjacent && next.hand.some((c) => c.kind === "sword")) {
    // Auto will send a sword on the next custom; buster meanwhile.
  }
  if (sameRow) return fireBuster(next, "player");
  return next;
}

function autoSendIfReady(state) {
  if (state.controlMode !== "auto") return state;
  if (state.customGauge < CUSTOM_FULL) return state;
  let next = openCustom(state);
  const preferred = [];
  next.hand.forEach((chip, i) => {
    if (chip.kind === "heal" && next.player.hp < next.player.maxHp * 0.55) preferred.push(i);
    else if (chip.kind === "sword" || chip.kind === "blast" || chip.kind === "area") preferred.push(i);
  });
  next = { ...next, selectedCustom: preferred.slice(0, 3) };
  return sendWeaponsData(next);
}

function checkEnd(state) {
  if (state.player.hp <= 0) {
    return { ...pushLog(state, "DELETED."), phase: "defeat", winner: "enemy" };
  }
  if (state.enemy.hp <= 0) {
    return { ...pushLog(state, "Enemy deleted. You win."), phase: "victory", winner: "player" };
  }
  return state;
}

export function tickBattle(state) {
  if (state.phase === "custom") return state;
  if (state.phase !== "fighting") return state;

  let next = {
    ...state,
    tick: state.tick + 1,
    customGauge: Math.min(CUSTOM_FULL, state.customGauge + 1.6 * state.stats.speed),
    player: tickCooldowns(state.player),
    enemy: tickCooldowns(state.enemy),
  };

  next = resolveHits(next);
  next = checkEnd(next);
  if (next.phase !== "fighting") return next;

  next = advanceProjectiles(next);
  next = resolveHits(next);
  next = checkEnd(next);
  if (next.phase !== "fighting") return next;

  next = enemyAct(next);
  next = autoSendIfReady(next);
  if (next.phase === "custom") return next;
  next = autoAct(next);
  return checkEnd(next);
}

export function battleSummary(state) {
  return {
    result: state.phase === "victory" ? "win" : state.phase === "defeat" ? "loss" : "ongoing",
    control_mode: state.controlMode,
    chips_used: state.chipsUsed,
    echo_keys_used: state.chipsUsed,
    player_hp: state.player.hp,
    enemy_hp: state.enemy.hp,
    ticks: state.tick,
  };
}
