/**
 * Style flavor for battles and encounters. Narration only on the client: the
 * 4D battle's authoritative modifiers live in the server-frozen
 * `session.config.style` and sim-core (Backend Data). Tone comes from the
 * server-frozen session style (public affect layer); anything else is the
 * neutral `composed`.
 */
import { useEffect, useMemo, useState } from "react";
import { narrate, SEED_LIBRARY, stanceLine, TONES, type StylePick, type Tone } from "@workspace/martial-core";
import { martialArtsApi, martialArtsEnabled } from "./api";
import type { SessionStyle } from "./types";

export type BattleStyle = { pick: StylePick; tone: Tone };

export function fromSessionStyle(raw: unknown): BattleStyle | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<SessionStyle>;
  if (typeof s.styleId !== "string" || !SEED_LIBRARY.byId.has(s.styleId)) return null;
  const tone = (TONES as readonly string[]).includes(s.tone as string) ? (s.tone as Tone) : "composed";
  return { pick: { style_id: s.styleId, variant_id: typeof s.variantId === "string" ? s.variantId : null }, tone };
}

/**
 * The anima's style for a battle view: the server-frozen session style when
 * present, otherwise her stored profile (read-only GET). Null when the
 * feature is off or she has no style yet.
 */
export function useBattleStyle(characterId: string | null | undefined, sessionStyle?: unknown): BattleStyle | null {
  const frozen = useMemo(() => fromSessionStyle(sessionStyle), [sessionStyle]);
  const [stored, setStored] = useState<BattleStyle | null>(null);
  useEffect(() => {
    let live = true;
    setStored(null);
    if (frozen || !characterId) return undefined;
    void (async () => {
      if (!(await martialArtsEnabled())) return;
      const r = await martialArtsApi.character(characterId);
      const p = r.ok ? r.data?.profile?.primary : null;
      if (live && p && SEED_LIBRARY.byId.has(p.style_id)) setStored({ pick: { style_id: p.style_id, variant_id: p.variant_id ?? null }, tone: "composed" });
    })();
    return () => {
      live = false;
    };
  }, [characterId, frozen]);
  return frozen ?? stored;
}

/** Latest narration line for a stream of battle events (navi actions only). */
export function latestNarration(events: ReadonlyArray<{ type: string; seq?: number; unitId?: string; sourceId?: string; outcome?: string }>, style: BattleStyle | null): string | null {
  if (!style) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const line = narrate(SEED_LIBRARY, events[i], style.pick, style.tone);
    if (line) return line;
  }
  return null;
}

export function encounterStance(style: BattleStyle | null, who: string): string | null {
  return style ? stanceLine(SEED_LIBRARY, style.pick, who) : null;
}
