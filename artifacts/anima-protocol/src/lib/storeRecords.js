/**
 * Normalize /api/store list + row JSON so pickers never treat a wrapper or a
 * missing data.id as "no characters".
 */

export function isUsableEntityId(id) {
  return typeof id === "string" && id.trim() !== "" && id !== "undefined" && id !== "null";
}

/** Accept a bare array or `{ items | data: [] }` from a Worker/proxy wrap. */
export function normalizeStoreList(data) {
  if (Array.isArray(data)) return data.filter(Boolean);
  if (data && typeof data === "object") {
    if (Array.isArray(data.items)) return data.items.filter(Boolean);
    if (Array.isArray(data.data)) return data.data.filter(Boolean);
  }
  return [];
}

/** Prefer jsonb `id`, then the table entityId, so list/get stay selectable. */
export function hydrateStoreRecord(record, entityId) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  if (isUsableEntityId(record.id)) return record;
  if (isUsableEntityId(entityId)) return { ...record, id: entityId };
  return record;
}

export function hydrateStoreList(data, entityIds = []) {
  return normalizeStoreList(data).map((record, index) =>
    hydrateStoreRecord(record, entityIds[index]),
  );
}
