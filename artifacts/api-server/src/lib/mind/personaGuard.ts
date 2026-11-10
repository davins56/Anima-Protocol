/**
 * Persona guard for hosted replies: stream-safe cleanup that keeps the
 * companion in character and keeps prompt scaffolding out of the bubble.
 *
 * - strips a leading speaker label ("Serenity:", "**Serenity**:")
 * - strips chat-template tokens (<|eot_id|>, <|im_end|>, [INST], </s> …)
 * - drops leaked bracketed scaffolding lines ("[System note …]", "(OOC: …)")
 * - stops the reply where the model starts writing the USER's next line
 *   ("User:", "<their name>:") — the classic run-on that breaks immersion
 *
 * <think> blocks are already removed upstream by createVisibleReplyFilter.
 */
import { normalizeText, tokenSet, containment } from "./textSim";

const TEMPLATE_TOKEN_RE =
  /<\|(?:eot_id|end_of_text|begin_of_text|start_header_id|end_header_id|im_start|im_end|endoftext|eom_id)\|>|\[\/?INST\]|<\/?s>|<<\/?SYS>>/gi;
const HEADER_ROLE_RE = /(?:^|\n)\s*(?:system|assistant|user)\s*<\|end_header_id\|>/gi;
const META_LINE_RE =
  /^\s*(?:\[(?:system|note|ooc|instruction|context|memory|scene)[^\]]*\]|\((?:ooc|note|system)\s*:[^)]*\)|(?:system|developer)\s*:)/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type PersonaGuardOptions = {
  companionName?: string | null;
  userName?: string | null;
};

function labelRe(name: string | null | undefined): RegExp | null {
  const n = String(name || "").trim();
  if (!n) return null;
  return new RegExp(`^\\s*(?:\\*\\*|__)?${escapeRe(n)}(?:\\*\\*|__)?\\s*[:：](?:\\*\\*|__)?\\s*`, "i");
}

function userTurnRe(userName: string | null | undefined): RegExp {
  const names = ["user", "human"];
  const u = String(userName || "").trim();
  if (u) names.push(escapeRe(u));
  return new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?(?:${names.join("|")})(?:\\*\\*)?\\s*[:：]`, "i");
}

/** Clean a complete reply (used for the final `done.visible` text). */
export function sanitizeCompanionReply(text: string, opts: PersonaGuardOptions = {}): string {
  let out = String(text || "").replace(HEADER_ROLE_RE, "\n").replace(TEMPLATE_TOKEN_RE, "");
  const stop = out.search(userTurnRe(opts.userName));
  if (stop > 0) out = out.slice(0, stop);
  else if (stop === 0) out = "";
  const label = labelRe(opts.companionName);
  if (label) out = out.replace(label, "");
  out = out
    .split("\n")
    .filter((line) => !META_LINE_RE.test(line))
    .join("\n");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Streaming variant. Holds back a short tail so a label or a "User:" line
 * split across chunks is still caught, then releases text as it is safe.
 */
export function createPersonaStreamGuard(opts: PersonaGuardOptions = {}) {
  const HOLD = 48;
  let raw = "";
  let emitted = 0;
  let stopped = false;
  let headDecided = false;
  const label = labelRe(opts.companionName);
  const userRe = userTurnRe(opts.userName);

  const cleanedSoFar = (final: boolean): string => {
    let text = raw.replace(HEADER_ROLE_RE, "\n").replace(TEMPLATE_TOKEN_RE, "");
    const stop = text.search(userRe);
    if (stop >= 0) {
      text = text.slice(0, stop);
      stopped = true;
    }
    if (label) text = text.replace(label, "");
    const lines = text.split("\n");
    // The last line may still be growing; judge it only at the end.
    const done = final || stopped ? lines : lines.slice(0, -1);
    const tail = final || stopped ? "" : (lines[lines.length - 1] ?? "");
    const kept = done.filter((line) => !META_LINE_RE.test(line));
    const joined = [...kept, ...(final || stopped ? [] : [tail])].join("\n");
    return joined.replace(/^\s+/, "");
  };

  return {
    /** Feed a delta; returns the text that is now safe to show. */
    push(delta: string): string {
      if (stopped || !delta) return "";
      raw += delta;
      if (!headDecided) {
        // Wait until a possible speaker label has fully arrived.
        if (raw.trim().length < Math.min(HOLD, (opts.companionName?.length ?? 0) + 4) && !raw.includes("\n")) return "";
        headDecided = true;
      }
      const clean = cleanedSoFar(false);
      let safeEnd = stopped ? clean.length : Math.max(emitted, clean.length - HOLD);
      if (!stopped) {
        // A growing line that could become scaffolding ("[System …]") is
        // held whole until its newline decides it.
        const tailStart = clean.lastIndexOf("\n") + 1;
        if (/^\s*(?:\[|\((?:ooc|note|system)\b|(?:system|developer)\s*:)/i.test(clean.slice(tailStart))) {
          safeEnd = Math.max(emitted, Math.min(safeEnd, tailStart));
        }
      }
      if (safeEnd <= emitted) return "";
      const out = clean.slice(emitted, safeEnd);
      emitted = safeEnd;
      return out;
    },
    /** Flush whatever is left at the end of the stream. */
    finish(): string {
      const clean = cleanedSoFar(true).replace(/\s+$/, "");
      if (clean.length <= emitted) return "";
      const out = clean.slice(emitted);
      emitted = clean.length;
      return out;
    },
    get stopped(): boolean {
      return stopped;
    },
  };
}

/**
 * Anti-repetition note: the openings of the companion's last few replies,
 * so the model varies how it starts instead of echoing itself.
 */
export function recentOpenings(replies: string[], count = 3, words = 6): string[] {
  const out: string[] = [];
  for (const reply of [...replies].reverse()) {
    const opening = String(reply || "")
      .replace(/^[*_\s"“]+/, "")
      .split(/\s+/)
      .slice(0, words)
      .join(" ")
      .trim();
    if (opening.split(" ").length >= 3 && !out.includes(opening)) out.push(opening);
    if (out.length >= count) break;
  }
  return out;
}

export function antiRepetitionNote(replies: string[]): string {
  const openings = recentOpenings(replies);
  if (!openings.length) return "";
  return (
    "Keep it fresh: do not reuse your recent openings (" +
    openings.map((o) => `"${o}…"`).join(", ") +
    ") or repeat lines you already said; move the conversation forward."
  );
}

/** True when a reply mostly restates one of the recent replies. */
export function echoesRecentReply(reply: string, recent: string[], threshold = 0.75): boolean {
  const r = tokenSet(reply);
  if (r.size < 4) return false;
  return recent.some((p) => normalizeText(p) && containment(r, tokenSet(p)) >= threshold);
}
