import { useState } from "react";
import { ChevronLeft, ChevronRight, GitBranch } from "lucide-react";
import MessageMarkdown from "./MessageMarkdown";

/**
 * Chat upgrade 2 (VITE_ANIMA_REPLY_SIBLINGS): "‹ 2 / 3 ›" under the first
 * reply to a user line that has earlier replies. The live reply is always the
 * last position. Paging back shows an earlier version read-only; "Use this
 * version" makes it live again and keeps the current one as a sibling.
 */
export default function ReplySiblingPager({ pager, onSwitch, disabled = false, companionName = "" }) {
  const total = pager?.total || 0;
  const [position, setPosition] = useState(total);
  const [busy, setBusy] = useState(false);
  if (!pager || total < 2) return null;
  const at = Math.min(Math.max(position, 1), total);
  const viewing = at < total ? pager.siblings[at - 1] : null;
  const who = companionName || "her";

  const use = async () => {
    if (!viewing || !onSwitch || disabled || busy) return;
    setBusy(true);
    try {
      const result = await onSwitch(pager.parentIndex, viewing.key);
      if (result?.ok !== false) setPosition(total);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ml-10 sm:ml-12 mb-2 max-w-[85%]" data-testid="reply-sibling-pager">
      <div className="flex items-center gap-1 font-mono text-[10px] tracking-widest uppercase text-primary/60">
        <GitBranch className="w-3 h-3" aria-hidden="true" />
        <button
          type="button"
          onClick={() => setPosition(at - 1)}
          disabled={at <= 1}
          aria-label="Earlier version of this reply"
          className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] disabled:opacity-30"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span aria-live="polite" data-testid="reply-sibling-position">
          {at} / {total}
        </span>
        <button
          type="button"
          onClick={() => setPosition(at + 1)}
          disabled={at >= total}
          aria-label="Later version of this reply"
          className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] disabled:opacity-30"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        {at === total && <span className="ml-1 normal-case tracking-normal text-primary/40">current reply</span>}
      </div>
      {viewing && (
        <div
          className="mt-1 border border-primary/20 bg-black/40 p-3 text-sm text-primary/80"
          data-testid="reply-sibling-preview"
        >
          <p className="mb-2 font-mono text-[9px] tracking-widest uppercase text-primary/40">
            Earlier version · read only
          </p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {viewing.messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right text-primary/60" : ""}>
                <span className="block font-mono text-[9px] tracking-widest uppercase text-primary/40">
                  {m.role === "user" ? "You" : m.character_name || who}
                </span>
                <MessageMarkdown content={String(m.content || "")} />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={use}
            disabled={disabled || busy}
            data-testid="reply-sibling-use"
            className="mt-2 inline-flex items-center justify-center min-h-[40px] px-3 border border-cyan-400/40 text-cyan-200/90 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
          >
            Use this version
          </button>
          <p className="mt-1 text-[11px] text-primary/40">
            The current reply{viewing.messages.length > 1 ? " and what followed it" : ""} stays here as another version.
          </p>
        </div>
      )}
    </div>
  );
}
