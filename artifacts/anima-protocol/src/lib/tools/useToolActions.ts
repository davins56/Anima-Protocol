/**
 * Chat upgrade 4: per-session tool action state for the chat page.
 * Frames come from the chat stream (`onFrame`) and, after the stream closes,
 * from the replay endpoint. User decisions go through toolsApi.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { applyToolFrame, patchAction, type ToolActionMap, TERMINAL_EVENTS } from "./toolFrames";
import { decideToolAction, followToolAction, stopAllToolActions, stopToolAction } from "./toolsApi";

export function useToolActions(sessionId: string | null | undefined) {
  const [actions, setActions] = useState<ToolActionMap>({});
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const follows = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const live = follows.current;
    setActions({});
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
      if (follows.current.has(actionId)) return;
      const ctrl = new AbortController();
      follows.current.set(actionId, ctrl);
      const afterSeq = actionsRef.current[actionId]?.seq ?? 0;
      void followToolAction(actionId, afterSeq, onFrame, { signal: ctrl.signal }).finally(() => {
        follows.current.delete(actionId);
      });
    },
    [onFrame],
  );

  const decide = useCallback(
    async (actionId: string, decision: "confirm" | "deny") => {
      const action = actionsRef.current[actionId];
      const c = action?.confirmation;
      if (!action || !c || action.pending) return;
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
        if (res.action) onFrame(res.action);
        if (res.status === 409 || res.status === 410) follow(actionId);
      }
    },
    [follow, onFrame],
  );

  const stop = useCallback(
    async (actionId: string) => {
      const action = actionsRef.current[actionId];
      if (!action || TERMINAL_EVENTS.has(action.event)) return;
      setActions((prev) => patchAction(prev, actionId, { pending: "stop", error: null }));
      const res = await stopToolAction(actionId);
      setActions((prev) => patchAction(prev, actionId, { pending: null, error: res.ok ? null : res.message ?? null }));
      if (res.ok) follow(actionId);
    },
    [follow],
  );

  const stopAll = useCallback(async () => {
    const res = await stopAllToolActions();
    if (res.ok) {
      for (const a of Object.values(actionsRef.current)) {
        if (!TERMINAL_EVENTS.has(a.event)) follow(a.action_id);
      }
    }
    return res;
  }, [follow]);

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

  return { actions, onFrame, decide, stop, stopAll, adoptDone };
}
