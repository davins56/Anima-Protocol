import { base44 } from "@/api/base44Client";
import { isRetryableStoreWriteError } from "@/lib/storeErrorSignals";
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
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  // upsertCharacters used to wrap storeFetch timeouts as a plain Error and
  // drop `code`, so Init showed DEFAULT_STORE_TIMEOUT_MESSAGE verbatim.
  return /took too long to respond/i.test(String(err.message || ""));
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

/** Store row whose universe+name matches a bundled starter (case-insensitive). */
export function matchCharacterByIdentity(character, items) {
  const key = characterIdentityKey(character);
  if (!key || key === "::") return null;
  const list = Array.isArray(items) ? items : [];
  return (
    list.find(
      (item) =>
        isUsableSessionId(item?.id) && characterIdentityKey(item) === key,
    ) || null
  );
}

/**
 * When remap left a bundled seed id that the store did not return, resolve it
 * by universe+name. Does not throw — Init still creates the session.
 */
export function applyIdentityFallback(selectedIds, originalIds, bundledChars, upsertedItems) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  const originals = Array.isArray(originalIds) ? originalIds : [];
  const bundled = Array.isArray(bundledChars) ? bundledChars : [];
  const items = Array.isArray(upsertedItems) ? upsertedItems : [];
  const storeIds = new Set(
    items.map((item) => item?.id).filter((id) => isUsableSessionId(id)),
  );
  if (!storeIds.size) return ids;

  return ids.map((id, index) => {
    const original = originals[index];
    const character = bundled.find((c) => c.id === original);
    if (!character) return id;
    const stale = id === character.id && !storeIds.has(character.id);
    if (!stale) return id;
    const match = matchCharacterByIdentity(character, items);
    return isUsableSessionId(match?.id) ? match.id : id;
  });
}

/**
 * Pair submitted starter rows with store-returned rows: index first (bulk
 * upsert preserves order), then universe+name. Used so Init can replace
 * picker seed ids with the ids Postgres actually stored.
 */
export function characterUpsertIdMap(submitted, upsertedItems) {
  const map = {};
  const list = Array.isArray(submitted) ? submitted.filter((c) => c?.id) : [];
  const items = Array.isArray(upsertedItems) ? upsertedItems : [];
  const byIdentity = new Map(
    items
      .filter((item) => isUsableSessionId(item?.id))
      .map((item) => [characterIdentityKey(item), item.id]),
  );
  list.forEach((char, index) => {
    const byIndex = items[index]?.id;
    if (isUsableSessionId(byIndex)) {
      map[char.id] = byIndex;
      return;
    }
    map[char.id] = byIdentity.get(characterIdentityKey(char)) || char.id;
  });
  return map;
}

/**
 * After a bundled-starter upsert, map picker ids onto store ids.
 * Prefer an explicit idMap (old → new), then the upsert items, then the
 * client seed id when the write is idempotent.
 */
export function remapSelectedCharacterIds(
  selectedIds,
  bundledChars,
  upsertedItems,
  idMap = {},
) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  const fromMap =
    idMap && typeof idMap === "object" && !Array.isArray(idMap) ? idMap : {};
  const items = Array.isArray(upsertedItems)
    ? upsertedItems.filter((item) => isUsableSessionId(item?.id))
    : [];
  const derived = characterUpsertIdMap(bundledChars, items);
  const merged = { ...derived, ...fromMap };
  if (!Object.keys(merged).length && !items.length) return ids;

  const byReturnedId = new Set(items.map((item) => item.id));
  return ids.map((id) => {
    if (merged[id]) return merged[id];
    if (byReturnedId.has(id)) return id;
    return id;
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
 * Persist bundled starters without blocking Init. Bulk-upsert keeps client
 * seed ids, so ChatSession.create can proceed immediately with picker ids.
 * Remapped store ids are applied only after the upsert settles (next Init /
 * roster refresh) — a Worker cold start must not consume the create budget.
 */
export function remappedInitCharacterIds(selectedIds, bundledSelected, upserted) {
  if (!upserted) return selectedIds;
  return applyIdentityFallback(
    remapSelectedCharacterIds(
      selectedIds,
      bundledSelected,
      upserted?.items,
      upserted?.idMap,
    ),
    selectedIds,
    bundledSelected,
    upserted?.items,
  );
}

export function beginBundledStarterUpsert({
  bundledSelected,
  selectedIds,
  upsert,
  timeoutMs,
  onSettled,
} = {}) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  const bundled = Array.isArray(bundledSelected) ? bundledSelected : [];
  if (!bundled.length || typeof upsert !== "function") {
    return { selectedIds: ids, pending: Promise.resolve(null) };
  }
  const rows = bundled.map(({ _bundled, ...rest }) => rest);
  const pending = Promise.resolve()
    .then(() =>
      upsert(rows, {
        skipExistingLookup: true,
        ...(timeoutMs != null ? { timeoutMs } : {}),
      }),
    )
    .then((upserted) => {
      if (!upserted) {
        onSettled?.(ids, null);
        return null;
      }
      const nextIds = remappedInitCharacterIds(ids, bundled, upserted);
      onSettled?.(nextIds, upserted);
      return { selectedIds: nextIds, upserted };
    })
    .catch((err) => {
      console.warn("[Anima] Starter upsert did not block Init:", err);
      onSettled?.(ids, null);
      return null;
    });
  return { selectedIds: ids, pending };
}

/**
 * Await ChatSession.create for Init. On abort/timeout/503 reset, retry once,
 * then throw INIT_SESSION_TIMEOUT_MESSAGE for timeouts (not the generic
 * storeFetch toast). Opening narrator/therapy rows persist via
 * /messages/replace in the background so that write cannot block navigation.
 */
export async function createInitChatSession(
  payload,
  {
    create = (data) => base44.entities.ChatSession.create(data),
    persistMessages = (sessionId, messages) =>
      base44.messages.replace(sessionId, messages),
    retryLimit = STORE_SESSION_CREATE_RETRY_LIMIT,
  } = {},
) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const sessionFields = { ...(payload || {}) };
  delete sessionFields.messages;

  const attempts = Math.max(0, retryLimit) + 1;
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const session = requireCreatedSession(await create(sessionFields));
      if (messages.length > 0) {
        Promise.resolve(persistMessages(session.id, messages)).catch((err) => {
          console.warn("[Anima] Opening messages persist failed:", err);
        });
        return { ...session, messages };
      }
      return session;
    } catch (err) {
      lastErr = err;
      const canRetry = isRetryableStoreWriteError(err) && i < attempts - 1;
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
  if (isStoreTimeoutError(lastErr)) {
    const timeoutErr = new Error(INIT_SESSION_TIMEOUT_MESSAGE);
    timeoutErr.code = "timeout";
    timeoutErr.cause = lastErr;
    throw timeoutErr;
  }
  throw lastErr;
}
