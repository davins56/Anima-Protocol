/**
 * Access log adapter. The durable, append-only table is migration U1
 * (`deepnet_access_log`), which needs Dàvīn's OK and is NOT applied. Until then
 * the default adapter writes one structured app-log line per entry (no SQL,
 * no migration). Entries never carry message content or secrets.
 */
import { logger } from "../logger";

export type DeepnetAccessAction = "enter" | "denied";

export type DeepnetAccessEntry = {
  userId: string | null;
  characterId: string | null;
  action: DeepnetAccessAction;
  reason: string;
  nodeId?: string | null;
  route: string;
  at: string;
};

export interface DeepnetAccessLog {
  record(entry: DeepnetAccessEntry): void;
}

/** Default: structured app log (stub until U1). */
export const appLogAccessLog: DeepnetAccessLog = {
  record(entry) {
    logger.info({ deepnet_access: entry }, "deepnet access");
  },
};

/** For tests: keeps entries in memory. */
export function memoryAccessLog(): DeepnetAccessLog & { entries: DeepnetAccessEntry[] } {
  const entries: DeepnetAccessEntry[] = [];
  return { entries, record: (e) => void entries.push(Object.freeze({ ...e })) };
}
