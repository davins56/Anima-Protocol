function isUsableEntityId(id: unknown): id is string {
  return typeof id === "string" && id.trim() !== "" && id !== "undefined" && id !== "null";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * List/GET must expose a usable `id`. Some older rows stored entityId on the
 * table while jsonb `data.id` was missing — the client then could not select
 * the character or open chat with it.
 */
export function presentEntityData(row: {
  entityId: string;
  data: unknown;
}): Record<string, unknown> {
  const data = asRecord(row.data);
  const id = isUsableEntityId(data.id) ? data.id : row.entityId;
  return { ...data, id };
}
