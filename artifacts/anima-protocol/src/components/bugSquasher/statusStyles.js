// @ts-check
/** Shared labels and colours for bug statuses and kinds. */
export const STATUS_LABEL = {
  new: "New",
  triaged: "Triaged",
  fixed: "Fixed",
  ignored: "Ignored",
};

export const STATUS_CLASS = {
  new: "border-red-400/50 text-red-300 bg-red-500/10",
  triaged: "border-amber-400/50 text-amber-200 bg-amber-500/10",
  fixed: "border-emerald-400/50 text-emerald-300 bg-emerald-500/10",
  ignored: "border-primary/20 text-primary/40 bg-primary/5",
};

export const KIND_LABEL = {
  window_error: "Runtime error",
  unhandled_rejection: "Unhandled promise",
  react_crash: "Screen crash",
  api_error: "API failure",
  chat_failure: "Chat turn",
  manual: "User report",
};

/** @param {string | null | undefined} iso */
export function relativeTime(iso, now = Date.now()) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Triage filter: "open" is new + triaged.
 * @param {string} filter
 * @param {{ status: string }} group
 */
export function matchesFilter(filter, group) {
  if (filter === "all") return true;
  if (filter === "open") return group.status === "new" || group.status === "triaged";
  return group.status === filter;
}
