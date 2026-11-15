/**
 * A message from one of the user's bots, shown in a companion's chat. Styled
 * as outside content (dashed border, label), rendered as plain text, links
 * not clickable. "Remember this" is the only way a bot message can reach a
 * companion's memory, and it stays disabled until migration M6 lands.
 */
import { ExternalLink } from "lucide-react";
import type { InboundBotMessage } from "@/lib/botBridge";

export default function BotMessageBubble({
  message,
  rememberAvailable = false,
  onRemember,
}: {
  message: InboundBotMessage;
  rememberAvailable?: boolean;
  onRemember?: (id: string) => void;
}) {
  const time = new Date(message.receivedAt);
  return (
    <div
      role="note"
      aria-label={`Outside message from ${message.botName}`}
      data-testid="bot-message-bubble"
      className="mx-auto max-w-md border border-dashed border-sky-400/50 bg-sky-950/20 p-3 space-y-1.5"
    >
      <p className="font-mono text-[9px] tracking-widest uppercase text-sky-300/80 flex items-center gap-1.5">
        <ExternalLink className="w-3 h-3" aria-hidden="true" />
        From {message.botName} · outside the app
        {Number.isFinite(time.getTime()) && (
          <span className="normal-case tracking-normal text-sky-300/50">
            {" "}
            · {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </p>
      <p className="whitespace-pre-wrap break-words text-[11px] font-mono text-primary/80">{message.body}</p>
      {message.flagged && (
        <p className="text-[9px] font-mono text-amber-400/80">
          This message looked like instructions, so your companion only knows it arrived, not what it says.
        </p>
      )}
      <button
        type="button"
        disabled={!rememberAvailable || !onRemember}
        title={rememberAvailable ? undefined : "Not available yet"}
        onClick={() => onRemember?.(message.id)}
        className="min-h-[44px] px-3 border border-primary/20 text-primary/70 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
      >
        Remember this
      </button>
    </div>
  );
}
