import { sanitizePreset } from "./experiencePresets";

/**
 * Share a visual configuration without exporting identity, conversations,
 * memories, permissions or other application data.
 */
export function exportExperiencePreset(name, values) {
  const cleanName = String(name || "Anima Theme").trim().slice(0, 60) || "Anima Theme";
  return JSON.stringify({
    format: "anima-experience-preset",
    version: 1,
    name: cleanName,
    values: sanitizePreset(values),
  }, null, 2);
}

/** Parse untrusted user-supplied files, allowing presentation keys only. */
export function importExperiencePreset(text) {
  if (typeof text !== "string" || text.length > 16_384) {
    throw new Error("Preset file is too large or invalid.");
  }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("Preset is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || parsed.format !== "anima-experience-preset" || parsed.version !== 1
      || typeof parsed.name !== "string"
      || !parsed.values || typeof parsed.values !== "object"
      || Array.isArray(parsed.values)) {
    throw new Error("Unsupported Anima experience preset.");
  }
  const values = sanitizePreset(parsed.values);
  if (Object.keys(values).length === 0) {
    throw new Error("Preset contains no supported appearance settings.");
  }
  return { name: parsed.name.trim().slice(0, 60) || "Imported Theme", values };
}
