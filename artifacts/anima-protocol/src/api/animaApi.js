import { apiUrl } from '@/lib/apiOrigin';

async function request(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
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

  sendMessage: async function* (conversationId, content, systemPrompt, deepMode) {
    const res = await fetch(
      apiUrl(`/openai/conversations/${conversationId}/messages`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, systemPrompt, deepMode: !!deepMode }),
      }
    );
    if (!res.ok) throw new Error(`API error: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data;
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  },

  chat: {
    sendMessage: async function* ({
      sessionId,
      content,
      characterId,
      characterIds,
      assistantCharacterId,
      assistantCharacterName,
      mode,
      systemPrompt,
      deepMode,
      persist = true,
      metadata,
    }) {
      const res = await fetch(apiUrl('/chat/messages'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          content,
          character_id: characterId,
          character_ids: characterIds,
          assistant_character_id: assistantCharacterId,
          assistant_character_name: assistantCharacterName,
          mode,
          system_prompt: systemPrompt,
          deep_mode: !!deepMode,
          persist,
          metadata,
        }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              yield JSON.parse(line.slice(6));
            } catch {
              // ignore parse errors
            }
          }
        }
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
  },
};
