import { base44 } from "@/api/base44Client";
import { setGlobalCheckInContext } from "@/hooks/useCheckInRitual";

/**
 * Build the Daily Resonance `/check-in` body so Reflection Log
 * (`appearsInCheckInList`) keeps the row even when the operator skips the
 * optional reflection / gratitude fields.
 *
 * @param {{
 *   mood?: string,
 *   moodIntensity?: number | string,
 *   physicalState?: string,
 *   reflection?: string,
 *   gratitude?: string,
 *   modeUsed?: string,
 *   userEmail?: string,
 *   now?: Date,
 * }} input
 */
export function buildDailyResonanceCheckIn(input = {}) {
  const {
    mood,
    moodIntensity,
    physicalState,
    reflection,
    gratitude,
    modeUsed,
    userEmail,
    now = new Date(),
  } = input;

  const text = String(reflection || "").trim();
  const thanks = String(gratitude || "").trim();
  const parsedIntensity = Number(moodIntensity);
  const intensity = Number.isFinite(parsedIntensity) ? parsedIntensity : 5;
  const body = String(physicalState || "neutral").trim() || "neutral";
  const moodLabel = String(mood || "neutral").trim() || "neutral";
  const fallback = `Daily Resonance — ${moodLabel} (${intensity}/10), body ${body}.`;
  const ts = now.toISOString();

  return {
    timestamp: ts,
    check_in_date: ts.slice(0, 10),
    mood: moodLabel,
    mood_intensity: intensity,
    physical_state: body,
    reflection: text || fallback,
    gratitude: thanks,
    mode_used: modeUsed || "serenity",
    source: "daily_resonance",
    user_email: userEmail || "",
  };
}

/**
 * Persist a Daily Resonance check-in and notify vessel-context listeners.
 * Callers must await this — a rejected create is the visible failure.
 * @param {Parameters<typeof buildDailyResonanceCheckIn>[0]} input
 */
export async function recordDailyResonanceCheckIn(input) {
  const payload = buildDailyResonanceCheckIn(input);
  const created = await base44.entities.CheckIn.create(payload);
  setGlobalCheckInContext(
    `User mood: ${payload.mood}. Intensity: ${payload.mood_intensity}/10. Body: ${payload.physical_state}. Reflection: ${payload.reflection}`,
  );
  return created;
}
