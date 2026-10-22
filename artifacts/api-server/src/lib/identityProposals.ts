/**
 * Pure helper shared by promptBuilder (no DB imports): sentences from
 * steward-accepted identity proposals stored on companion_memories.facts.
 */
type FactLike = { about?: unknown; memory_class?: unknown; proposal?: unknown; text?: unknown; accepted_at?: unknown; forgotten?: unknown };

export function acceptedIdentityLines(facts: unknown, max = 5): string[] {
  if (!Array.isArray(facts)) return [];
  return (facts as FactLike[])
    .filter(
      (f) =>
        f && typeof f === "object" && f.forgotten !== true && f.about === "companion" && f.memory_class === "core" &&
        f.proposal !== true && typeof f.text === "string" && typeof f.accepted_at === "string",
    )
    .sort((a, b) => String(b.accepted_at).localeCompare(String(a.accepted_at)))
    .slice(0, max)
    .map((f) => String(f.text));
}
