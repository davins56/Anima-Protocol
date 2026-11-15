// @ts-check
import { useCallback, useMemo, useRef, useState } from "react";
import { animaApi } from "@/api/animaApi";
import {
  applyScenePatch,
  emptyScene,
  isSceneConflictError,
  isScenesDisabledError,
  normalizeScene,
  sceneFromErrorPayload,
  scenesEnabledFromContext,
} from "@/lib/situationalScene";

/**
 * Talk-screen state for #763 situational scenes (ANIMA_SITUATIONAL_SCENES).
 *
 * - Off until the session context says `scenes_enabled: true` AND
 *   `GET /scene` answers. A 409 `scenes_disabled` or a 404 at any point
 *   turns it off quietly for this load (B9), with no error logged.
 * - Every write names the session it belongs to; a result for a session
 *   that is no longer open is dropped (per-session isolation).
 * - PATCH is optimistic and reconciles with the returned `scene`; it rolls
 *   back on failure. `rev`, `adult_gated` and `heard_by` are only ever
 *   server values.
 *
 * @param {{
 *   openSessionIdRef: { current: string | null | undefined },
 *   onEvents?: (sessionId: string, rows: any[]) => void,
 *   onNotice?: (kind: "conflict" | "error", message: string) => void,
 *   api?: typeof animaApi.chat.scene,
 * }} opts
 */
export function useSituationalScene({ openSessionIdRef, onEvents, onNotice, api }) {
  const sceneApi = api || animaApi.chat.scene;
  const [enabled, setEnabledState] = useState(false);
  const [scene, setSceneState] = useState(/** @type {import("@/lib/situationalScene").Scene | null} */ (null));
  const enabledRef = useRef(false);
  const sceneRef = useRef(/** @type {import("@/lib/situationalScene").Scene | null} */ (null));
  const sessionRef = useRef(/** @type {string | null} */ (null));
  const latest = useRef({ onEvents, onNotice });
  latest.current = { onEvents, onNotice };

  const isOpen = (sid) => Boolean(sid) && openSessionIdRef.current === sid && sessionRef.current === sid;

  const setScene = (next) => {
    sceneRef.current = next;
    setSceneState(next);
  };
  const setEnabled = (on) => {
    enabledRef.current = on;
    setEnabledState(on);
  };

  const disable = useCallback((sid) => {
    if (sid && sessionRef.current !== sid) return;
    setEnabled(false);
    setScene(null);
  }, []);

  const reset = useCallback((sid = null) => {
    sessionRef.current = sid;
    setEnabled(false);
    setScene(null);
  }, []);

  /** Adopt a server scene (GET, PATCH/command result, done.scene, 409 body). */
  const adopt = useCallback((sid, raw) => {
    if (!isOpen(sid) || !enabledRef.current) return null;
    const next = normalizeScene(raw);
    if (!next) return null;
    setScene(next);
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitEvents = (sid, res) => {
    const rows = Array.isArray(res?.events) ? res.events : [];
    if (rows.length && isOpen(sid)) latest.current.onEvents?.(sid, rows);
  };

  /**
   * Read the flag from an already-fetched session context, then load the
   * scene. Resolves to whether scenes are on; never rejects.
   */
  const loadFromContext = useCallback(async (sid, contextPayload) => {
    sessionRef.current = sid;
    if (!scenesEnabledFromContext(contextPayload)) return false;
    try {
      const res = await sceneApi.get(sid);
      if (openSessionIdRef.current !== sid || sessionRef.current !== sid) return false;
      const next = normalizeScene(res);
      if (!next) return false;
      setEnabled(true);
      // Context may carry adult_gated when the scene body does not.
      if (next.adult_gated == null && typeof contextPayload?.adult_gated === "boolean") {
        next.adult_gated = contextPayload.adult_gated;
      }
      setScene(next);
      return true;
    } catch {
      // 409 scenes_disabled / 404 / network: feature off for this load.
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneApi]);

  const refetch = useCallback(async (sid) => {
    if (!isOpen(sid) || !enabledRef.current) return null;
    try {
      const res = await sceneApi.get(sid);
      return adopt(sid, res);
    } catch (err) {
      if (isScenesDisabledError(err)) disable(sid);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneApi, adopt, disable]);

  /** One PATCH (B1–B3, Invite Aspect). Resolves to the server scene or null. */
  const patch = useCallback(async (sid, partial) => {
    if (!isOpen(sid) || !enabledRef.current) return null;
    const before = sceneRef.current;
    setScene(applyScenePatch(before || emptyScene(), partial));
    const rev = before?.rev;
    try {
      const res = await sceneApi.patch(sid, {
        ...partial,
        ...(Number.isSafeInteger(rev) ? { if_rev: rev } : {}),
      });
      if (!isOpen(sid)) return null;
      const next = adopt(sid, res?.scene ?? res);
      emitEvents(sid, res);
      return next;
    } catch (err) {
      if (!isOpen(sid)) return null;
      if (isScenesDisabledError(err)) {
        disable(sid);
        return null;
      }
      if (isSceneConflictError(err)) {
        const current = sceneFromErrorPayload(err);
        if (current) setScene(current);
        else setScene(before);
        latest.current.onNotice?.("conflict", "The scene changed in another tab — showing the latest.");
        return null;
      }
      setScene(before);
      latest.current.onNotice?.("error", "Couldn't update the scene. Try again.");
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneApi, adopt, disable]);

  /** `/scene <place>, <names…>` (B6). */
  const command = useCallback(async (sid, text) => {
    if (!isOpen(sid) || !enabledRef.current) return { ok: false, unresolved: [] };
    const rev = sceneRef.current?.rev;
    try {
      const res = await sceneApi.command(sid, text, Number.isSafeInteger(rev) ? rev : undefined);
      if (!isOpen(sid)) return { ok: false, unresolved: [] };
      adopt(sid, res?.scene ?? res);
      emitEvents(sid, res);
      const unresolved = Array.isArray(res?.unresolved)
        ? res.unresolved.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 60))
        : [];
      return { ok: true, unresolved };
    } catch (err) {
      if (!isOpen(sid)) return { ok: false, unresolved: [] };
      if (isScenesDisabledError(err)) {
        disable(sid);
        return { ok: false, disabled: true, unresolved: [] };
      }
      if (isSceneConflictError(err)) {
        const current = sceneFromErrorPayload(err);
        if (current) setScene(current);
        latest.current.onNotice?.("conflict", "The scene changed in another tab — showing the latest.");
        return { ok: false, unresolved: [] };
      }
      latest.current.onNotice?.("error", "Couldn't set the scene. Try again.");
      return { ok: false, unresolved: [] };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneApi, adopt, disable]);

  return useMemo(
    () => ({
      enabled,
      scene,
      enabledRef,
      sceneRef,
      reset,
      disable,
      adopt,
      loadFromContext,
      refetch,
      patch,
      command,
    }),
    [enabled, scene, reset, disable, adopt, loadFromContext, refetch, patch, command],
  );
}
