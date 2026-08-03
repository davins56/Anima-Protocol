const API_BASE = `${window.location.origin}/api`;

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
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

  sendMessage: async function* (conversationId, content, systemPrompt) {
    const res = await fetch(
      `${API_BASE}/openai/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, systemPrompt }),
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
};
