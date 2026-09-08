/**
 * Coalesce Clerk identity with the store profile so empty server fields
 * cannot blank Settings after a signed-in session.
 */

export function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Merge user objects. Later sources win for generic profile fields
 * (settings, selected_mode). Identity fields take the first non-empty
 * value in source order so Clerk can be listed first.
 *
 * @param {...(Record<string, unknown>|null|undefined)} sources
 */
export function mergeAccountIdentity(...sources) {
  const present = sources.filter((source) => source && typeof source === "object");
  const assigned = Object.assign({}, ...present);
  return {
    ...assigned,
    id: firstNonEmpty(...present.map((s) => s.id)) || assigned.id,
    email: firstNonEmpty(...present.map((s) => s.email)) || assigned.email || "",
    full_name:
      firstNonEmpty(
        ...present.map((s) => s.full_name),
        ...present.map((s) => s.display_name),
      ) ||
      assigned.full_name ||
      "",
    display_name:
      firstNonEmpty(
        ...present.map((s) => s.display_name),
        ...present.map((s) => s.full_name),
      ) ||
      assigned.display_name ||
      "",
  };
}

export function displayNameFromAccount(user) {
  return firstNonEmpty(user?.display_name, user?.full_name);
}
