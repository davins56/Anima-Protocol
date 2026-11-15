/**
 * Confirmation card for an anima→bot message. Nothing leaves the app until
 * the user taps Send; the card shows the exact text that would go out. There
 * is no tools-guardrails confirm UI on main yet, so this is standalone and
 * talks to /api/bridge/drafts/:id/decision (503 until the backend exists).
 */
import { useState } from "react";
import { Send, X } from "lucide-react";
import { decideBotDraft, type BotDraft } from "@/lib/botBridge";

type Decide = typeof decideBotDraft;

export default function BotDraftConfirmCard({
  draft,
  decide = decideBotDraft,
  nowMs = Date.now(),
}: {
  draft: BotDraft;
  decide?: Decide;
  nowMs?: number;
}) {
  const [state, setState] = useState<"pending" | "busy" | "sent" | "cancelled">("pending");
  const [error, setError] = useState("");
  const expired = Date.parse(draft.expiresAt) <= nowMs;

  const run = async (decision: "send" | "cancel") => {
    setState("busy");
    setError("");
    const res = await decide(draft.actionId, decision);
    if (res.ok) {
      setState(decision === "send" ? "sent" : "cancelled");
      return;
    }
    setState("pending");
    setError("message" in res ? res.message : "Something went wrong.");
  };

  return (
    <div
      role="group"
      aria-label={`Message from ${draft.companionName} to ${draft.botName} waiting for your OK`}
      data-testid="bot-draft-confirm"
      className="border border-amber-400/40 bg-card p-3 space-y-2 max-w-md"
    >
      <p className="font-mono text-[10px] text-primary/70">
        {draft.companionName} wants to send this to <strong>{draft.botName}</strong>. Nothing is sent unless you tap Send.
      </p>
      <p
        data-testid="bot-draft-text"
        className="whitespace-pre-wrap break-words border border-primary/15 bg-background/40 p-2 font-mono text-[11px] text-primary/85"
      >
        {draft.text}
      </p>
      {error && <p className="text-[9px] font-mono text-destructive/80">{error}</p>}
      {state === "sent" && <p className="text-[9px] font-mono text-primary/60">Sent.</p>}
      {state === "cancelled" && <p className="text-[9px] font-mono text-primary/60">Cancelled. Nothing was sent.</p>}
      {expired && state === "pending" && (
        <p className="text-[9px] font-mono text-primary/45">This request expired. Nothing was sent.</p>
      )}
      {(state === "pending" || state === "busy") && !expired && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={state === "busy"}
            onClick={() => void run("send")}
            className="min-h-[44px] px-3 border border-primary/40 text-primary font-mono text-[10px] tracking-widest uppercase flex items-center gap-1.5 disabled:opacity-40"
          >
            <Send className="w-3 h-3" aria-hidden="true" />
            Send
          </button>
          <button
            type="button"
            disabled={state === "busy"}
            onClick={() => void run("cancel")}
            className="min-h-[44px] px-3 border border-primary/20 text-primary/70 font-mono text-[10px] tracking-widest uppercase flex items-center gap-1.5 disabled:opacity-40"
          >
            <X className="w-3 h-3" aria-hidden="true" />
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
