/**
 * Anima Essence (in-house rebuild of the Base44 "Anima Essence" prototype).
 * Off by default: the route and every screen are compiled out of production
 * unless the build sets VITE_ANIMA_ESSENCE=1.
 */
export const ESSENCE_ENABLED = import.meta.env.VITE_ANIMA_ESSENCE === "1";

/** Screen order Dàvīn approved: Calibrate → Vessel Awakens → Aspects → Reflections → Patterns. */
export const ESSENCE_SCREENS = [
  { key: "calibrate", label: "Calibrate" },
  { key: "vessel", label: "Vessel Awakens" },
  { key: "aspects", label: "Aspects" },
  { key: "reflections", label: "Reflections" },
  { key: "patterns", label: "Patterns" },
] as const;

export type EssenceScreen = (typeof ESSENCE_SCREENS)[number]["key"];

export function essenceScreenOf(raw: string | null | undefined): EssenceScreen {
  const hit = ESSENCE_SCREENS.find((s) => s.key === raw);
  return hit ? hit.key : "calibrate";
}

export function essencePath(characterId?: string | null, screen: EssenceScreen = "calibrate"): string {
  return characterId ? `/essence/${encodeURIComponent(characterId)}/${screen}` : "/essence";
}
