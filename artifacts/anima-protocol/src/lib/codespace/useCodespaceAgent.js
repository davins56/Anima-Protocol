// Client-side orchestrator for the agentic Codespace build loop.
//
// Supports both character companions and direct Jules API (AI Engineer).
// The backend / julesApi runs model turns with file/run/scan tool schemas and
// returns the assistant's next turn (narration + tool calls). This hook owns the
// loop: it executes requested tools against the in-browser virtual file system
// and sandbox (via caller-supplied executeTool), feeds results back, and iterates
// until the turn ends with no tool calls.

import { useRef, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { JULES_PERSONA, executeAgentStep as executeJulesStep } from "./julesApi";

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
      const isJules = character?.id === JULES_PERSONA.id;

      try {
        for (let step = 0; step < MAX_STEPS; step += 1) {
          if (stopRef.current) {
            onAssistantMessage?.("(Build paused.)");
            break;
          }

          const currentFiles = (getFiles?.() || []).map((f) => (typeof f === "string" ? f : f.path));

          let assistant;
          if (isJules) {
            assistant = await executeJulesStep(messages, getFiles?.() || [], { mode: "debug" });
          } else {
            const res = await base44.functions.codespaceAgentStep.invoke({
              messages,
              character: character
                ? {
                    name: character.name,
                    personality: character.personality,
                    speaking_style: character.speaking_style,
                  }
                : null,
              files: currentFiles,
            });
            assistant = res && res.message;
          }

          if (!assistant) {
            onError?.("The agent couldn't respond. Try again in a moment.");
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
