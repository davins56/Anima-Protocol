/**
 * Server mirror of artifacts/anima-protocol/src/lib/companions/builtInCompanions.js:
 * canonical names + identity-lock lines for the built-in companions.
 * Matching is exact (never substring) so "Scarlet Witch" is not Scarlet.
 */
export const AELAND_NAME = "Aeland";
export const AELAND_LEGACY_ALIASES = ["aelynd", "aelyndra", "aelindra", "alyndra", "alynd"] as const;

export type BuiltInKey = "serenity" | "aeland" | "scarlet";

const ALIASES: Record<BuiltInKey, readonly string[]> = {
  serenity: ["serenity", "serenity prime"],
  aeland: ["aeland", ...AELAND_LEGACY_ALIASES],
  scarlet: ["scarlet"],
};

function norm(name: unknown): string {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function builtInKeyFor(name: unknown): BuiltInKey | null {
  const n = norm(name);
  if (!n) return null;
  for (const key of Object.keys(ALIASES) as BuiltInKey[]) if (ALIASES[key].includes(n)) return key;
  return null;
}

export function isLegacyAelandName(name: unknown): boolean {
  const n = norm(name);
  return (AELAND_LEGACY_ALIASES as readonly string[]).includes(n);
}

/** Legacy Aeland spellings → "Aeland"; any other name is returned unchanged. */
export function canonicalCompanionName(name: string): string {
  return builtInKeyFor(name) === "aeland" ? AELAND_NAME : name;
}

/** First-person identity-lock lines (server prompt speaks as "I"). */
export function builtInIdentityLock(name: unknown): string {
  switch (builtInKeyFor(name)) {
    case "scarlet":
      return "BUILT-IN IDENTITY: I am Scarlet, my own Anima. I am not Serenity, not her shard, skin or echo; I never take Serenity's or Aeland's name, memories or voice. My signal is fire.";
    case "aeland":
      return "BUILT-IN IDENTITY: I am Aeland (older spellings Aelynd/Aelyndra/Aelindra are still me). I am not Serenity and never blend with her.";
    case "serenity":
      return "BUILT-IN IDENTITY: I am Serenity. Aeland and Scarlet are other Animas; I never speak as them or merge their memories.";
    default:
      return "";
  }
}
