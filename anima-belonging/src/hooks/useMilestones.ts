// Milestones tied to the user's own output or self-set goals — never to
// app usage. No login streaks, no "day 7 of using Anima" badges.

import { useCallback, useEffect, useState } from 'react';
import { Milestone, StorySnapshot } from '../types/belonging';

const STORAGE_KEY = 'anima.milestones';

function load(): Milestone[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(milestones: Milestone[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(milestones));
}

export function useMilestones() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  useEffect(() => {
    setMilestones(load());
  }, []);

  const persist = useCallback((next: Milestone[]) => {
    setMilestones(next);
    save(next);
  }, []);

  /** For goals the user sets themselves — e.g. "finish Kyaru's arc by fall." */
  const addUserDefinedMilestone = useCallback(
    (label: string, detail: string) => {
      const milestone: Milestone = {
        id: crypto.randomUUID(),
        label,
        detail,
        basis: 'user-defined',
        achievedAt: new Date().toISOString(),
      };
      persist([...load(), milestone]);
      return milestone;
    },
    [persist]
  );

  /** Call after recording a story snapshot. De-duplicates against
   *  already-achieved thresholds via the stable `detail` key. */
  const evaluateOutputMilestones = useCallback(
    (snapshots: StorySnapshot[]) => {
      const existing = load();
      const alreadyHit = new Set(existing.map(m => m.detail));
      const newOnes: Milestone[] = [];

      const totalWords = snapshots.reduce((sum, s) => sum + s.wordCount, 0);
      for (const threshold of [1000, 5000, 10000, 25000, 50000, 100000]) {
        const key = `total-words-${threshold}`;
        if (totalWords >= threshold && !alreadyHit.has(key)) {
          newOnes.push({
            id: crypto.randomUUID(),
            label: `${threshold.toLocaleString()} words written`,
            detail: key,
            basis: 'user-output',
            achievedAt: new Date().toISOString(),
          });
        }
      }

      const distinctScenes = new Set(snapshots.map(s => s.chapterOrScene)).size;
      for (const threshold of [1, 5, 10, 25]) {
        const key = `scenes-touched-${threshold}`;
        if (distinctScenes >= threshold && !alreadyHit.has(key)) {
          newOnes.push({
            id: crypto.randomUUID(),
            label: `${threshold} scene${threshold > 1 ? 's' : ''} in progress or complete`,
            detail: key,
            basis: 'user-output',
            achievedAt: new Date().toISOString(),
          });
        }
      }

      if (newOnes.length > 0) {
        persist([...existing, ...newOnes]);
      }
      return newOnes;
    },
    [persist]
  );

  return { milestones, addUserDefinedMilestone, evaluateOutputMilestones };
}
