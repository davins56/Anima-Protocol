// Parsing + validation for a user-uploaded backup file, shared by Settings.jsx's
// restore flow and its tests. Keeping this pure (text in -> staged payload out,
// or throw) means the malformed-backup guard can be tested without rendering the
// whole Settings page. The friendly error message below is what the user sees
// before any network call or destructive write happens.

// Friendly singular labels for backup entity categories shown in the restore
// preview. Unknown keys fall back to a humanized version of the entity name.
export const ENTITY_LABELS = {
  ChatSession: "chat session",
  ChatMessage: "chat message",
  Character: "character",
  CharacterMemory: "memory",
  VectorMemory: "vector memory",
  Inventory: "inventory item",
  CheckIn: "check-in",
  WorldState: "lore entry",
  Quest: "quest",
  Anima: "Anima",
  MemoryCrystal: "memory crystal",
  ResonanceProfile: "resonance profile",
  UserContext: "context entry",
  KnowledgeGraph: "knowledge graph",
};

export const humanizeEntityName = (name) =>
  String(name).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();

export const pluralize = (label, count) => {
  if (count === 1) return label;
  if (/[^aeiou]y$/i.test(label)) return label.replace(/y$/i, "ies");
  if (/(s|x|z|ch|sh)$/i.test(label)) return `${label}es`;
  return `${label}s`;
};

export const entityLabel = (name, count) =>
  pluralize(ENTITY_LABELS[name] || humanizeEntityName(name), count);

export const formatBackupDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

// The friendly, user-facing message for a file that isn't a recognizable backup.
export const NOT_A_BACKUP_MESSAGE = "This file doesn't look like an Anima backup.";

// Parse the raw text of an uploaded backup file. Throws (with a friendly message
// for the recognizable "not a backup" case) when the file is malformed so the
// caller never stages a pending restore. On success returns the staged payload:
// { entities, profile, recordCount, breakdown, exportedLabel }.
export function parseBackup(text) {
  const parsed = JSON.parse(text);
  const entities = parsed?.entities;
  if (!entities || typeof entities !== "object" || Array.isArray(entities)) {
    throw new Error(NOT_A_BACKUP_MESSAGE);
  }
  const breakdown = Object.entries(entities)
    .map(([name, recs]) => ({ name, count: Array.isArray(recs) ? recs.length : 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const recordCount = breakdown.reduce((sum, item) => sum + item.count, 0);
  const exportedLabel = formatBackupDate(parsed.exported_at);
  return { entities, profile: parsed.profile, recordCount, breakdown, exportedLabel };
}
