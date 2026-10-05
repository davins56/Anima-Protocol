import { AI_COMPANION_NOTICE_TEXT, CRISIS_RESOURCE_CARD_TEXT } from "@/lib/aiCompanionNotice";

/**
 * Full-width system row. Not a character bubble: no avatar, no speaker name.
 * Type is at least 16px so the line stays readable on iPhone and iPad widths.
 */
export default function SystemDisclosure({
  text,
  tone = "info",
  testId,
}) {
  const crisis = tone === "crisis";
  const body = text || (crisis ? CRISIS_RESOURCE_CARD_TEXT : AI_COMPANION_NOTICE_TEXT);
  return (
    <div
      role={crisis ? "alert" : "note"}
      data-testid={testId || (crisis ? "crisis-resource-card" : "ai-companion-notice")}
      className={`w-full max-w-none my-2 px-3 py-3 sm:px-4 sm:py-3.5 border text-base leading-relaxed break-words ${
        crisis
          ? "border-rose-300/80 bg-rose-950/80 text-rose-50"
          : "border-cyan-300/70 bg-cyan-950/80 text-cyan-50"
      }`}
    >
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-current/80">
        {crisis ? "Crisis support" : "System"}
      </p>
      <p className="text-base leading-relaxed">{body}</p>
    </div>
  );
}
