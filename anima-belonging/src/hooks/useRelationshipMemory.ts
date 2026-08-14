// React Query hooks over relationshipApi.ts. Uses @tanstack/react-query
// since it's already in your pnpm-workspace catalog — assumes a
// QueryClientProvider is already set up somewhere above these components
// in the tree (standard for apps already using react-query).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  crystallizeResonanceMemory,
  getJournalEntries,
  getResonanceMemories,
  getTimelineEvents,
  markJournalRead,
  openRelationshipChapter,
  writeJournalEntry,
} from '../lib/relationshipApi';
import type { JournalEntryType, ResonanceVector, TimelineEventType } from '../types/relationship';

// ---------- Journal ----------

export function useJournalEntries(
  animaId: string,
  opts?: { limit?: number; unreadOnly?: boolean }
) {
  return useQuery({
    queryKey: ['journal', animaId, opts],
    queryFn: () => getJournalEntries(animaId, opts),
    enabled: Boolean(animaId),
    select: data => data.entries,
  });
}

export function useWriteJournalEntry(animaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      title: string;
      content: string;
      entryType?: JournalEntryType;
      metadata?: Record<string, unknown>;
    }) => writeJournalEntry(animaId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal', animaId] });
    },
  });
}

export function useMarkJournalRead(animaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => markJournalRead(animaId, entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal', animaId] });
    },
  });
}

// ---------- Resonance memories ----------

export function useResonanceMemories(animaId: string, opts?: { limit?: number }) {
  return useQuery({
    queryKey: ['resonanceMemories', animaId, opts],
    queryFn: () => getResonanceMemories(animaId, opts),
    enabled: Boolean(animaId),
    select: data => data.memories,
  });
}

export function useCrystallizeMemory(animaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      title: string;
      body: string;
      resonanceSnapshot: ResonanceVector;
      emotionalTone?: string;
      tags?: string[];
      intensity?: number;
    }) => crystallizeResonanceMemory(animaId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resonanceMemories', animaId] });
    },
  });
}

// ---------- Timeline ----------

export function useTimelineEvents(
  animaId: string,
  opts?: { limit?: number; eventType?: TimelineEventType }
) {
  return useQuery({
    queryKey: ['timeline', animaId, opts],
    queryFn: () => getTimelineEvents(animaId, opts),
    enabled: Boolean(animaId),
    select: data => data.events,
  });
}

export function useOpenChapter(animaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; summary?: string; chapterIndex?: number }) =>
      openRelationshipChapter(animaId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline', animaId] });
    },
  });
}

// ---------- Resurfacing ----------

/**
 * "Picking back up" candidates for MemoryResurfacing, built entirely from
 * data the backend already tracks (unread journal entries, latest timeline
 * event) rather than an invented "open thread" concept.
 */
export function useResurfaceCandidates(animaId: string) {
  const unreadJournal = useJournalEntries(animaId, { limit: 3, unreadOnly: true });
  const recentTimeline = useTimelineEvents(animaId, { limit: 1 });

  return {
    unreadJournalEntries: unreadJournal.data ?? [],
    latestTimelineEvent: recentTimeline.data?.[0] ?? null,
    isLoading: unreadJournal.isLoading || recentTimeline.isLoading,
  };
}
