// Open a chat thread by id, extracted so the navigation race (switch threads
// while a slower fetch is still in flight) can be unit tested without rendering
// Chat.jsx. Callers pass `isCurrent` so a stale completion cannot apply.

function firstSession(matches) {
  return Array.isArray(matches) ? matches[0] : matches;
}

export async function loadOpenChatSession({
  id,
  isCurrent,
  fetchSession,
  fetchMessages,
  retryMissing = true,
}) {
  if (!id || id === "undefined" || id === "null") {
    return id ? { status: "missing" } : { status: "idle" };
  }

  try {
    let matches = await fetchSession(id);
    if (typeof isCurrent === "function" && !isCurrent()) {
      return { status: "stale" };
    }

    let session = firstSession(matches);
    // Hyperdrive / pooled reads can miss a row for a moment after POST.
    if (!session && retryMissing) {
      matches = await fetchSession(id);
      if (typeof isCurrent === "function" && !isCurrent()) {
        return { status: "stale" };
      }
      session = firstSession(matches);
    }
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
