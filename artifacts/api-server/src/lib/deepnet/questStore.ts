/**
 * Quest-state adapter.
 *
 * STUB: the durable store is migration U2 (`deepnet_quest_events`), which needs
 * Dàvīn's OK and is NOT applied. Until then state lives IN MEMORY in the
 * running isolate/process: it is lost on restart and not shared between Worker
 * isolates. That is acceptable only because the feature is off by default and
 * limited to one allowlisted user. Nothing here touches the database.
 *
 * Keys are (userId, characterId, questId): one character never sees another's
 * state (per-character isolation), and one user never sees another's.
 */
import type { QuestEvent } from "@workspace/deepnet-core";

export interface DeepnetQuestStore {
  load(userId: string, characterId: string, questId: string): Promise<QuestEvent[]>;
  /** Appends iff the stored log has exactly `expectedSeq` events; false on a race. */
  append(userId: string, characterId: string, questId: string, expectedSeq: number, event: QuestEvent): Promise<boolean>;
}

const MAX_KEYS = 2_000;

export function inMemoryQuestStore(): DeepnetQuestStore & { size(): number; clear(): void } {
  const logs = new Map<string, QuestEvent[]>();
  const key = (u: string, c: string, q: string) => JSON.stringify([u, c, q]);
  return {
    async load(u, c, q) {
      return [...(logs.get(key(u, c, q)) ?? [])];
    },
    async append(u, c, q, expectedSeq, event) {
      const k = key(u, c, q);
      const cur = logs.get(k) ?? [];
      if (cur.length !== expectedSeq || event.seq !== expectedSeq + 1) return false;
      if (!logs.has(k) && logs.size >= MAX_KEYS) {
        const oldest = logs.keys().next().value;
        if (oldest !== undefined) logs.delete(oldest);
      }
      logs.set(k, [...cur, Object.freeze({ ...event }) as QuestEvent]);
      return true;
    },
    size: () => logs.size,
    clear: () => logs.clear(),
  };
}

export const defaultQuestStore = inMemoryQuestStore();
