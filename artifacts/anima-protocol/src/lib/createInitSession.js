import { base44 } from "@/api/base44Client";
import { STORE_SESSION_CREATE_RETRY_LIMIT } from "@/lib/storeTimeouts";
import { isTherapySession, therapyOpeningMessage } from "@/lib/therapyManuals";

/**
 * Shown after Init's ChatSession.create aborts (including the one retry).
 * Distinct from the generic storeFetch connection toast so the operator can
 * retry a reachable store instead of debugging the network.
 */
export const INIT_SESSION_TIMEOUT_MESSAGE =
  "Starting the session timed out. The store is reachable — tap Init to try again.";

export function isStoreTimeoutError(err) {
  if (!err) return false;
  if (err.code === "timeout") return true;
  return err.name === "TimeoutError" || err.name === "AbortError";
}

export const INIT_SESSION_MISSING_ID_MESSAGE =
  "The store created a session but did not return an id. Tap Init to try again.";

export function initSessionErrorMessage(err) {
  if (isStoreTimeoutError(err)) return INIT_SESSION_TIMEOUT_MESSAGE;
  return (
    err?.message ||
    "Could not initialize this session. Check that you are signed in and the store API is reachable."
  );
}

/** True when a value can be used as `/chat/:id` (not `undefined` / `null`). */
export function isUsableSessionId(id) {
  return typeof id === "string" && id.trim() !== "" && id !== "undefined" && id !== "null";
}

function characterIdentityKey(character) {
  return `${String(character?.universe || "").toLowerCase()}::${String(character?.name || "").toLowerCase()}`;
}

/**
 * After a bundled-starter upsert, map picker ids onto store ids.
 * Prefer the upsert response (the server may mint a new id); fall back to the
 * client seed id when the write is idempotent.
 */
export function remapSelectedCharacterIds(
  selectedIds,
  bundledChars,
  upsertedItems,
) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  const items = Array.isArray(upsertedItems)
    ? upsertedItems.filter((item) => isUsableSessionId(item?.id))
    : [];
  if (!items.length) return ids;

  const byReturnedId = new Set(items.map((item) => item.id));
  const byIdentity = new Map(
    items.map((item) => [characterIdentityKey(item), item.id]),
  );

  return ids.map((id) => {
    if (byReturnedId.has(id)) return id;
    const bundled = (bundledChars || []).find((character) => character.id === id);
    if (!bundled) return id;
    return byIdentity.get(characterIdentityKey(bundled)) || id;
  });
}

/**
 * Normalize ChatSession.create's JSON. Workers / proxies have returned a
 * wrapper or dropped `id` even when the insert succeeded — navigating to
 * `/chat/undefined` then looks like Init failed.
 */
export function createdSessionId(session) {
  if (Array.isArray(session)) return createdSessionId(session[0]);
  if (!session || typeof session !== "object") return null;
  const candidates = [session.id, session.entityId, session.data?.id];
  for (const candidate of candidates) {
    if (isUsableSessionId(candidate)) return candidate;
  }
  return null;
}

export function requireCreatedSession(session) {
  const id = createdSessionId(session);
  if (!id) {
    const err = new Error(INIT_SESSION_MISSING_ID_MESSAGE);
    err.code = "missing_session_id";
    throw err;
  }
  return { ...session, id };
}

/**
 * Build the ChatSession.create body for New Session / Init.
 *
 * Messages live as their own rows. Solo Init therefore omits `messages` so
 * create is a single POST and the client does not follow up with
 * /messages/replace for an empty array. Opening rows (group narrator, therapy)
 * are included only when there is at least one message to persist.
 *
 * Does not call auth.me() — therapy uses the already-loaded auth user.
 * Does not invoke an LLM; first turn happens after the session exists.
 */
export function buildInitSessionPayload({
  mode,
  characterId,
  character,
  groupCharacterIds,
  groupCharacters,
  openingScene,
  authUser,
  now = new Date(),
} = {}) {
  const m = mode || "solo";
  const groupChars = Array.isArray(groupCharacters)
    ? groupCharacters.filter(Boolean)
    : [];
  const crossoverUniverses = Array.from(
    new Set(groupChars.map((c) => c.universe).filter(Boolean)),
  );
  const isCrossover = m === "group" && crossoverUniverses.length >= 2;

  const therapySession =
    m === "solo" &&
    isTherapySession(
      { mode: m, therapy_mode: false },
      authUser,
      character || { _isAnima: false },
    );

  let title = "New Session";
  let initialMessages = [];

  if (m === "solo" && character) {
    title = character.name || "New Session";
  } else if (m === "group" && groupChars.length) {
    title =
      groupChars.slice(0, 2).map((c) => c.name).join(", ") +
      (groupChars.length > 2 ? ` +${groupChars.length - 2}` : "");
    const charNames = groupChars.map((c) => c.name).join(", ");
    initialMessages = [
      {
        role: "assistant",
        character_name: "Narrator",
        content: `The stage is set. ${charNames} find themselves drawn together by fate or circumstance. The air crackles with potential as these extraordinary beings come face to face. What unfolds next will alter the course of events. The scene awaits...`,
        timestamp: now.toISOString(),
      },
    ];
  }

  if (therapySession && character && initialMessages.length === 0) {
    title = character.name ? `Therapy · ${character.name}` : title;
    initialMessages = [
      {
        role: "assistant",
        character_name: character.name,
        content: therapyOpeningMessage(character.name),
        timestamp: now.toISOString(),
      },
    ];
  }

  const payload = {
    mode: m,
    character_id: characterId || character?.id || null,
    title,
    opening_scene: openingScene || "",
    messages_migrated: true,
  };

  if (m === "group") {
    payload.group_character_ids = groupCharacterIds || groupChars.map((c) => c.id);
    payload.selected_character_names = groupChars.map((c) => c.name);
    payload.crossover_universes = crossoverUniverses;
    payload.is_crossover = isCrossover;
  }

  if (therapySession) {
    payload.therapy_mode = true;
    payload.companion_mode = "therapy";
  }

  if (initialMessages.length > 0) {
    payload.messages = initialMessages;
  }

  return {
    payload,
    initialMessages,
    therapySession,
    isCrossoverSession: isCrossover,
    crossoverUniverses,
    groupCharacters: groupChars,
  };
}

/**
 * Await ChatSession.create for Init. On abort/timeout, retry once, then throw
 * INIT_SESSION_TIMEOUT_MESSAGE (not the generic connection toast).
 */
export async function createInitChatSession(
  payload,
  {
    create = (data) => base44.entities.ChatSession.create(data),
    retryLimit = STORE_SESSION_CREATE_RETRY_LIMIT,
  } = {},
) {
  const attempts = Math.max(0, retryLimit) + 1;
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return requireCreatedSession(await create(payload));
    } catch (err) {
      lastErr = err;
      const canRetry = isStoreTimeoutError(err) && i < attempts - 1;
      if (canRetry) continue;
      if (isStoreTimeoutError(err)) {
        const timeoutErr = new Error(INIT_SESSION_TIMEOUT_MESSAGE);
        timeoutErr.code = "timeout";
        timeoutErr.cause = err;
        throw timeoutErr;
      }
      throw err;
    }
  }
  const timeoutErr = new Error(INIT_SESSION_TIMEOUT_MESSAGE);
  timeoutErr.code = "timeout";
  timeoutErr.cause = lastErr;
  throw timeoutErr;
}
