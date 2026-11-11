/**
 * Loads a companion's dream journal. Until /api/dreams exists, `available` is
 * false and `unavailable` is true so the page can show "not available yet."
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DreamJournalError,
  type DreamJournalEntry,
  type DreamJournalPage,
  fetchDreamJournal,
  isDreamJournalUnavailable,
  markDreamRead,
  markDreamsReadLocally,
  updateDreamJournalSettings,
} from "@/lib/dreamJournal";

export function useDreamJournal(characterId: string | null | undefined, opts: { limit?: number } = {}) {
  const [dreams, setDreams] = useState<DreamJournalEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [dreamingEnabled, setDreamingEnabled] = useState<boolean | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isDreaming, setIsDreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<DreamJournalError | null>(null);
  const gen = useRef(0);

  const loadPage = useCallback(
    async (after: string | null, replace: boolean) => {
      if (!characterId) return;
      const mine = ++gen.current;
      setLoading(true);
      setError(null);
      try {
        const page: DreamJournalPage = await fetchDreamJournal(characterId, { limit: opts.limit, cursor: after });
        if (mine !== gen.current) return;
        setDreams((prev) => (replace ? page.dreams : [...prev, ...page.dreams]));
        setCursor(page.next_cursor);
        setDreamingEnabled(page.dreaming_enabled);
        setUnreadCount(page.unread_count);
        setIsDreaming(Boolean(page.is_dreaming));
        if (replace) {
          markDreamsReadLocally(
            characterId,
            page.dreams.map((d) => d.id),
          );
        }
      } catch (err) {
        if (mine !== gen.current) return;
        setError(err instanceof DreamJournalError ? err : new DreamJournalError("network_error", 0));
        if (replace) {
          setDreams([]);
          setCursor(null);
        }
      } finally {
        if (mine === gen.current) setLoading(false);
      }
    },
    [characterId, opts.limit],
  );

  useEffect(() => {
    setDreams([]);
    setCursor(null);
    setDreamingEnabled(null);
    setUnreadCount(0);
    setIsDreaming(false);
    setError(null);
    if (characterId) void loadPage(null, true);
    return () => {
      gen.current += 1;
    };
  }, [characterId, loadPage]);

  const loadMore = useCallback(() => {
    if (cursor && !loading) void loadPage(cursor, false);
  }, [cursor, loading, loadPage]);

  const refresh = useCallback(() => loadPage(null, true), [loadPage]);

  const setLetHerDream = useCallback(
    async (enabled: boolean) => {
      if (!characterId) return;
      const previous = dreamingEnabled;
      setDreamingEnabled(enabled);
      setSaving(true);
      try {
        const saved = await updateDreamJournalSettings(characterId, enabled);
        setDreamingEnabled(saved.dreaming_enabled);
        setError(null);
      } catch (err) {
        setDreamingEnabled(previous);
        setError(err instanceof DreamJournalError ? err : new DreamJournalError("network_error", 0));
      } finally {
        setSaving(false);
      }
    },
    [characterId, dreamingEnabled],
  );

  const rememberRead = useCallback(
    async (dreamId: string) => {
      if (!characterId || !dreamId) return;
      markDreamsReadLocally(characterId, [dreamId]);
      setDreams((prev) => prev.map((d) => (d.id === dreamId ? { ...d, read: true } : d)));
      try {
        const result = await markDreamRead(characterId, dreamId);
        if (typeof result.unread_count === "number") setUnreadCount(result.unread_count);
        else setUnreadCount((n) => Math.max(0, n - 1));
      } catch {
        // Local ledger still hides the presence hint; the server mark is best-effort.
      }
    },
    [characterId],
  );

  const unavailable = isDreamJournalUnavailable(error);

  return {
    dreams,
    hasMore: Boolean(cursor),
    dreamingEnabled,
    unreadCount,
    isDreaming,
    loading,
    saving,
    error,
    unavailable,
    available: !unavailable && error == null && Boolean(characterId) && !loading ? true : !unavailable && error == null && dreams.length > 0,
    loadMore,
    refresh,
    setLetHerDream,
    rememberRead,
  };
}
