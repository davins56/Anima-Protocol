// Open a chat thread by id, extracted so the navigation race (switch threads
// while a slower fetch is still in flight) can be unit tested without rendering
// Chat.jsx. Callers pass `isCurrent` so a stale completion cannot apply.

export async function loadOpenChatSession({
  id,
  isCurrent,
  fetchSession,
  fetchMessages,
}) {
  if (!id) return { status: "idle" };

  try {
    const matches = await fetchSession(id);
    if (typeof isCurrent === "function" && !isCurrent()) {
      return { status: "stale" };
    }

    const session = Array.isArray(matches) ? matches[0] : matches;
    if (!session) return { status: "missing" };

    const messages = await fetchMessages(id);
    if (typeof isCurrent === "function" && !isCurrent()) {
      return { status: "stale" };
    }

    return {
      status: "ready",
      session: { ...session, messages: messages || [] },
    };
  } catch (error) {
    if (typeof isCurrent === "function" && !isCurrent()) {
      return { status: "stale" };
    }
    return { status: "error", error };
  }
}
