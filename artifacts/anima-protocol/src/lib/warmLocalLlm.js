import { authHeaders } from "@/api/authBridge";
import { apiUrl } from "@/lib/apiOrigin";

/** One app-open preload per browser tab session. */
export const SESSION_LLM_WARM_KEY = "anima_llm_session_warm";

let started = false;

function readSessionFlag(storage) {
  try {
    return storage?.getItem(SESSION_LLM_WARM_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSessionFlag(storage) {
  try {
    storage?.setItem(SESSION_LLM_WARM_KEY, "1");
  } catch {
    // Private mode can throw. The module flag still limits this page load.
  }
}

/**
 * Fire-and-forget preload. Returns immediately. Never throws.
 * The request goes to this app's API only — the model host stays on the server.
 */
export function scheduleSessionLlmWarm({
  storage = globalThis.sessionStorage,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  authHeadersImpl = authHeaders,
  apiUrlImpl = apiUrl,
} = {}) {
  if (started || readSessionFlag(storage)) return false;
  started = true;
  void dispatchSessionLlmWarm({
    storage,
    fetchImpl,
    authHeadersImpl,
    apiUrlImpl,
  });
  return true;
}

async function dispatchSessionLlmWarm({
  storage,
  fetchImpl,
  authHeadersImpl,
  apiUrlImpl,
}) {
  try {
    if (typeof fetchImpl !== "function") return;
    const headers = await authHeadersImpl({ Accept: "application/json" });
    if (!headers?.Authorization) {
      started = false;
      return;
    }
    writeSessionFlag(storage);
    await fetchImpl(apiUrlImpl("/llm/warm"), {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: "{}",
    });
  } catch {
    writeSessionFlag(storage);
  }
}

export function resetSessionLlmWarmForTests() {
  started = false;
}
