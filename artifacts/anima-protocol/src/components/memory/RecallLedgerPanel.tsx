/**
 * "Why she said that" ledger — recall moments a companion considered,
 * grouped the way the API groups them (session + recalled_at). Never
 * labeled as "turns".
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { RecallLedgerError, useRecallLedger } from "@/hooks/useRecallLedger";
import {
  CANDIDATE_DISCLAIMER,
  errorMessage,
  formatHappenedAgo,
  formatRecallScores,
  formatRecalledAt,
  memoryTypeLabel,
  recallForgetPath,
  turnLinkageNote,
  withheldNote,
} from "@/lib/recallLedgerDisplay";

export default function RecallLedgerPanel({
  characterId,
  characterName,
  sessionId,
  returnTo,
}: {
  characterId: string;
  characterName?: string;
  sessionId?: string | null;
  returnTo?: string | null;
}) {
  const [onlyThisSession, setOnlyThisSession] = useState(false);
  const filterSession = onlyThisSession && sessionId ? sessionId : null;
  const { batches, hasMore, loading, error, loadMore, refresh, meta } = useRecallLedger(characterId, {
    sessionId: filterSession,
    limit: 10,
  });

  const empty = !loading && !error && batches.length === 0;
  const headingError = error && batches.length === 0;
  const linkage = turnLinkageNote(meta?.turn_linkage);
  const back = returnTo || (sessionId ? `/chat/${sessionId}` : "/chat");

  return (
    <section data-testid="recall-ledger" aria-labelledby="recall-ledger-heading" className="space-y-2.5">
      <div className="space-y-1">
        <h3 id="recall-ledger-heading" className="text-primary tracking-widest uppercase text-[9px]">
          Why she said that
        </h3>
        <p className="text-[10px] leading-relaxed text-primary/55">{CANDIDATE_DISCLAIMER}</p>
        {linkage && <p className="text-[10px] leading-relaxed text-primary/45">{linkage}</p>}
      </div>

      {sessionId ? (
        <label className="flex items-center gap-2 text-[10px] text-primary/70 cursor-pointer">
          <input
            type="checkbox"
            className="accent-primary"
            checked={onlyThisSession}
            onChange={(event) => setOnlyThisSession(event.target.checked)}
            data-testid="recall-ledger-session-filter"
          />
          This conversation only
        </label>
      ) : null}

      {loading && batches.length === 0 && (
        <p role="status" aria-live="polite" aria-busy="true" data-testid="recall-ledger-loading" className="text-[10px] text-primary/50">
          Looking up what she recalled…
        </p>
      )}

      {headingError && (
        <div className="space-y-2" data-testid="recall-ledger-error">
          <p role="alert" className="text-[10px] leading-relaxed text-rose-200/90">
            {errorMessage(error instanceof RecallLedgerError ? error.code : undefined)}
          </p>
          <button
            type="button"
            onClick={() => refresh()}
            className="min-h-11 px-3 text-[10px] tracking-widest uppercase border border-primary/30 text-primary/80 touch-manipulation"
          >
            Try again
          </button>
        </div>
      )}

      {empty && (
        <p data-testid="recall-ledger-empty" className="text-[10px] leading-relaxed text-primary/60">
          {onlyThisSession
            ? "She has not recalled any long-term memories in this conversation yet."
            : "She has not recalled any long-term memories in a recorded moment yet."}
        </p>
      )}

      {batches.length > 0 && (
        <ol className="space-y-3" data-testid="recall-ledger-list">
          {batches.map((batch) => {
            const quiet = withheldNote(batch.withheld);
            const momentLabel = `Recall moment, ${formatRecalledAt(batch.recalled_at)}`;
            return (
              <li key={batch.batch_id} className="space-y-1.5 border border-primary/15 p-2">
                <header>
                  <h4 className="text-primary/80 tracking-widest uppercase text-[8px] sm:text-[9px]">{momentLabel}</h4>
                </header>
                <ul className="space-y-2">
                  {batch.recalls.map((entry) => {
                    const forgetTo = recallForgetPath({
                      characterId,
                      companionName: characterName,
                      returnTo: back,
                      eventId: entry.memory.event_id,
                      preview: entry.memory.content_preview,
                    });
                    return (
                      <li
                        key={entry.recall_id}
                        data-testid="recall-ledger-entry"
                        data-event-id={entry.memory.event_id}
                        className="space-y-1"
                      >
                        <p className="text-[11px] leading-relaxed text-primary/85 whitespace-pre-wrap">
                          {entry.memory.content_preview || "(no preview)"}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-primary/55">
                          <span>{memoryTypeLabel(entry.memory.event_type)}</span>
                          <span aria-hidden="true">·</span>
                          <span>Happened {formatHappenedAgo(entry.memory.occurred_at, entry.memory_age_s)}</span>
                          {entry.memory.corrupted && (
                            <span
                              data-testid="recall-corrupted-badge"
                              className="inline-flex items-center rounded-full border border-amber-300/40 px-1.5 py-0.5 text-amber-100 uppercase tracking-widest"
                            >
                              Corrupted
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-primary/45">{formatRecallScores(entry)}</p>
                        {entry.memory.source_turn_id && (
                          <p className="text-[9px] text-primary/35">
                            From the conversation that created this memory, not the reply it was recalled for.
                          </p>
                        )}
                        <Link
                          to={forgetTo}
                          className="inline-flex items-center min-h-11 px-2 -ml-2 text-[10px] text-rose-100/90 underline-offset-2 hover:underline touch-manipulation"
                        >
                          Forget this
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {quiet && <p className="text-[9px] text-primary/35">{quiet}</p>}
              </li>
            );
          })}
        </ol>
      )}

      {error && batches.length > 0 && (
        <p role="alert" className="text-[10px] text-rose-200/90">
          {errorMessage(error instanceof RecallLedgerError ? error.code : undefined)}
        </p>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => loadMore()}
          disabled={loading}
          data-testid="recall-ledger-load-more"
          className="min-h-11 w-full px-3 text-[10px] tracking-widest uppercase border border-primary/30 text-primary/80 touch-manipulation disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load earlier moments"}
        </button>
      )}
    </section>
  );
}
