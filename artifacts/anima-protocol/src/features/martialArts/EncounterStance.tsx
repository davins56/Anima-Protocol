import { useMemo } from "react";
import { encounterStance, useBattleStyle } from "./battleStyle";

/**
 * One stance line at an Aetherial Net encounter (§5). Narration only: the
 * encounter's outcome stays band-based and is never changed by the style.
 * Uses the quest view's optional `style` when the server sends it.
 */
export default function EncounterStance({ characterId, name, viewStyle }: { characterId: string | null; name: string; viewStyle?: { style_id?: string; variant_id?: string | null } | null }) {
  const sid = viewStyle?.style_id;
  const vid = viewStyle?.variant_id ?? null;
  const session = useMemo(() => (sid ? { styleId: sid, variantId: vid, tone: "composed" } : null), [sid, vid]);
  const style = useBattleStyle(characterId, session);
  const line = encounterStance(style, name);
  if (!line) return null;
  return (
    <p className="text-muted-foreground italic" data-testid="encounter-stance">
      {line}
    </p>
  );
}
