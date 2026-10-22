/** Keyboard → game intent. Pure so it can be unit-tested and reused by the gamepad layer. */
import type { SimAction } from "@workspace/sim-core";

export type Intent =
  | { kind: "action"; action: SimAction }
  | { kind: "phaseStep"; dir: 1 | -1 }
  | { kind: "toggleAuto" }
  | { kind: "pick"; index: number }
  | { kind: "confirmCustom" };

const MOVES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
};

export function intentForKey(code: string, customOpen: boolean): Intent | null {
  if (customOpen) {
    const digit = /^(?:Digit|Numpad)([1-5])$/.exec(code);
    if (digit) return { kind: "pick", index: Number(digit[1]) - 1 };
    if (code === "Enter" || code === "KeyC" || code === "NumpadEnter") return { kind: "confirmCustom" };
    if (code === "Tab") return { kind: "toggleAuto" };
    return null;
  }
  const mv = MOVES[code];
  if (mv) return { kind: "action", action: { t: "move", dc: mv[0], dr: mv[1] } };
  switch (code) {
    case "KeyZ":
    case "Space":
      return { kind: "action", action: { t: "buster" } };
    case "KeyX":
      return { kind: "action", action: { t: "chip" } };
    case "KeyC":
      return { kind: "action", action: { t: "custom_open" } };
    case "KeyP":
      return { kind: "action", action: { t: "purify" } };
    case "KeyQ":
    case "BracketLeft":
      return { kind: "phaseStep", dir: -1 };
    case "KeyE":
    case "BracketRight":
      return { kind: "phaseStep", dir: 1 };
    case "Tab":
      return { kind: "toggleAuto" };
    default:
      return null;
  }
}

/** Standard-mapping gamepad buttons → key codes (edge-triggered by the caller). */
export const GAMEPAD_BUTTON_CODES: Record<number, string> = {
  0: "KeyZ", // A: buster
  1: "KeyX", // B: chip
  2: "KeyC", // X: custom / confirm
  3: "KeyP", // Y: purify
  4: "KeyQ", // LB: phase down
  5: "KeyE", // RB: phase up
  8: "Tab", // back/select: auto
  12: "ArrowUp",
  13: "ArrowDown",
  14: "ArrowLeft",
  15: "ArrowRight",
};
