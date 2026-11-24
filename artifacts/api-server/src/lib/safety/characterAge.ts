/**
 * Companion age for the adult gate. Unknown or under-18 is never adult.
 * Photo safety may still apply additional text heuristics; this function is
 * the card-level decision used by adultGate().
 */
export type CharacterAgeCard = {
  age?: unknown;
  age_is_adult?: unknown;
  name?: unknown;
} | null | undefined;

/** Numeric age when it is a finite number; otherwise null. */
export function parseCharacterAge(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * True only when the card explicitly confirms an adult companion.
 * Missing age and missing age_is_adult default to not adult.
 * A numeric age under 18 always wins over age_is_adult: true.
 * An explicit age_is_adult: false always wins over a numeric adult age.
 */
export function characterIsAdult(character: CharacterAgeCard): boolean {
  if (!character || typeof character !== "object") return false;
  if ((character as { age_is_adult?: unknown }).age_is_adult === false) return false;
  const age = parseCharacterAge((character as { age?: unknown }).age);
  if (age != null && age < 18) return false;
  if ((character as { age_is_adult?: unknown }).age_is_adult === true) return true;
  return age != null && age >= 18;
}

/** True when every provided card is a confirmed adult. Empty list is not adult. */
export function allCharactersAreAdult(
  characters: ReadonlyArray<CharacterAgeCard> | null | undefined,
): boolean {
  if (!characters || characters.length === 0) return false;
  return characters.every((c) => characterIsAdult(c));
}
