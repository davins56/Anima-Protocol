/**
 * "Your bots": read-only status cards for the user's Grok Bot assistants.
 * Bot text is untrusted outside content: plain text only, links shown as
 * their domain and never clickable. Hidden unless the bridge is enabled.
 */
import { Bot, Clock } from "lucide-react";
import { isStatusStale, linkDomain, relativeTime, type BotStatusCard } from "@/lib/botBridge";

const STATE_LABEL: Record<BotStatusCard["state"], string> = {
  working: "Working",
  idle: "Idle",
  blocked: "Blocked",
  offline: "Offline",
};

export function BotStatusCardView({ bot, nowMs = Date.now() }: { bot: BotStatusCard; nowMs?: number }) {
  const stale = isStatusStale(bot.as_of, nowMs);
  return (
    <li
      data-testid={`bot-card-${bot.bot_id}`}
      data-stale={stale ? "true" : "false"}
      className={`border border-primary/15 bg-card p-3 space-y-1.5 ${stale ? "opacity-60" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] text-primary/80 flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5" aria-hidden="true" />
          {bot.display_name}
        </p>
        <span className="font-mono text-[9px] tracking-widest uppercase text-primary/50">
          {stale ? "Stale" : STATE_LABEL[bot.state]}
        </span>
      </div>
      {bot.role && <p className="text-[9px] font-mono text-primary/35">{bot.role}</p>}
      <p className="text-[10px] font-mono text-primary/70 leading-relaxed">
        <span className="text-primary/40">Working on: </span>
        {bot.summary}
      </p>
      {bot.items.length > 0 && (
        <ul className="space-y-0.5" aria-label={`${bot.display_name} open items`}>
          {bot.items.map((item, i) => {
            const domain = linkDomain(item.url);
            return (
              <li key={i} className="text-[9px] font-mono text-primary/55">
                • {item.title}
                {item.status ? ` — ${item.status}` : ""}
                {domain ? <span className="text-primary/30"> ({domain})</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[9px] font-mono text-primary/35 flex items-center gap-1">
        <Clock className="w-3 h-3" aria-hidden="true" />
        {stale ? `Last heard ${relativeTime(bot.as_of, nowMs)}. This may be out of date.` : `Last active ${relativeTime(bot.as_of, nowMs)}`}
      </p>
    </li>
  );
}

export default function BotAwarenessPanel({
  bots,
  error = "",
  nowMs = Date.now(),
}: {
  bots: BotStatusCard[] | null;
  error?: string;
  nowMs?: number;
}) {
  return (
    <div className="space-y-2" data-testid="bot-awareness-panel">
      <p className="font-mono text-xs text-primary/70 tracking-wider uppercase flex items-center gap-2">
        <Bot className="w-3.5 h-3.5" aria-hidden="true" />
        Your bots
      </p>
      <p className="text-[9px] font-mono text-primary/35 leading-relaxed max-w-md">
        What your assistants outside the app last reported. Your companions can mention this, but never act for them.
        Anything older than 6 hours is marked stale.
      </p>
      {error && <p className="text-[9px] font-mono text-destructive/80">{error}</p>}
      {bots && bots.length === 0 && !error && (
        <p className="text-[9px] font-mono text-primary/45">No bot has reported yet.</p>
      )}
      {bots && bots.length > 0 && (
        <ul className="space-y-2">
          {bots.map((bot) => (
            <BotStatusCardView key={bot.bot_id} bot={bot} nowMs={nowMs} />
          ))}
        </ul>
      )}
    </div>
  );
}
