// Journaling UI wired to the real backend (POST /journal/:animaId etc.)
// instead of localStorage. The prompt is offered, never required — an
// entry saves identically with or without one.

import { useState } from 'react';
import { useJournalEntries, useWriteJournalEntry } from '../hooks/useRelationshipMemory';
import { ShareExport } from './ShareExport';
import type { JournalEntryType } from '../types/relationship';

interface JournalPromptProps {
  animaId: string;
  /** Defaults to 'reflection' server-side if omitted. */
  entryType?: JournalEntryType;
}

const REFLECTION_PROMPTS = [
  'What did they do today that surprised you?',
  "Describe one small moment from today in physical detail — no interpretation, just what happened.",
  "Is there a pattern from the last few entries you're starting to see?",
  "Write about today without worrying whether it's interesting.",
];

export function JournalPrompt({ animaId, entryType }: JournalPromptProps) {
  const { data: entries = [] } = useJournalEntries(animaId, { limit: 20 });
  const writeEntry = useWriteJournalEntry(animaId);

  const [draft, setDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [activePrompt, setActivePrompt] = useState<string | null>(null);

  const handleNewPrompt = () => {
    setActivePrompt(REFLECTION_PROMPTS[Math.floor(Math.random() * REFLECTION_PROMPTS.length)]);
  };

  const handleSave = () => {
    if (!draft.trim()) return;
    writeEntry.mutate({
      title: titleDraft.trim() || draft.slice(0, 48),
      content: draft.trim(),
      entryType,
      metadata: activePrompt ? { promptUsed: activePrompt } : undefined,
    });
    setDraft('');
    setTitleDraft('');
    setActivePrompt(null);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            New entry
          </span>
          <button
            onClick={handleNewPrompt}
            className="text-xs font-medium text-violet-600 hover:text-violet-800 dark:text-violet-400"
          >
            Suggest a prompt
          </button>
        </div>

        {activePrompt && (
          <p className="mt-2 text-sm italic text-neutral-500 dark:text-neutral-400">
            {activePrompt}
          </p>
        )}

        <input
          value={titleDraft}
          onChange={e => setTitleDraft(e.target.value)}
          placeholder="Title (optional)"
          className="mt-3 w-full rounded-lg border border-neutral-200 p-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />

        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={5}
          placeholder="Write..."
          className="mt-2 w-full rounded-lg border border-neutral-200 p-3 text-sm text-neutral-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />

        <div className="mt-3 flex justify-end">
          <button
            onClick={handleSave}
            disabled={!draft.trim() || writeEntry.isPending}
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {writeEntry.isPending ? 'Saving…' : 'Save entry'}
          </button>
        </div>
      </div>

      <ul className="space-y-3">
        {entries.map(entry => (
          <li
            key={entry.id}
            className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
          >
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
              {!entry.isRead && <span className="text-violet-500">Unread</span>}
            </div>
            <p className="mt-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {entry.title}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">
              {entry.content}
            </p>
            <div className="mt-3">
              <ShareExport title={entry.title} content={entry.content} kind="journal-entry" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
