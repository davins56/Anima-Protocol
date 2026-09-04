import { base44 } from "@/api/base44Client";

/**
 * A personal Anima (the companion Customise Anima shapes), as opposed to a
 * roster Character from a franchise. Onboarding and the Animas page write
 * `Anima` rows; some older seed paths wrote `Character` with `_isAnima`.
 */
export function isPersonalAnimaRecord(row) {
  if (!row || typeof row !== "object") return false;
  if (row._isAnima === true) return true;
  const category = String(row.category || "").toLowerCase();
  return category === "anima-construct" || category === "anima";
}

export async function listPersonalAnimas(limit = 100) {
  const animas = await base44.entities.Anima.list("-created_date", limit);
  if (Array.isArray(animas) && animas.length > 0) return animas;

  const characters = await base44.entities.Character.list(
    "-created_date",
    limit,
  ).catch(() => []);
  return (characters || []).filter(isPersonalAnimaRecord);
}

/**
 * Same selection order as Customise Anima:
 * `?anima=` / requested id, else assigned_user === me.email, else first row.
 */
export function selectPersonalAnima(rows, requestedId, me) {
  const list = Array.isArray(rows) ? rows : [];
  if (requestedId) {
    const match = list.find((a) => a && a.id === requestedId);
    if (match) return match;
  }
  if (me?.email) {
    const assigned = list.find((a) => a && a.assigned_user === me.email);
    if (assigned) return assigned;
  }
  return list[0] || null;
}
