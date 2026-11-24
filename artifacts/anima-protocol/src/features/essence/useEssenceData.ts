/**
 * Read-only data the Essence screens can already show from shipped routes:
 * the dream journal (GET /api/dreams/:id, docs/dream-journal-frontend-contract.md)
 * and memory health (GET /api/memory-core/:id/health). Unlike useDreamJournal,
 * this never marks dreams read, so opening Essence leaves the journal's unread
 * hint alone.
 */
import { useEffect, useState } from "react";
import { animaClient } from "@/api/animaClient";
import { useMemoryHealth } from "@/hooks/useMemoryHealth";
import { DreamJournalError, fetchDreamJournal, isDreamJournalUnavailable, type DreamJournalEntry } from "@/lib/dreamJournal";

export type Companion = { id: string; name?: string; avatar_url?: string | null };

export function useEssenceCompanions() {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const entities = animaClient.entities as Record<string, { list?: (...a: unknown[]) => Promise<unknown[]> } | undefined>;
    Promise.all([
      entities.Anima?.list?.().catch(() => []) ?? Promise.resolve([]),
      entities.Character?.list?.("-updated_date", 50).catch(() => []) ?? Promise.resolve([]),
    ])
      .then(([animas, characters]) => {
        if (!alive) return;
        const seen = new Set<string>();
        const list: Companion[] = [];
        for (const raw of [...((animas as unknown[]) || []), ...((characters as unknown[]) || [])]) {
          const item = raw as { id?: string; name?: string; avatar_url?: string | null } | null;
          if (!item?.id || seen.has(item.id)) continue;
          seen.add(item.id);
          list.push({ id: item.id, name: item.name, avatar_url: item.avatar_url ?? null });
        }
        setCompanions(list);
      })
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return { companions, ready };
}

export type DreamsState =
  | { status: "loading"; dreams: DreamJournalEntry[]; hasMore: false }
  | { status: "ready"; dreams: DreamJournalEntry[]; hasMore: boolean }
  | { status: "pending" | "error"; dreams: DreamJournalEntry[]; hasMore: false };

export function useEssenceDreams(characterId: string | null): DreamsState {
  const [state, setState] = useState<DreamsState>({ status: "loading", dreams: [], hasMore: false });
  useEffect(() => {
    if (!characterId) return;
    const ctrl = new AbortController();
    setState({ status: "loading", dreams: [], hasMore: false });
    fetchDreamJournal(characterId, { limit: 50, signal: ctrl.signal })
      .then((page) => setState({ status: "ready", dreams: page.dreams, hasMore: Boolean(page.next_cursor) }))
      .catch((err) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        const pending = isDreamJournalUnavailable(err) || (err instanceof DreamJournalError && err.code === "companion_not_found");
        setState({ status: pending ? "pending" : "error", dreams: [], hasMore: false });
      });
    return () => ctrl.abort();
  }, [characterId]);
  return state;
}

export { useMemoryHealth };
