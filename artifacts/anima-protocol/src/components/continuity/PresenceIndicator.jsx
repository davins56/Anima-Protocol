import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCompanionContinuity } from "@/hooks/useCompanionContinuity";
import { greetingSeen, markGreetingSeen, presenceStyle } from "@/lib/continuity";
import { dreamJournalPagePath, readDreamIds, unreadDreamsFromContinuity } from "@/lib/dreamJournal";

/**
 * Subtle presence dot tied to the dream scheduler (here / lost in thought /
 * dreaming / resting). On chat it can also show a time-aware greeting once
 * per gap (remembered per companion; tap to dismiss).
 *
 * When she has a dream the user has not opened in the journal, a quiet link
 * sits under the label. The dreaming pose itself belongs to 3D Visual;
 * `useIsDreaming` exposes the flag without changing this indicator's presence
 * mapping.
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

  const unreadDreams = useMemo(
    () => unreadDreamsFromContinuity(data?.state?.recentDreams, readDreamIds(characterId, storage)),
    [data, characterId, storage],
  );

  if (!data?.presence) return null;
  const style = presenceStyle(data.presence);
  const journalHref = dreamJournalPagePath(characterId, name);
  return (
    <div className="flex flex-col gap-1 min-w-0" data-testid="presence-indicator">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase text-primary/45" title={data.presence_label}>
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot} ${style.pulse ? "animate-pulse motion-reduce:animate-none" : ""}`} aria-hidden="true" />
        <span className="truncate">{data.presence_label}</span>
      </span>
      {unreadDreams.length > 0 && (
        <Link
          to={journalHref}
          data-testid="unread-dream-indicator"
          className="text-left font-mono text-[10px] tracking-[0.14em] uppercase text-indigo-300/70 hover:text-indigo-200"
          aria-label={unreadDreams.length === 1 ? "She has an unread dream. Open the dream journal." : `She has ${unreadDreams.length} unread dreams. Open the dream journal.`}
        >
          She dreamed
        </Link>
      )}
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
