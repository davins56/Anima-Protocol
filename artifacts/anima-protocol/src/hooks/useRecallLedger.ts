/**
 * "Why she said that" recall ledger client (docs/recall-ledger.md).
 * GET /api/memory-core/:characterId/recalls — owner-only, read-only, no-store.
 * Responses are validated with zod so a server change can't silently render
 * the wrong thing; a parse failure is reported as `invalid_response`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";

export const RECALL_LEDGER_MAX_LIMIT = 25;

export const RecallLedgerEntrySchema = z.object({
  recall_id: z.string(),
  rank: z.number().int().min(1),
  score: z.number(),
  similarity: z.number().nullable(),
  recency: z.number().nullable(),
  emotional_weight: z.number().min(0).max(1),
  memory_age_s: z.number().min(0),
  memory: z.object({
    event_id: z.string(),
    event_type: z.string(),
    content_preview: z.string(),
    occurred_at: z.string(),
    conversation_id: z.string().nullable(),
    source_turn_id: z.string().nullable(),
    corrupted: z.boolean(),
  }),
});

export const RecallLedgerBatchSchema = z.object({
  batch_id: z.string(),
  recalled_at: z.string(),
  session_id: z.string().nullable(),
  /** Always null today: memory_recalls stores no turn id (see docs/recall-ledger.md). */
  turn_id: z.string().nullable(),
  recalls: z.array(RecallLedgerEntrySchema),
  withheld: z.object({ retracted: z.number().int().min(0), unattributable: z.number().int().min(0) }),
});

export const RecallLedgerPageSchema = z.object({
  character_id: z.string(),
  batches: z.array(RecallLedgerBatchSchema),
  next_cursor: z.string().nullable(),
  meta: z.object({
    limit: z.number().int(),
    max_limit: z.number().int(),
    turn_linkage: z.enum(["none", "turn_id"]),
    grouping: z.string(),
  }),
});

export type RecallLedgerEntry = z.infer<typeof RecallLedgerEntrySchema>;
export type RecallLedgerBatch = z.infer<typeof RecallLedgerBatchSchema>;
export type RecallLedgerPage = z.infer<typeof RecallLedgerPageSchema>;

export type RecallLedgerErrorCode =
  | "unauthorized"
  | "companion_not_found"
  | "invalid_cursor"
  | "invalid_session_id"
  | "memory_schema_missing"
  | "server_error"
  | "invalid_response"
  | "network_error";

export class RecallLedgerError extends Error {
  constructor(public code: RecallLedgerErrorCode, public status: number, message?: string) {
    super(message || code);
  }
}

export function recallLedgerPath(
  characterId: string,
  opts: { limit?: number; cursor?: string | null; sessionId?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(Math.min(RECALL_LEDGER_MAX_LIMIT, Math.max(1, Math.floor(opts.limit)))));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.sessionId) params.set("session_id", opts.sessionId);
  const qs = params.toString();
  return `/memory-core/${encodeURIComponent(characterId)}/recalls${qs ? `?${qs}` : ""}`;
}

export async function fetchRecallLedger(
  characterId: string,
  opts: { limit?: number; cursor?: string | null; sessionId?: string | null; signal?: AbortSignal } = {},
): Promise<RecallLedgerPage> {
  let res: Response;
  try {
    res = await fetch(apiUrl(recallLedgerPath(characterId, opts)), {
      headers: await authHeaders(),
      cache: "no-store",
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") throw err;
    throw new RecallLedgerError("network_error", 0);
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const code = (body as { code?: string } | null)?.code;
    const known: RecallLedgerErrorCode =
      res.status === 401
        ? "unauthorized"
        : code === "companion_not_found" ||
            code === "invalid_cursor" ||
            code === "invalid_session_id" ||
            code === "memory_schema_missing"
          ? code
          : "server_error";
    throw new RecallLedgerError(known, res.status, (body as { error?: string } | null)?.error);
  }
  const parsed = RecallLedgerPageSchema.safeParse(body);
  if (!parsed.success) throw new RecallLedgerError("invalid_response", res.status);
  return parsed.data;
}

/**
 * Pages through a companion's recall ledger. `loadMore()` follows next_cursor;
 * changing characterId/sessionId resets the list. Not cached: the server sends
 * no-store and the list is per-user private data.
 */
export function useRecallLedger(
  characterId: string | null | undefined,
  opts: { limit?: number; sessionId?: string | null } = {},
) {
  const [batches, setBatches] = useState<RecallLedgerBatch[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RecallLedgerError | null>(null);
  const gen = useRef(0);

  const loadPage = useCallback(
    async (after: string | null, replace: boolean) => {
      if (!characterId) return;
      const mine = ++gen.current;
      setLoading(true);
      setError(null);
      try {
        const page = await fetchRecallLedger(characterId, { limit: opts.limit, sessionId: opts.sessionId, cursor: after });
        if (mine !== gen.current) return;
        setBatches((prev) => (replace ? page.batches : [...prev, ...page.batches]));
        setCursor(page.next_cursor);
      } catch (err) {
        if (mine !== gen.current) return;
        setError(err instanceof RecallLedgerError ? err : new RecallLedgerError("network_error", 0));
      } finally {
        if (mine === gen.current) setLoading(false);
      }
    },
    [characterId, opts.limit, opts.sessionId],
  );

  useEffect(() => {
    setBatches([]);
    setCursor(null);
    if (characterId) void loadPage(null, true);
    return () => {
      gen.current += 1;
    };
  }, [characterId, loadPage]);

  const loadMore = useCallback(() => {
    if (cursor && !loading) void loadPage(cursor, false);
  }, [cursor, loading, loadPage]);

  const refresh = useCallback(() => loadPage(null, true), [loadPage]);

  return { batches, hasMore: Boolean(cursor), loading, error, loadMore, refresh };
}
