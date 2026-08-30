/**
 * Resolve which character should speak / supply prompt context for a turn.
 *
 * `assistant_character_id` from the client must belong to the conversation's
 * participant set. Outside IDs are ignored so we never load another character's
 * relationship/evolution/arc state while attributing the reply to them.
 */
export function resolveActiveCharacterId(
  requestedId: string | null | undefined,
  characterIds: string[],
): string | null {
  const participants = characterIds.map(String).filter(Boolean);
  if (requestedId != null && String(requestedId).trim()) {
    const id = String(requestedId);
    if (participants.includes(id)) return id;
  }
  return participants.length > 0 ? participants[0] : null;
}

/**
 * Only trust a client-supplied assistant name when it matches the resolved
 * participant; otherwise prefer the loaded character's name.
 */
export function resolveActiveCharacterName(params: {
  requestedId: string | null | undefined;
  resolvedId: string | null;
  requestedName: string | null | undefined;
  loadedName: string | null | undefined;
}): string | null {
  const { requestedId, resolvedId, requestedName, loadedName } = params;
  if (
    resolvedId &&
    requestedId != null &&
    String(requestedId) === resolvedId &&
    requestedName != null &&
    String(requestedName).trim()
  ) {
    return String(requestedName);
  }
  if (loadedName != null && String(loadedName).trim()) {
    return String(loadedName);
  }
  return null;
}
