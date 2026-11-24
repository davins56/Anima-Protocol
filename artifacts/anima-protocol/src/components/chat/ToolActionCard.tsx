/**
 * Chat upgrade 4 (VITE_ANIMA_TOOLS): one tool action in the chat.
 * Shows what the server says is happening, the exact request on a
 * confirmation (target, what will be sent, amount), sources as [n], and
 * Stop while it runs. Never starts a tool by itself.
 */
import { useEffect, useState } from "react";
import { Globe, Square, Check, X, Link2 } from "lucide-react";
import {
  canStop,
  isWaitingForUser,
  reasonText,
  statusText,
  type ToolAction,
} from "@/lib/tools/toolFrames";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function secondsLeft(expiresAt: string, now: number): number | null {
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) ? Math.max(0, Math.round((t - now) / 1000)) : null;
}

function formatAmount(amount: number, currency: string | null | undefined) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
  } catch {
    return `${amount} ${currency || ""}`.trim();
  }
}

export default function ToolActionCard({
  action,
  onConfirm,
  onDeny,
  onStop,
}: {
  action: ToolAction;
  onConfirm: (id: string) => void;
  onDeny: (id: string) => void;
  onStop: (id: string) => void;
}) {
  const waitingRaw = action.event === "confirmation_required";
  const now = useNow(waitingRaw);
  const waiting = isWaitingForUser(action, now);
  const c = action.confirmation;
  const left = c ? secondsLeft(c.expires_at, now) : null;
  const status = waitingRaw && !waiting ? "Expired" : statusText(action);

  return (
    <div
      className="my-2 ml-10 sm:ml-12 max-w-[85%] border border-cyan-400/25 bg-black/40 p-3 text-sm"
      data-testid="tool-action-card"
      data-event={action.event}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-cyan-200/80">
        <Globe className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{action.tool.replace(/_/g, " ")}</span>
        <span className="ml-auto text-primary/50" aria-live="polite">
          {status}
        </span>
      </div>
      {action.summary && <p className="mt-1 text-primary/80">{action.summary}</p>}
      {action.reason && <p className="mt-1 text-[12px] text-amber-200/80">{reasonText(action.reason)}</p>}

      {waiting && c && (
        <div className="mt-2 border border-amber-300/30 bg-amber-300/5 p-2 space-y-1" data-testid="tool-confirmation">
          <p className="font-mono text-[10px] tracking-widest uppercase text-amber-200/80">
            Confirm {c.action_kind.replace(/_/g, " ")}
          </p>
          {c.target && (
            <p className="text-[12px] text-primary/70">
              To: <span className="font-mono">{c.target}</span>
            </p>
          )}
          {c.payload_summary && (
            <p className="text-[12px] text-primary/80 whitespace-pre-wrap" data-testid="tool-payload-summary">
              {c.payload_summary}
            </p>
          )}
          {c.amount != null && (
            <p className="text-[12px] text-primary/90 font-semibold" data-testid="tool-amount">
              Amount: {formatAmount(c.amount, c.currency)}
            </p>
          )}
          {left != null && <p className="text-[11px] text-primary/40">Expires in {left}s</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => onConfirm(action.action_id)}
              disabled={Boolean(action.pending)}
              className="inline-flex items-center gap-1 min-h-[40px] px-3 border border-emerald-400/40 text-emerald-200/90 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
              data-testid="tool-confirm"
            >
              <Check className="w-3.5 h-3.5" /> {action.pending === "confirm" ? "Confirming…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => onDeny(action.action_id)}
              disabled={Boolean(action.pending)}
              className="inline-flex items-center gap-1 min-h-[40px] px-3 border border-primary/30 text-primary/70 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
              data-testid="tool-deny"
            >
              <X className="w-3.5 h-3.5" /> No
            </button>
          </div>
        </div>
      )}

      {action.sources.length > 0 && (
        <ol className="mt-2 space-y-1" data-testid="tool-sources">
          {action.sources.map((s, i) => (
            <li key={s.id} className="text-[12px] text-primary/70">
              <span className="font-mono text-primary/40">[{i + 1}]</span>{" "}
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline text-cyan-200/80">
                {s.title}
              </a>
              {s.site_name && <span className="text-primary/40"> · {s.site_name}</span>}
              {s.snippet && <span className="block text-primary/50">{s.snippet}</span>}
            </li>
          ))}
        </ol>
      )}
      {action.sources.length === 0 && action.result?.url && (
        <a
          href={action.result.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-2 inline-flex items-center gap-1 text-[12px] underline text-cyan-200/80"
        >
          <Link2 className="w-3 h-3" /> {action.result.title || action.result.url}
        </a>
      )}

      {canStop(action) && !waiting && (
        <button
          type="button"
          onClick={() => onStop(action.action_id)}
          disabled={action.pending === "stop"}
          className="mt-2 inline-flex items-center gap-1 min-h-[40px] px-3 border border-red-400/40 text-red-200/90 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
          data-testid="tool-stop"
        >
          <Square className="w-3 h-3" /> {action.pending === "stop" ? "Stopping…" : "Stop"}
        </button>
      )}
      {action.error && <p className="mt-1 text-[12px] text-red-300/80">{action.error}</p>}
    </div>
  );
}
