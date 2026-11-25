/**
 * Chat upgrade 4 (VITE_ANIMA_TOOLS): the session's tool actions, newest last,
 * with a "Stop all" while anything is still running.
 */
import ToolActionCard from "./ToolActionCard";
import { TERMINAL_EVENTS, type ToolActionMap } from "@/lib/tools/toolFrames";

export default function ToolActionsTray({
  actions,
  onConfirm,
  onDeny,
  onStop,
  onStopAll,
  onPreview,
  server = { killed: false, disabled: false },
}: {
  actions: ToolActionMap;
  onConfirm: (id: string) => void;
  onDeny: (id: string) => void;
  onStop: (id: string) => void;
  onStopAll: () => void;
  onPreview?: (id: string) => Promise<string | null>;
  server?: { killed: boolean; disabled: boolean };
}) {
  const list = Object.values(actions);
  if (list.length === 0) return null;
  const running = list.filter((a) => !TERMINAL_EVENTS.has(a.event)).length;
  return (
    <section aria-label="Tool actions" data-testid="tool-actions-tray">
      {(server.disabled || server.killed) && (
        <p
          role="status"
          className="ml-10 sm:ml-12 mb-1 max-w-[85%] border border-red-400/30 bg-red-950/30 px-3 py-2 text-[12px] text-red-200/90"
          data-testid={server.disabled ? "tools-disabled" : "tools-killed"}
        >
          {server.disabled
            ? "Tools are off on this server. Nothing will run."
            : "Tools are switched off (kill switch). Nothing new will run; Stop still works."}
        </p>
      )}
      {list.map((a) => (
        <ToolActionCard
          key={a.action_id}
          action={a}
          onConfirm={onConfirm}
          onDeny={onDeny}
          onStop={onStop}
          onPreview={onPreview}
          killed={server.killed}
          disabled={server.disabled}
        />
      ))}
      {running > 1 && !server.disabled && (
        <div className="ml-10 sm:ml-12 mb-2">
          <button
            type="button"
            onClick={onStopAll}
            className="min-h-[40px] px-3 border border-red-400/40 text-red-200/90 font-mono text-[10px] tracking-widest uppercase"
            data-testid="tool-stop-all"
          >
            Stop all ({running})
          </button>
        </div>
      )}
    </section>
  );
}
