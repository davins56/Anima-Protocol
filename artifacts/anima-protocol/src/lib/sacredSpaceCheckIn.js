import { base44 } from "@/api/base44Client";
import { setGlobalCheckInContext } from "@/hooks/useCheckInRitual";

const FOCUS_MOOD = {
  healing: "peaceful",
  clarity: "calm",
  love: "joyful",
  strength: "hopeful",
  awakening: "peaceful",
  gratitude: "hopeful",
};

/**
 * Map a Sacred Space ritual focus to the Check-In mood vocabulary.
 * @param {string | null | undefined} focus
 */
export function moodFromRitualFocus(focus) {
  if (!focus) return "peaceful";
  return FOCUS_MOOD[String(focus).toLowerCase()] || "peaceful";
}

/**
 * Build the CheckIn body Sacred Space writes so the reflection log
 * (`appearsInCheckInList`) and Insights readers see the same shape as
 * `/check-in` (reflection / gratitude), not only the in-chat ritual fields.
 *
 * @param {{
 *   reflection?: string,
 *   gratitude?: string,
 *   ritualFocus?: string,
 *   characterName?: string,
 *   characterId?: string,
 *   userEmail?: string,
 *   mood?: string,
 *   now?: Date,
 * }} input
 */
export function buildSacredSpaceCheckIn(input = {}) {
  const {
    reflection,
    gratitude,
    ritualFocus,
    characterName,
    characterId,
    userEmail,
    mood,
    now = new Date(),
  } = input;

  const text = String(reflection || "").trim();
  const thanks = String(gratitude || "").trim();
  const fallback = characterName
    ? `Sacred Space with ${characterName}${ritualFocus ? ` — ${ritualFocus} focus` : ""}.`
    : ritualFocus
      ? `Sacred Space ritual — ${ritualFocus}.`
      : "Sacred Space session.";

  const ts = now.toISOString();
  return {
    timestamp: ts,
    check_in_date: ts.slice(0, 10),
    mood: mood || moodFromRitualFocus(ritualFocus),
    mood_intensity: 5,
    physical_state: "grounded",
    reflection: text || fallback,
    gratitude: thanks,
    mode_used: "sacred_space",
    source: "sacred_space",
    ritual_focus: ritualFocus || "",
    character_id: characterId || "",
    character_name: characterName || "",
    user_email: userEmail || "",
  };
}

/**
 * Reflection Log keeps rows that captured a written reflection or gratitude.
 * Sacred Space payloads always include `reflection`, so they pass this filter.
 * @param {Record<string, unknown> | null | undefined} entry
 */
export function appearsInCheckInList(entry) {
  if (!entry || typeof entry !== "object") return false;
  const reflection = typeof entry.reflection === "string" ? entry.reflection.trim() : "";
  const gratitude = typeof entry.gratitude === "string" ? entry.gratitude.trim() : "";
  return Boolean(reflection || gratitude);
}

/**
 * Persist a Sacred Space entry as a CheckIn and notify vessel-context listeners
 * so chat attunement refreshes without a full reload.
 * @param {Parameters<typeof buildSacredSpaceCheckIn>[0]} input
 */
export async function recordSacredSpaceCheckIn(input) {
  const payload = buildSacredSpaceCheckIn(input);
  const created = await base44.entities.CheckIn.create(payload);
  const focus = payload.ritual_focus ? ` (${payload.ritual_focus})` : "";
  setGlobalCheckInContext(
    `User mood: ${payload.mood}. Sacred Space${focus}. Reflection: ${payload.reflection}`,
  );
  return created;
}
