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
}: {
  actions: ToolActionMap;
  onConfirm: (id: string) => void;
  onDeny: (id: string) => void;
  onStop: (id: string) => void;
  onStopAll: () => void;
}) {
  const list = Object.values(actions);
  if (list.length === 0) return null;
  const running = list.filter((a) => !TERMINAL_EVENTS.has(a.event)).length;
  return (
    <section aria-label="Tool actions" data-testid="tool-actions-tray">
      {list.map((a) => (
        <ToolActionCard key={a.action_id} action={a} onConfirm={onConfirm} onDeny={onDeny} onStop={onStop} />
      ))}
      {running > 1 && (
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
