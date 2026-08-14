// Story-progress tracking that's useful on its own — data worth having
// even if the writer steps away for a month and comes back cold.

import { useCallback, useEffect, useState } from 'react';
import { StorySnapshot } from '../types/belonging';

const STORAGE_KEY = 'anima.storySnapshots';

function load(): StorySnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(snapshots: StorySnapshot[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
}

export function useStoryProgress() {
  const [snapshots, setSnapshots] = useState<StorySnapshot[]>([]);

  useEffect(() => {
    setSnapshots(load());
  }, []);

  const recordSnapshot = useCallback(
    (snapshot: Omit<StorySnapshot, 'id' | 'timestamp'>) => {
      const next: StorySnapshot = {
        ...snapshot,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };
      setSnapshots(prev => {
        const updated = [...prev, next];
        save(updated);
        return updated;
      });
      return next;
    },
    []
  );

  const wordCountTrend = useCallback(
    (days = 30) => {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      return snapshots
        .filter(s => new Date(s.timestamp).getTime() >= cutoff)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    },
    [snapshots]
  );

  const recurringThemes = useCallback(
    (minOccurrences = 2) => {
      const counts = new Map<string, number>();
      for (const s of snapshots) {
        for (const theme of s.themesDetected) {
          counts.set(theme, (counts.get(theme) ?? 0) + 1);
        }
      }
      return [...counts.entries()]
        .filter(([, count]) => count >= minOccurrences)
        .sort((a, b) => b[1] - a[1])
        .map(([theme]) => theme);
    },
    [snapshots]
  );

  /** Most-recent snapshot per scene — a lightweight "left open" signal,
   *  useful for feeding the memory-resurfacing feature. */
  const openScenes = useCallback(() => {
    const byScene = new Map<string, StorySnapshot>();
    for (const s of snapshots) {
      const existing = byScene.get(s.chapterOrScene);
      if (!existing || new Date(s.timestamp) > new Date(existing.timestamp)) {
        byScene.set(s.chapterOrScene, s);
      }
    }
    return [...byScene.values()].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [snapshots]);

  return { snapshots, recordSnapshot, wordCountTrend, recurringThemes, openScenes };
}
