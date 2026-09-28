import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/apiOrigin";

/**
 * Fail closed until `/api/healthz/llm` says the chain is not local-only.
 * A local-only chain has one Ollama slot; lore and path helpers must not
 * call the model. Unknown routing is treated as local-only.
 */

/** @type {boolean | null} */
let known = null;
/** @type {Promise<boolean> | null} */
let probe = null;
/** @type {Set<() => void>} */
const listeners = new Set();

/**
 * @param {unknown} status
 * @returns {boolean}
 */
export function chainIsLocalOnly(status) {
  const chain =
    status && typeof status === "object" && Array.isArray(/** @type {{ chain?: unknown }} */ (status).chain)
      ? /** @type {{ chain: unknown[] }} */ (status).chain
      : null;
  if (!chain || chain.length === 0) return true;
  return chain.length === 1 && chain[0] === "local";
}

/** @returns {boolean} */
export function isLocalOnlyLlmChain() {
  if (known != null) return known;
  return true;
}

/** @param {boolean | null} value */
export function setLocalOnlyLlmChainForTests(value) {
  known = value;
  probe = value == null ? null : Promise.resolve(Boolean(value));
  for (const listener of listeners) listener();
}

export function resetLocalOnlyLlmChainForTests() {
  known = null;
  probe = null;
  listeners.clear();
}

/** @param {() => void} listener */
export function subscribeLocalOnlyLlmChain(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish() {
  for (const listener of listeners) listener();
}

/** @returns {Promise<boolean>} */
export function ensureLocalOnlyLlmChainProbed() {
  if (known != null) return Promise.resolve(known);
  if (probe) return probe;
  probe = fetch(apiUrl("/healthz/llm"), { credentials: "same-origin" })
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => {
      known = chainIsLocalOnly(body);
      return known;
    })
    .catch(() => {
      known = true;
      return true;
    })
    .finally(publish);
  return probe;
}

/**
 * A bubble that has finished and is safe to scan once.
 * Typing, thinking, streaming, and the "..." placeholder are skipped.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
/** Re-renders when the public routing probe settles. Starts fail-closed. */
export function useLocalOnlyLlmChain() {
  const [localOnly, setLocalOnly] = useState(isLocalOnlyLlmChain);
  useEffect(() => {
    setLocalOnly(isLocalOnlyLlmChain());
    const unsubscribe = subscribeLocalOnlyLlmChain(() => {
      setLocalOnly(isLocalOnlyLlmChain());
    });
    void ensureLocalOnlyLlmChainProbed();
    return unsubscribe;
  }, []);
  return localOnly;
}

export function isFinishedLoreMessage(message) {
  if (!message || typeof message !== "object") return false;
  const row = /** @type {{ character_name?: unknown, is_streaming?: unknown, content?: unknown }} */ (
    message
  );
  const name = row.character_name;
  if (name === "__typing__" || name === "__thinking__") return false;
  if (row.is_streaming === true) return false;
  const content = String(row.content || "").trim();
  if (!content || content === "...") return false;
  return true;
}
