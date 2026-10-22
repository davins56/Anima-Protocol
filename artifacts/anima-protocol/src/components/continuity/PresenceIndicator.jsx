import { useEffect, useState } from "react";
import { useCompanionContinuity } from "@/hooks/useCompanionContinuity";
import { greetingSeen, markGreetingSeen, presenceStyle } from "@/lib/continuity";

/**
 * Subtle presence dot tied to the dream scheduler (here / lost in thought /
 * dreaming / resting). On chat it can also show a time-aware greeting once
 * per gap (remembered per companion; tap to dismiss).
 */
export default function PresenceIndicator({ characterId, name = "", surface = "chat", showGreeting = false, api, storage }) {
  const data = useCompanionContinuity(characterId, { surface, name, api });
  const [greeting, setGreeting] = useState(null);

  useEffect(() => {
    if (!showGreeting || !data?.greeting) return;
    if (greetingSeen(characterId, data.greeting, storage)) return;
    setGreeting(data.greeting);
    markGreetingSeen(characterId, data.greeting, storage);
  }, [data, characterId, showGreeting, storage]);

  if (!data?.presence) return null;
  const style = presenceStyle(data.presence);
  return (
    <div className="flex flex-col gap-1 min-w-0" data-testid="presence-indicator">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase text-primary/45" title={data.presence_label}>
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot} ${style.pulse ? "animate-pulse" : ""}`} aria-hidden="true" />
        <span className="truncate">{data.presence_label}</span>
      </span>
      {greeting && (
        <button
          type="button"
          className="text-left text-xs italic text-primary/60 hover:text-primary/80"
          data-testid="continuity-greeting"
          onClick={() => setGreeting(null)}
        >
          {greeting.text}
        </button>
      )}
    </div>
  );
}
