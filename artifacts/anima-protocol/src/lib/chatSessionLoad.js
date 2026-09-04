// Open a chat thread by id, extracted so the navigation race (switch threads
// while a slower fetch is still in flight) can be unit tested without rendering
// Chat.jsx. Callers pass `isCurrent` so a stale completion cannot apply.
//
// Init also stores the POST body here. `/chat` and `/chat/:id` used to be
// different route elements, so navigate unmounted Chat and wiped refs/state.
// rememberCreatedSession survives that remount; location.state.primedSession
// is the other hand-off.

const OPEN_SESSION_ERROR_MESSAGE = "Couldn't open this conversation.";

function usableId(id) {
  return typeof id === "string" && id.trim() !== "" && id !== "undefined" && id !== "null";
}

function withMessages(session) {
  if (!session || typeof session !== "object") return null;
  return {
    ...session,
    messages: Array.isArray(session.messages) ? session.messages : [],
  };
}

let primedCreated = null;

/** Store the ChatSession.create body so a remounted Chat can open it as ready. */
export function rememberCreatedSession(session) {
  const next = withMessages(session);
  if (!usableId(next?.id)) {
    primedCreated = null;
    return;
  }
  primedCreated = next;
}

export function peekCreatedSession(id) {
  if (!usableId(id) || primedCreated?.id !== id) return null;
  return primedCreated;
}

/** Return the primed POST body for this route id (does not forget the id). */
export function takeCreatedSession(id) {
  return peekCreatedSession(id);
}

export function isPrimedCreatedSession(id) {
  return Boolean(peekCreatedSession(id));
}

/** Drop the Init cache only when opening a different thread. */
export function retainCreatedSession(id) {
  if (!usableId(id) || !primedCreated) return;
  if (primedCreated.id !== id) primedCreated = null;
}

export function primedSessionForOpen({ sessionId, locationState } = {}) {
  if (!usableId(sessionId)) return null;
  const fromState = withMessages(locationState?.primedSession);
  if (fromState?.id === sessionId) {
    rememberCreatedSession(fromState);
    return fromState;
  }
  return takeCreatedSession(sessionId);
}

/**
 * First paint of /chat/:id. A just-created thread is ready immediately;
 * a normal open shows the spinner until GET/list settles.
 */
export function beginOpenSession({ sessionId, locationState } = {}) {
  if (!usableId(sessionId)) {
    return { status: "idle", primed: null };
  }
  retainCreatedSession(sessionId);
  const primed = primedSessionForOpen({ sessionId, locationState });
  if (primed) return { status: "ready", primed };
  return { status: "loading", primed: null };
}

function primedMessageCount(sessionId) {
  return peekCreatedSession(sessionId)?.messages?.length || 0;
}

/**
 * Map loadOpenChatSession's result onto Chat UI. Just-created ids keep the
 * primed POST body on GET miss, error, or timeout and never replace it with
 * the error/missing screens. A normal open of an unknown id still goes
 * missing/error.
 */
export function resolveOpenSessionFetch({ result, sessionId } = {}) {
  if (!result || result.status === "stale") return { status: "stale" };

  const keepPrimed = isPrimedCreatedSession(sessionId);

  if (result.status === "ready") {
    const remote = result.session;
    const remoteN = remote?.messages?.length || 0;
    if (keepPrimed && remoteN < primedMessageCount(sessionId)) {
      // GET landed before /messages/replace; keep the opening narrator locally.
      return { status: "ready", keepPrimed: true };
    }
    if (keepPrimed) rememberCreatedSession(null);
    return { status: "ready", applySession: remote };
  }

  if (keepPrimed && (result.status === "missing" || result.status === "error")) {
    return { status: "ready", keepPrimed: true };
  }

  if (result.status === "missing") return { status: "missing" };
  if (result.status === "error") {
    return {
      status: "error",
      message: result.error?.message || OPEN_SESSION_ERROR_MESSAGE,
    };
  }
  return { status: result.status };
}

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
