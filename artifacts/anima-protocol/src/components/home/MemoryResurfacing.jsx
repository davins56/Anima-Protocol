import { useEffect, useState } from "react";
import { getJournalEntries, getTimelineEvents, markJournalRead } from "@/features/belonging/relationshipApi";
import { pickResurfacing } from "@/features/belonging/belonging";

/**
 * "Picking back up" card on Home (anima-belonging MemoryResurfacing, ported
 * without react-query). Built from unread journal entries + the latest
 * chapter/milestone. Dismissible; no absence copy; fails silently.
 */
export default function MemoryResurfacing({ animaId, allowed = true, onOpenJournal, api }) {
  const client = api || { getJournalEntries, getTimelineEvents, markJournalRead };
  const [state, setState] = useState(/** @type {{ unread: any[], latest: any } | null} */ (null));
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!animaId || !allowed) return undefined;
    let live = true;
    Promise.all([
      client.getJournalEntries(animaId, { limit: 5, unreadOnly: true }).catch(() => []),
      client.getTimelineEvents(animaId, { limit: 10 }).catch(() => []),
    ]).then(([entries, events]) => {
      if (live) setState(pickResurfacing({ entries, events }));
    });
    return () => {
      live = false;
    };
    // client is stable per render tree; animaId/allowed drive reloads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animaId, allowed]);

  if (!allowed || dismissed || !state) return null;
  if (!state.unread.length && !state.latest) return null;

  return (
    <section data-testid="memory-resurfacing" className="border border-violet-400/25 bg-violet-950/20 px-3 py-2 mb-2">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-violet-300/80">Picking back up</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="font-mono text-[9px] text-violet-300/60 hover:text-violet-200"
        >
          Not now
        </button>
      </div>
      {state.latest && (
        <p className="mt-1 text-[12px] text-violet-100/80">
          Last chapter: <span className="font-medium">{state.latest.title}</span>
        </p>
      )}
      {state.unread.length > 0 && (
        <ul className="mt-2 space-y-1">
          {state.unread.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => onOpenJournal?.(entry.id)}
                className="text-left text-[12px] text-violet-100 hover:underline"
              >
                {entry.title}
              </button>
              <button
                type="button"
                onClick={() => {
                  client.markJournalRead(animaId, entry.id).catch(() => {});
                  setState((s) => (s ? { ...s, unread: s.unread.filter((e) => e.id !== entry.id) } : s));
                }}
                className="shrink-0 font-mono text-[9px] text-violet-300/60 hover:text-violet-200"
              >
                Mark read
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
