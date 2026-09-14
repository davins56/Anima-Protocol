/**
 * Character-name matching for the Serenity / Fallen Angel train track.
 *
 * Settings backups and multi-speaker transcripts use a few spellings
 * ("Fallen Angel", "fallen-angel", "FallenAngel"). Normalize before compare
 * so `--characters` and the default train-track filter do not miss them.
 */

/** Default companions for this train track when ingesting an Anima backup. */
export const DEFAULT_TRAIN_CHARACTERS = ["Serenity", "Fallen Angel"] as const;

export function normalizeCharacterKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

const ALIASES: Record<string, string> = {
  serenity: "serenity",
  fallenangel: "fallenangel",
  fallen: "fallenangel",
  thefallenangel: "fallenangel",
};

function canonicalKey(name: string): string {
  const key = normalizeCharacterKey(name);
  return ALIASES[key] || key;
}

/** True when two speaker labels refer to the same companion. */
export function namesMatch(a: string, b: string): boolean {
  const na = canonicalKey(a);
  const nb = canonicalKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Allow "Serenity Prime" vs "Serenity" without matching "Angel" to "Fallen Angel".
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  return shorter.length >= 6 && longer.startsWith(shorter);
}

export function matchesAnyCharacter(name: string, wanted: string[]): boolean {
  return wanted.some((w) => namesMatch(name, w));
}

export function parseCharacterList(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const names = raw
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return names.length ? names : undefined;
}

/** Best-effort name from a system prompt ("You are Serenity, …"). */
export function characterNameFromSystem(system?: string): string | undefined {
  if (!system?.trim()) return undefined;
  const match = system.match(/you are\s+([^,.:;\n]+)/i);
  const name = match?.[1]?.trim();
  return name || undefined;
}
