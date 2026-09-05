import { apiUrl } from '@/lib/apiOrigin';
import { authHeaders } from './authBridge';
import { readSseJsonStream } from '@/lib/readSseJsonStream';

/**
 * Cap a hung SSE body so Chat cannot sit on "Processing..." forever.
 * Must stay above the Worker free-tier open budget (80s) plus first-chunk
 * (35s) so the browser does not abort while OpenRouter is still hopping
 * m2.7 → m3 → Gemma 4. Keep in lockstep with
 * `artifacts/api-server/src/lib/chatTimeouts.ts` `CHAT_STREAM_TIMEOUT_MS`.
 */
export const CHAT_STREAM_TIMEOUT_MS = 115_000;

function chatStreamTimeoutError() {
  const err = new Error("The companion took too long to reply. Please try again.");
  err.code = "chat_stream_timeout";
  return err;
}

async function request(path, options = {}) {
  const headers = await authHeaders(options.headers);
  const res = await fetch(apiUrl(path), {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error || res.statusText);
    error.status = res.status;
    error.code = err.code;
    error.payload = err;
    throw error;
  }
  return res;
}

export const animaApi = {
  conversations: {
    list: () => request("/openai/conversations").then((r) => r.json()),
    create: (title) =>
      request("/openai/conversations", {
        method: "POST",
        body: JSON.stringify({ title }),
      }).then((r) => r.json()),
    get: (id) => request(`/openai/conversations/${id}`).then((r) => r.json()),
    delete: (id) =>
      request(`/openai/conversations/${id}`, { method: "DELETE" }),
  },

  sendMessage: async function* (
    conversationId,
    content,
    systemPrompt,
    deepMode,
    responseJsonSchema,
    maxTokens,
  ) {
    const res = await fetch(
      apiUrl(`/openai/conversations/${conversationId}/messages`),
      {
        method: "POST",
        headers: await authHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({
          content,
          systemPrompt,
          deepMode: !!deepMode,
          ...(responseJsonSchema ? { responseJsonSchema } : {}),
          ...(typeof maxTokens === "number" ? { maxTokens } : {}),
        }),
      }
    );
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    yield* readSseJsonStream(res.body);
  },

  chat: {
    /**
     * Scene Mind — pick which group companion speaks next.
     * Returns { character_id, character_name, reason, interrupted, ... }.
     */
    selectSpeaker: async ({
      sessionId,
      content = "",
      characterIds,
      forceCharacterId,
      eligibleCharacterIds,
      useDirector = false,
      isContinue = false,
      interruptChance,
    }) => {
      const res = await request("/chat/scene-mind", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          content,
          character_ids: characterIds,
          force_character_id: forceCharacterId || null,
          eligible_character_ids: eligibleCharacterIds,
          use_director: Boolean(useDirector),
          is_continue: !!isContinue,
          ...(typeof interruptChance === "number"
            ? { interrupt_chance: interruptChance }
            : {}),
        }),
      });
      return res.json();
    },

    sendMessage: async function* ({
      sessionId,
      content,
      characterId,
      characterIds,
      assistantCharacterId,
      assistantCharacterName,
      forceCharacterId,
      eligibleCharacterIds,
      useSceneMind,
      isContinue,
      mode,
      systemPrompt,
      deepMode,
      persist = true,
      turnId,
      persistenceOwner,
      metadata,
      region,
    }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CHAT_STREAM_TIMEOUT_MS);
      try {
        const res = await fetch(apiUrl('/chat/messages'), {
          method: "POST",
          headers: await authHeaders(),
          credentials: 'same-origin',
          signal: controller.signal,
          body: JSON.stringify({
            session_id: sessionId,
            content,
            character_id: characterId,
            character_ids: characterIds,
            assistant_character_id: assistantCharacterId,
            assistant_character_name: assistantCharacterName,
            force_character_id: forceCharacterId || null,
            eligible_character_ids: eligibleCharacterIds,
            use_scene_mind: useSceneMind,
            is_continue: !!isContinue,
            mode,
            system_prompt: systemPrompt,
            deep_mode: !!deepMode,
            persist,
            turn_id: turnId,
            persistence_owner: persistenceOwner,
            metadata,
            region,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || `API error: ${res.status}`);
        }
        yield* readSseJsonStream(res.body);
      } catch (err) {
        if (err?.name === "AbortError" || err?.code === "ABORT_ERR") {
          throw chatStreamTimeoutError();
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },

    completeMessage: async (payload) => {
      let content = "";
      let done = null;
      for await (const event of animaApi.chat.sendMessage(payload)) {
        if (event.error) throw new Error(event.error);
        if (event.content) content += event.content;
        if (event.done) done = event;
      }
      return { content, ...done };
    },

    turnStatus: (turnId) =>
      request(`/chat/turns/${encodeURIComponent(turnId)}`).then((r) => r.json()),

    commitTurn: (turnId) =>
      request(`/chat/turns/${encodeURIComponent(turnId)}/commit`, {
        method: "POST",
        body: JSON.stringify({}),
      }).then((r) => r.json()),

    retryTurn: (turnId) =>
      request(`/chat/turns/${encodeURIComponent(turnId)}/retry`, {
        method: "POST",
        body: JSON.stringify({}),
      }).then((r) => r.json()),
  },

  /**
   * Relationship OS — timeline, resonance crystals, Anima journals, shared Home.
   * Backed by /api/relationship-os routes.
   */
  relationshipOs: {
    timeline: (animaId, { limit = 40, eventType } = {}) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (eventType) qs.set("eventType", eventType);
      return request(`/relationship-os/timeline/${encodeURIComponent(animaId)}?${qs}`).then((r) => r.json());
    },
    openChapter: (animaId, { title, summary, chapterIndex } = {}) =>
      request(`/relationship-os/timeline/${encodeURIComponent(animaId)}/chapter`, {
        method: "POST",
        body: JSON.stringify({ title, summary, chapterIndex }),
      }).then((r) => r.json()),

    resonanceMemories: (animaId, { limit = 12 } = {}) =>
      request(`/relationship-os/resonance-memories/${encodeURIComponent(animaId)}?limit=${limit}`).then((r) => r.json()),
    crystallize: (animaId, payload) =>
      request(`/relationship-os/resonance-memories/${encodeURIComponent(animaId)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      }).then((r) => r.json()),

    journal: (animaId, { limit = 20, unreadOnly = false } = {}) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (unreadOnly) qs.set("unread", "1");
      return request(`/relationship-os/journal/${encodeURIComponent(animaId)}?${qs}`).then((r) => r.json());
    },
    writeJournal: (animaId, payload) =>
      request(`/relationship-os/journal/${encodeURIComponent(animaId)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
    markJournalRead: (animaId, entryId) =>
      request(`/relationship-os/journal/${encodeURIComponent(animaId)}/${encodeURIComponent(entryId)}/read`, {
        method: "POST",
        body: JSON.stringify({}),
      }).then((r) => r.json()),

    home: () => request("/relationship-os/home").then((r) => r.json()),
    updateHome: (patch) =>
      request("/relationship-os/home", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }).then((r) => r.json()),
    placeObject: (payload) =>
      request("/relationship-os/home/objects", {
        method: "POST",
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
    registerRitual: (payload) =>
      request("/relationship-os/home/rituals", {
        method: "POST",
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
    addArtifact: (payload) =>
      request("/relationship-os/home/artifacts", {
        method: "POST",
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
  },

  codeRepair: {
    analyze: ({ issue, context } = {}) =>
      request("/code-repair/analyze", {
        method: "POST",
        body: JSON.stringify({
          issue,
          context,
        }),
      }).then((r) => r.json()),
  },

  battleModels: {
    resolve: ({ player, enemy } = {}) =>
      request("/battle-models/resolve", {
        method: "POST",
        body: JSON.stringify({ player, enemy }),
      }).then((r) => r.json()),
  },

  protocolUpgrade: {
    capability: () => request("/protocol-upgrade/capability").then((r) => r.json()),
    classify: ({ request: upgradeRequest } = {}) =>
      request("/protocol-upgrade/classify", {
        method: "POST",
        body: JSON.stringify({ request: upgradeRequest }),
      }).then((r) => r.json()),
    launch: ({ request: upgradeRequest, scope, session_id, surface } = {}) =>
      request("/protocol-upgrade", {
        method: "POST",
        body: JSON.stringify({
          request: upgradeRequest,
          scope,
          session_id,
          surface,
        }),
      }).then((r) => r.json()),
    list: () => request("/protocol-upgrade").then((r) => r.json()),
    get: (id) => request(`/protocol-upgrade/${id}`).then((r) => r.json()),
  },
};
