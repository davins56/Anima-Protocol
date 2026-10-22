/**
 * Input layer: keyboard, gamepad (standard mapping, edge-triggered) and the
 * page-visibility pause. Everything becomes a SimAction pushed into the
 * loop's queue; the loop stamps it on the next tick boundary.
 */
import { useEffect, useRef } from "react";
import type { SimAction } from "@workspace/sim-core";
import { GAMEPAD_BUTTON_CODES, intentForKey, type Intent } from "@/lib/simClient/keymap";
import { phaseStepTarget } from "@/lib/simClient/frequency";
import type { FixedStepLoop } from "@/lib/simClient/fixedStepLoop";

export type InputHandlers = {
  toggleAuto: () => void;
  togglePick: (index: number) => void;
  confirmCustom: () => void;
};

export function applyIntent(loop: FixedStepLoop, intent: Intent, h: InputHandlers): void {
  switch (intent.kind) {
    case "action":
      loop.enqueue(intent.action);
      return;
    case "phaseStep": {
      const navi = loop.curr.units[0];
      const toW = phaseStepTarget(navi.phase ? navi.phase.toW : navi.w, intent.dir);
      if (toW !== null) loop.enqueue({ t: "phase", toW } satisfies SimAction);
      return;
    }
    case "toggleAuto":
      h.toggleAuto();
      return;
    case "pick":
      h.togglePick(intent.index);
      return;
    case "confirmCustom":
      h.confirmCustom();
      return;
  }
}

const GAME_KEYS = new Set(["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  return t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range" && (t as HTMLInputElement).type !== "button";
}

export function useSimInput(loop: FixedStepLoop, handlers: InputHandlers, opts: { userPaused: boolean }) {
  const h = useRef(handlers);
  useEffect(() => {
    h.current = handlers;
  });

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      // Arrow keys on the focused dial tune it; don't also move.
      if ((e.target as HTMLInputElement)?.type === "range" && e.code.startsWith("Arrow")) return;
      const intent = intentForKey(e.code, loop.curr.custom.open);
      if (!intent) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      applyIntent(loop, intent, h.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loop]);

  // Gamepad (polled; cheap no-op when none connected)
  useEffect(() => {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
    const prev = new Map<string, boolean>();
    let raf = 0;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(pads).find(Boolean);
      if (!pad) return;
      const pressed = new Map<string, boolean>();
      pad.buttons.forEach((b, i) => {
        const code = GAMEPAD_BUTTON_CODES[i];
        if (code) pressed.set(code, (pressed.get(code) ?? false) || b.pressed);
      });
      const [ax = 0, ay = 0] = pad.axes;
      if (ax < -0.6) pressed.set("ArrowLeft", true);
      if (ax > 0.6) pressed.set("ArrowRight", true);
      if (ay < -0.6) pressed.set("ArrowUp", true);
      if (ay > 0.6) pressed.set("ArrowDown", true);
      for (const [code, down] of pressed) {
        if (down && !prev.get(code)) {
          const intent = intentForKey(code, loop.curr.custom.open);
          if (intent) applyIntent(loop, intent, h.current);
        }
        prev.set(code, down);
      }
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [loop]);

  // Pause on hidden tab (and when the user pauses); never catch up on resume.
  useEffect(() => {
    const sync = () => loop.setPaused(document.hidden || opts.userPaused);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [loop, opts.userPaused]);
}
