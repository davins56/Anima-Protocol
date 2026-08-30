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
 * Map a Sacred Space ritual focus onto the Check-In page mood vocabulary.
 * @param {string | null | undefined} focus
 */
export function moodFromRitualFocus(focus) {
  if (!focus) return "peaceful";
  return FOCUS_MOOD[String(focus).toLowerCase()] || "peaceful";
}

/**
 * Build a CheckIn body using only fields the two existing writers already use.
 *
 * Check-In page (`pages/CheckIn.jsx`):
 *   timestamp, mood, mood_intensity, physical_state, reflection, gratitude, mode_used
 * In-chat ritual (`hooks/useCheckInRitual.js`):
 *   session_id, user_email, check_in_date, mood, current_focus, revelation,
 *   freeform_note, processed
 *
 * There is no CheckIn `source` (or meditation/sacred-space discriminator) in
 * either writer — do not invent one. Ritual focus maps to `current_focus`.
 *
 * @param {{
 *   reflection?: string,
 *   gratitude?: string,
 *   ritualFocus?: string,
 *   characterName?: string,
 *   userEmail?: string,
 *   modeUsed?: string,
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
    userEmail,
    modeUsed,
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
  /** @type {Record<string, unknown>} */
  const payload = {
    timestamp: ts,
    check_in_date: ts.slice(0, 10),
    mood: mood || moodFromRitualFocus(ritualFocus),
    mood_intensity: 5,
    physical_state: "grounded",
    reflection: text || fallback,
    gratitude: thanks,
    current_focus: ritualFocus || "",
    freeform_note: characterName ? `Sacred Space with ${characterName}` : "",
    user_email: userEmail || "",
    processed: false,
  };

  // mode_used is the user's selected app mode (serenity / anima / …), not a
  // new "sacred_space" enum. Omit when unknown so we don't invent a value.
  if (modeUsed) payload.mode_used = modeUsed;

  return payload;
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
  const focus = payload.current_focus ? ` Focus: ${payload.current_focus}.` : "";
  setGlobalCheckInContext(
    `User mood: ${payload.mood}.${focus} Reflection: ${payload.reflection}`,
  );
  return created;
}
