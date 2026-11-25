/**
 * Chat upgrade 4: per-session tool action state for the chat page.
 * Frames come from the chat stream (`onFrame`) and, after the stream closes,
 * from the replay endpoint. User decisions go through toolsApi.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { applyToolFrame, patchAction, type ToolActionMap, TERMINAL_EVENTS } from "./toolFrames";
import { decideToolAction, fetchToolPreview, followToolAction, stopAllToolActions, stopToolAction } from "./toolsApi";

/**
 * `killed`: the server answered 423 (global ANIMA_TOOLS_KILL or the user's
 * per-account kill). Confirm is blocked; Stop still works.
 * `disabled`: 503 tools_disabled (ANIMA_TOOLS off). Nothing more is sent.
 */
export type ToolsServerState = { killed: boolean; disabled: boolean };

export function useToolActions(sessionId: string | null | undefined) {
  const [actions, setActions] = useState<ToolActionMap>({});
  const [server, setServer] = useState<ToolsServerState>({ killed: false, disabled: false });
  const serverRef = useRef(server);
  serverRef.current = server;
  const noteServer = useCallback((res: unknown) => {
    const r = (res && typeof res === "object" ? res : {}) as { killed?: unknown; disabled?: unknown };
    const killed = r.killed === true;
    const disabled = r.disabled === true;
    if (killed || disabled) {
      setServer((prev) => ({ killed: prev.killed || killed, disabled: prev.disabled || disabled }));
    }
  }, []);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const follows = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const live = follows.current;
    setActions({});
    setServer({ killed: false, disabled: false });
    return () => {
      for (const ctrl of live.values()) ctrl.abort();
      live.clear();
    };
  }, [sessionId]);

  const onFrame = useCallback((frame: unknown) => {
    setActions((prev) => applyToolFrame(prev, frame));
  }, []);

  const follow = useCallback(
    (actionId: string) => {
      if (follows.current.has(actionId) || serverRef.current.disabled) return;
      const ctrl = new AbortController();
      follows.current.set(actionId, ctrl);
      const afterSeq = actionsRef.current[actionId]?.seq ?? 0;
      void followToolAction(actionId, afterSeq, onFrame, { signal: ctrl.signal })
        .then(noteServer)
        .finally(() => {
          follows.current.delete(actionId);
        });
    },
    [onFrame, noteServer],
  );

  const decide = useCallback(
    async (actionId: string, decision: "confirm" | "deny") => {
      const action = actionsRef.current[actionId];
      const c = action?.confirmation;
      if (!action || !c || action.pending) return;
      // Confirm is pointless while killed or disabled; a "no" still goes through.
      if (serverRef.current.disabled || (decision === "confirm" && serverRef.current.killed)) return;
      setActions((prev) => patchAction(prev, actionId, { pending: decision, error: null }));
      const res = await decideToolAction(actionId, {
        confirmationId: c.id,
        decision,
        requestHash: c.request_hash,
      });
      if (res.ok) {
        setActions((prev) => patchAction(prev, actionId, { pending: null }));
        // The decision's own frames (started… or denied) arrive on the replay stream.
        follow(actionId);
      } else {
        setActions((prev) => patchAction(prev, actionId, { pending: null, error: res.message ?? null }));
        noteServer(res);
        if (res.action) onFrame(res.action);
        if (res.status === 409 || res.status === 410) follow(actionId);
      }
    },
    [follow, onFrame, noteServer],
  );

  const stop = useCallback(
    async (actionId: string) => {
      const action = actionsRef.current[actionId];
      if (!action || TERMINAL_EVENTS.has(action.event)) return;
      setActions((prev) => patchAction(prev, actionId, { pending: "stop", error: null }));
      const res = await stopToolAction(actionId);
      setActions((prev) => patchAction(prev, actionId, { pending: null, error: res.ok ? null : res.message ?? null }));
      if (!res.ok) noteServer(res);
      if (res.ok) follow(actionId);
    },
    [follow, noteServer],
  );

  const stopAll = useCallback(async () => {
    const res = await stopAllToolActions();
    if (!res.ok) noteServer(res);
    if (res.ok) {
      for (const a of Object.values(actionsRef.current)) {
        if (!TERMINAL_EVENTS.has(a.event)) follow(a.action_id);
      }
    }
    return res;
  }, [follow, noteServer]);

  /** Browser preview: 501 preview_not_available until phase 3 (shown as is). */
  const preview = useCallback(
    async (actionId: string): Promise<string | null> => {
      const res = await fetchToolPreview(actionId);
      if (!res.ok) {
        noteServer(res);
        return (res as { message?: string }).message ?? null;
      }
      return "Preview loaded.";
    },
    [noteServer],
  );

  /** `done.tool_actions`: keep following actions that outlive the stream. */
  const adoptDone = useCallback(
    (ids: unknown) => {
      if (!Array.isArray(ids)) return;
      for (const id of ids) {
        const a = actionsRef.current[String(id)];
        if (a && !TERMINAL_EVENTS.has(a.event)) follow(a.action_id);
      }
    },
    [follow],
  );

  return { actions, server, onFrame, decide, stop, stopAll, adoptDone, preview };
}
