/**
 * "Auto" mode (Tab): a deterministic pilot that reads sim state at a tick
 * boundary and queues the same SimActions a player would. Its inputs go
 * through the queue and the stamped log like any other input, so an auto
 * battle replays on the server exactly like a manual one.
 */
import {
  bandDistance,
  bandAt,
  CHIPS,
  clarityAt,
  LAYER_W,
  layerAt,
  PURIFY_MIN_CLARITY,
  phaseCost,
  type SimAction,
  type SimState,
} from "@workspace/sim-core";
import { standable } from "./gridNav";
import { dialToPhaseTarget } from "./frequency";

export function autopilot(s: SimState): SimAction[] {
  if (s.outcome) return [];
  if (s.custom.open) return [{ t: "custom_pick", picks: [0, 1, 2, 3, 4] }];
  const navi = s.units[0];
  if (!navi || navi.hp <= 0 || navi.phase || s.tick < navi.stunUntil) return [];
  if (s.custom.gauge >= 1 && s.hand.length === 0) return [{ t: "custom_open" }];

  const layer = layerAt(navi.w);
  const foes = s.units.filter((u) => u.side === "enemy" && u.hp > 0);
  if (!foes.length) return [];

  // Dodge: a telegraphed strike is about to land on our panel.
  const threatened = foes.some((u) => u.telegraph && u.telegraph.at - s.tick <= 6 && u.telegraph.cells.some((c) => c.layer === layer && c.col === navi.col && c.row === navi.row));
  if (threatened) {
    for (const dr of [1, -1]) if (standable(s, layer, navi.col, navi.row + dr)) return [{ t: "move", dc: 0, dr }];
    for (const dc of [1, -1]) if (standable(s, layer, navi.col + dc, navi.row)) return [{ t: "move", dc, dr: 0 }];
  }

  // Purify an open corruption when the signal is clear enough.
  if (s.hand.includes("purify") && s.corruptions.some((c) => !c.restored) && clarityAt(navi.w) >= PURIFY_MIN_CLARITY && s.memory >= CHIPS.purify.cost)
    return [{ t: "purify" }];

  const here = foes.filter((u) => !u.phase && layerAt(u.w) === layer);
  if (!here.length) {
    // Hunt along W: shift toward the nearest virus's layer (prefer matching its band).
    const target = foes.slice().sort((a, b) => Math.abs(layerAt(a.w) - layer) - Math.abs(layerAt(b.w) - layer))[0];
    const toW = dialToPhaseTarget(LAYER_W[layerAt(target.w)], navi.w);
    if (toW !== null && s.memory >= phaseCost(toW - navi.w)) return [{ t: "phase", toW }];
    return [];
  }

  const inRow = here.find((u) => u.row === navi.row);
  if (!inRow) {
    const dr = Math.sign(here[0].row - navi.row);
    if (standable(s, layer, navi.col, navi.row + dr)) return [{ t: "move", dc: 0, dr }];
  }
  const chip = s.hand[0];
  if (inRow && chip && chip !== "purify") {
    const off = bandAt(navi.w).key !== CHIPS[chip].band;
    const cost = CHIPS[chip].cost * (off ? 2 : 1);
    // Keep a reserve so a phase-shift stays affordable; avoid dissonant targets.
    if (s.memory - cost >= 8 && bandDistance(bandAt(navi.w).key, inRow.band) < 2) return [{ t: "chip" }];
  }
  return inRow ? [{ t: "buster" }] : [];
}
