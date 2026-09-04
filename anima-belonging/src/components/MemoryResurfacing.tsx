// Surfaces a "picking back up" prompt on return, built from data the
// backend already tracks — unread journal entries and the latest timeline
// event — rather than a separate frontend-only concept. Phrased around
// what's there, never around how long the user's been away. Dismissible,
// no penalty for dismissing.

import { useState } from 'react';
import { useResurfaceCandidates, useMarkJournalRead } from '../hooks/useRelationshipMemory';

interface MemoryResurfacingProps {
  animaId: string;
  allowResurfacing: boolean; // wire to UserPreferences.allowMemoryResurfacing
  onSelectEntry?: (entryId: string) => void;
}

export function MemoryResurfacing({
  animaId,
  allowResurfacing,
  onSelectEntry,
}: MemoryResurfacingProps) {
  const [dismissed, setDismissed] = useState(false);
  const { unreadJournalEntries, latestTimelineEvent, isLoading } = useResurfaceCandidates(
    allowResurfacing ? animaId : ''
  );
  const markRead = useMarkJournalRead(animaId);

  if (!allowResurfacing || dismissed || isLoading) return null;
  if (unreadJournalEntries.length === 0 && !latestTimelineEvent) return null;

  return (
    <div className="rounded-xl border border-violet-200/60 bg-violet-50/60 p-4 dark:border-violet-500/20 dark:bg-violet-500/10">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-violet-900 dark:text-violet-200">
          Picking back up
        </p>
        <button
          onClick={() => setDismissed(true)}
          className="text-xs text-violet-500 hover:text-violet-700 dark:text-violet-400"
          aria-label="Dismiss"
        >
          Not now
        </button>
      </div>

      {latestTimelineEvent && (
        <p className="mt-2 text-sm text-violet-700 dark:text-violet-300">
          Last chapter: <span className="font-medium">{latestTimelineEvent.title}</span>
        </p>
      )}

      {unreadJournalEntries.length > 0 && (
        <ul className="mt-3 space-y-2">
          {unreadJournalEntries.map(entry => (
            <li key={entry.id} className="flex items-start justify-between gap-3">
              <button
                onClick={() => onSelectEntry?.(entry.id)}
                className="text-left text-sm text-violet-800 hover:underline dark:text-violet-100"
              >
                {entry.title}
              </button>
              <button
                onClick={() => markRead.mutate(entry.id)}
                className="shrink-0 text-xs text-violet-500 hover:text-violet-700 dark:text-violet-400"
              >
                Mark read
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
