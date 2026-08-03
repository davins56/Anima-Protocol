// Client-side orchestrator for the agentic Codespace build loop.
//
// The server (base44.functions.codespaceAgentStep) runs ONE model turn at a
// time with the file/run/scan tool schemas and returns the assistant's next
// turn (in-character narration + any tool calls). This hook owns the loop: it
// executes each requested tool against the in-browser virtual file system and
// sandbox (via the caller-supplied executeTool), feeds results back, and lets
// the companion iterate until it ends a turn with no tool calls.

import { useRef, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";

const MAX_STEPS = 18;

export function useCodespaceAgent({
  character,
  executeTool,
  getFiles,
  onAssistantMessage,
  onToolEvent,
  onError,
}) {
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const runGoal = useCallback(
    async (goal) => {
      if (!goal || !goal.trim()) return;
      stopRef.current = false;
      setRunning(true);

      const messages = [{ role: "user", content: goal.trim() }];

      try {
        for (let step = 0; step < MAX_STEPS; step += 1) {
          if (stopRef.current) {
            onAssistantMessage?.("(Build paused.)");
            break;
          }

          const res = await base44.functions.codespaceAgentStep.invoke({
            messages,
            character: character
              ? {
                  name: character.name,
                  personality: character.personality,
                  speaking_style: character.speaking_style,
                }
              : null,
            files: (getFiles?.() || []).map((f) => f.path),
          });

          const assistant = res && res.message;
          if (!assistant) {
            onError?.("The companion couldn't respond. Try again in a moment.");
            break;
          }

          messages.push({
            role: "assistant",
            content: assistant.content || "",
            ...(assistant.tool_calls && assistant.tool_calls.length
              ? { tool_calls: assistant.tool_calls }
              : {}),
          });

          if (assistant.content && assistant.content.trim()) {
            onAssistantMessage?.(assistant.content.trim());
          }

          const calls = assistant.tool_calls || [];
          if (!calls.length) break; // turn ended with no tools => done

          for (const tc of calls) {
            if (stopRef.current) break;
            let args = {};
            try {
              args = JSON.parse(tc.function?.arguments || "{}");
            } catch {
              args = {};
            }
            const name = tc.function?.name || "unknown";
            onToolEvent?.({ status: "start", name, args });

            let out;
            try {
              out = await executeTool(name, args);
            } catch (err) {
              out = { error: err instanceof Error ? err.message : String(err) };
            }
            onToolEvent?.({ status: "done", name, args, result: out });

            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(out ?? {}).slice(0, 8000),
            });
          }
        }
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
        stopRef.current = false;
      }
    },
    [character, executeTool, getFiles, onAssistantMessage, onToolEvent, onError],
  );

  return { running, runGoal, stop };
}

export default useCodespaceAgent;
