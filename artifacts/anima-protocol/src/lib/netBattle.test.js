import { describe, expect, it } from "vitest";
import {
  COLS,
  CUSTOM_FULL,
  ROWS,
  createBattle,
  fireBuster,
  fireLoadedChip,
  moveUnit,
  openCustom,
  sendWeaponsData,
  setControlMode,
  tickBattle,
  toggleCustomSelect,
  activateChip,
} from "./netBattle";

const anima = {
  name: "Serenity",
  expression_spectrum: {
    angelic: 70,
    ascended: 20,
    neutral: 10,
    descended: 0,
    demonic: 0,
  },
};

function fightUntil(state, pred, max = 800) {
  let next = state;
  for (let i = 0; i < max; i += 1) {
    if (pred(next)) return next;
    next = tickBattle(next);
  }
  return next;
}

describe("createBattle", () => {
  it("opens a 6x3 field with the Anima on the player side", () => {
    const battle = createBattle({ anima, seed: 7, controlMode: "manual" });
    expect(COLS).toBe(6);
    expect(ROWS).toBe(3);
    expect(battle.player.col).toBeLessThanOrEqual(2);
    expect(battle.enemy.col).toBeGreaterThanOrEqual(3);
    expect(battle.player.hp).toBeGreaterThan(0);
    expect(battle.hand.length).toBeGreaterThan(0);
    expect(battle.buster.kind).toBe("blast");
    expect(battle.controlMode).toBe("manual");
    expect(battle.player.silhouette).toBe("serenity");
    expect(battle.enemy.silhouette).toBeTruthy();
  });
});

describe("movement and weapons", () => {
  it("moves the Anima only inside the player panels", () => {
    let battle = createBattle({ anima, seed: 3 });
    battle = { ...battle, player: { ...battle.player, col: 1, row: 1 } };
    battle = moveUnit(battle, "player", 1, 0);
    expect(battle.player.col).toBe(2);
    battle = moveUnit(battle, "player", 1, 0);
    expect(battle.player.col).toBe(2);
    battle = moveUnit(battle, "player", 0, -1);
    expect(battle.player.row).toBe(0);
  });

  it("fires a hand energy blast as a projectile along the row", () => {
    let battle = createBattle({ anima, seed: 11 });
    battle = {
      ...battle,
      player: { ...battle.player, col: 1, row: 1, cooldown: 0, flinch: 0 },
    };
    battle = fireBuster(battle, "player");
    expect(battle.projectiles.length).toBe(1);
    expect(battle.projectiles[0].row).toBe(1);
    expect(battle.projectiles[0].dir).toBe(1);
    expect(battle.player.cooldown).toBeGreaterThan(0);
  });

  it("resolves a sword chip against an adjacent enemy", () => {
    let battle = createBattle({ anima, seed: 4 });
    battle = {
      ...battle,
      player: { ...battle.player, col: 2, row: 1, cooldown: 0, flinch: 0 },
      enemy: { ...battle.enemy, col: 3, row: 1, hp: 80, maxHp: 80, flinch: 0 },
    };
    const sword = {
      name: "Seraph Blade",
      code: "SRB",
      kind: "sword",
      damage: 80,
      reach: 1,
      wide: false,
      color: "#fde68a",
    };
    battle = activateChip(battle, sword);
    expect(battle.slashes.length).toBeGreaterThan(0);
    battle = tickBattle(battle);
    expect(battle.enemy.hp).toBeLessThan(80);
    expect(battle.log.some((l) => /Sent Seraph Blade/.test(l))).toBe(true);
  });
});

describe("sending weapons data", () => {
  it("transmits selected chips from Custom into the loaded queue", () => {
    let battle = createBattle({ anima, seed: 21 });
    battle = { ...battle, customGauge: CUSTOM_FULL, phase: "fighting" };
    battle = openCustom(battle);
    expect(battle.phase).toBe("custom");
    battle = toggleCustomSelect(battle, 0);
    battle = sendWeaponsData(battle);
    expect(battle.phase).toBe("fighting");
    expect(battle.customGauge).toBe(0);
    expect(battle.loaded.length).toBe(1);
    expect(battle.log.some((l) => /Weapons data sent/.test(l))).toBe(true);
  });

  it("fires a loaded chip after send", () => {
    let battle = createBattle({ anima, seed: 22 });
    const chip = {
      name: "Halo Burst",
      code: "HLB",
      kind: "blast",
      damage: 40,
      color: "#fde68a",
    };
    battle = {
      ...battle,
      loaded: [chip],
      player: { ...battle.player, cooldown: 0, flinch: 0 },
    };
    battle = fireLoadedChip(battle);
    expect(battle.loaded.length).toBe(0);
    expect(battle.projectiles.length).toBe(1);
    expect(battle.chipsUsed).toBe(1);
  });
});

describe("auto-pilot", () => {
  it("lets the Anima fight without operator input", () => {
    let battle = createBattle({ anima, seed: 99, controlMode: "auto" });
    battle = setControlMode(battle, "auto");
    battle = fightUntil(battle, (s) => s.phase !== "fighting" || s.tick > 400);
    expect(battle.tick).toBeGreaterThan(10);
    expect(battle.enemy.hp).toBeLessThan(battle.enemy.maxHp);
  });
});
