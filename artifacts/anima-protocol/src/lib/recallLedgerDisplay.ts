/**
 * Display helpers for the "Why she said that" recall ledger.
 * Pure formatting — no fetch, no side effects.
 */
import { whatSheRemembersPath } from "@/lib/whatSheRemembers";

export const CANDIDATE_DISCLAIMER =
  "These are memories she considered for a reply. A recalled memory is a candidate — the reply may not have used it.";

const TYPE_LABELS: Record<string, string> = {
  turn: "Conversation",
  emotional_beat: "Feeling",
  decision: "Decision",
  image_generated: "Image",
  recall: "Earlier recall",
  identity_changed: "Identity",
  milestone: "Milestone",
  note: "Note",
  retraction: "Retraction",
  memory_corrupted: "Corruption",
  memory_restored: "Restored",
  battle_outcome: "Battle",
  document_chunk: "Document",
  web_result: "Web result",
};

export function memoryTypeLabel(eventType: string | null | undefined): string {
  const key = String(eventType || "").trim();
  if (!key) return "Memory";
  if (TYPE_LABELS[key]) return TYPE_LABELS[key];
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function ageFromSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (s < 45) return "just now";
  if (s < 120) return "a minute ago";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 5400) return "an hour ago";
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  if (s < 172800) return "yesterday";
  const days = Math.floor(s / 86400);
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (days < 365) return months <= 1 ? "a month ago" : `${months} months ago`;
  const years = days / 365;
  if (years < 1.5) return "a year ago";
  return `${years.toFixed(1)} years ago`;
}

/** How long ago the memory itself happened (not when it was recalled). */
export function formatHappenedAgo(occurredAt?: string | null, memoryAgeS?: number | null): string {
  if (occurredAt) {
    const ms = Date.parse(occurredAt);
    if (Number.isFinite(ms)) return ageFromSeconds((Date.now() - ms) / 1000);
  }
  if (memoryAgeS != null && Number.isFinite(memoryAgeS)) return ageFromSeconds(memoryAgeS);
  return "unknown time";
}

export function formatRecalledAt(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "Unknown time";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "Unknown time";
  const date = new Date(ms);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return `Yesterday, ${time}`;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function pct(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

/**
 * Compact, friendly score line. Omits similarity when the server has none
 * (no query or memory embedding existed; the rank then used a stand-in).
 */
export function formatRecallScores(entry: {
  score: number;
  similarity?: number | null;
  recency?: number | null;
  emotional_weight: number;
}): string {
  const parts: string[] = [];
  const score = pct(entry.score);
  if (score) parts.push(`Score ${score}`);
  const match = pct(entry.similarity);
  if (match) parts.push(`Match ${match}`);
  const recency = pct(entry.recency);
  if (recency) parts.push(`Recency ${recency}`);
  const feeling = pct(entry.emotional_weight);
  if (feeling) parts.push(`Feeling ${feeling}`);
  return parts.join(" · ");
}

export function withheldNote(withheld?: { retracted?: number; unattributable?: number } | null): string | null {
  const retracted = Math.max(0, withheld?.retracted ?? 0);
  const unattributable = Math.max(0, withheld?.unattributable ?? 0);
  const total = retracted + unattributable;
  if (total <= 0) return null;
  if (retracted && !unattributable) {
    return total === 1 ? "1 forgotten memory isn't shown." : `${total} forgotten memories aren't shown.`;
  }
  if (!retracted && unattributable) {
    return total === 1
      ? "1 memory isn't shown because it could not be linked to her."
      : `${total} memories aren't shown because they could not be linked to her.`;
  }
  return total === 1 ? "1 memory isn't shown." : `${total} memories aren't shown.`;
}

export function turnLinkageNote(linkage?: string | null): string | null {
  if (linkage === "partial") {
    return "Some of these moments can be tied to a specific reply; others are grouped by when she recalled them.";
  }
  if (linkage === "full" || linkage === "turn_id") {
    return "When a link is known, a moment is grouped with the reply it was recalled for.";
  }
  return null;
}

export function errorMessage(code?: string | null): string {
  switch (code) {
    case "companion_not_found":
      return "This companion could not be found.";
    case "memory_schema_missing":
      return "Memory not set up yet.";
    case "unauthorized":
      return "Sign in to see what she recalled.";
    case "invalid_session_id":
      return "That conversation filter is not valid.";
    case "invalid_cursor":
      return "Could not load earlier moments. Try refreshing.";
    case "network_error":
      return "Could not reach the memory ledger. Check your connection and try again.";
    case "invalid_response":
      return "The memory ledger sent an unexpected response.";
    default:
      return "The memory ledger could not be loaded.";
  }
}

export function recallForgetPath({
  characterId,
  companionName,
  returnTo,
  eventId,
  preview,
}: {
  characterId: string;
  companionName?: string;
  returnTo?: string | null;
  eventId: string;
  preview?: string | null;
}): string {
  return whatSheRemembersPath({
    characterId,
    companionName,
    returnTo,
    memoryId: eventId,
    preview,
  });
}
